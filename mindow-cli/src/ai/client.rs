use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use std::fmt;
use std::time::Duration;

/// AI 提供商枚举
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    OpenAI,
    Claude,
}

/// AI 客户端配置
#[derive(Debug, Clone)]
pub struct AiClientConfig {
    pub provider: Provider,
    pub model: String,
    pub api_key: String,
    pub base_url: String,
    pub timeout_secs: u64,
}

impl Default for AiClientConfig {
    fn default() -> Self {
        Self {
            provider: Provider::OpenAI,
            model: String::new(),
            api_key: String::new(),
            base_url: "https://api.openai.com".to_string(),
            timeout_secs: 30,
        }
    }
}

/// AI 错误类型
#[derive(Debug, Clone, PartialEq)]
pub enum AiError {
    /// API 密钥未配置
    NoApiKey,
    /// 网络连接失败
    NetworkError(String),
    /// 请求超时
    Timeout,
    /// HTTP 错误状态码
    HttpError { status: u16, message: String },
    /// SSE 解析错误
    ParseError(String),
    /// 流中断
    StreamInterrupted { partial_content: String },
}

impl fmt::Display for AiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AiError::NoApiKey => {
                write!(f, "API 密钥未配置，请运行 `mindow config set api_key <your-key>` 设置密钥")
            }
            AiError::NetworkError(msg) => {
                write!(f, "网络连接失败: {}", msg)
            }
            AiError::Timeout => {
                write!(f, "请求超时，请检查网络连接")
            }
            AiError::HttpError { status, message } => {
                write!(f, "HTTP 错误 ({}): {}", status, message)
            }
            AiError::ParseError(msg) => {
                write!(f, "响应解析错误: {}", msg)
            }
            AiError::StreamInterrupted { partial_content } => {
                write!(
                    f,
                    "流式传输中断，已接收 {} 字节的部分内容",
                    partial_content.len()
                )
            }
        }
    }
}

/// 流式响应回调 trait
pub trait StreamCallback: Send {
    fn on_delta(&mut self, text: &str);
    fn on_complete(&mut self);
    fn on_error(&mut self, error: &AiError);
}

/// AI 客户端 trait —— 允许测试中使用 mock
#[async_trait]
pub trait AiClient: Send + Sync {
    async fn stream_completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        callback: &mut dyn StreamCallback,
    ) -> Result<(), AiError>;
}

/// HTTP 错误码映射为用户友好的错误消息
pub fn map_http_error(status: u16) -> String {
    match status {
        401 => "API 密钥无效，请运行 `mindow config set api_key <key>` 重新设置".to_string(),
        429 => "请求过于频繁，请稍后再试".to_string(),
        500 => "AI 服务暂时不可用，请稍后重试".to_string(),
        _ => format!("请求失败 (HTTP {})，请检查配置或稍后重试", status),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic Claude 原生 API 客户端
// ─────────────────────────────────────────────────────────────────────────────

/// Anthropic Claude 原生 API 客户端
pub struct ClaudeClient {
    config: AiClientConfig,
    http: Client,
}

impl ClaudeClient {
    pub fn new(config: AiClientConfig) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .unwrap_or_default();
        Self { config, http }
    }
}

#[async_trait]
impl AiClient for ClaudeClient {
    async fn stream_completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        callback: &mut dyn StreamCallback,
    ) -> Result<(), AiError> {
        let body = serde_json::json!({
            "model": self.config.model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": [
                {"role": "user", "content": user_prompt}
            ],
            "stream": true
        });

        let url = format!("{}/v1/messages", self.config.base_url.trim_end_matches('/'));

        let response = self
            .http
            .post(&url)
            .header("x-api-key", &self.config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    AiError::Timeout
                } else if e.is_connect() {
                    AiError::NetworkError(e.to_string())
                } else {
                    AiError::NetworkError(e.to_string())
                }
            })?;

        let status = response.status();
        if !status.is_success() {
            let message = map_http_error(status.as_u16());
            return Err(AiError::HttpError {
                status: status.as_u16(),
                message,
            });
        }

        // Read SSE stream — parse Claude delta events via sse module
        let mut accumulated = String::new();
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| AiError::StreamInterrupted {
                partial_content: accumulated.clone(),
            })?;

            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim_end_matches('\r').to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                let event = super::sse::parse_sse_line(&line, &Provider::Claude);
                match event {
                    super::sse::SseEvent::Delta(text) => {
                        accumulated.push_str(&text);
                        callback.on_delta(&text);
                    }
                    super::sse::SseEvent::Done => {
                        callback.on_complete();
                        return Ok(());
                    }
                    super::sse::SseEvent::Skip => {}
                }
            }
        }

        callback.on_complete();
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI-compatible API 客户端
// ─────────────────────────────────────────────────────────────────────────────

/// OpenAI-compatible API 客户端
pub struct OpenAiClient {
    config: AiClientConfig,
    http: Client,
}

impl OpenAiClient {
    pub fn new(config: AiClientConfig) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .unwrap_or_default();
        Self { config, http }
    }
}

#[async_trait]
impl AiClient for OpenAiClient {
    async fn stream_completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        callback: &mut dyn StreamCallback,
    ) -> Result<(), AiError> {
        // Construct the request body
        let body = serde_json::json!({
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "stream": true
        });

        // Build URL: base_url + /v1/chat/completions
        let url = format!(
            "{}/v1/chat/completions",
            self.config.base_url.trim_end_matches('/')
        );

        // Send request
        let response = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    AiError::Timeout
                } else if e.is_connect() {
                    AiError::NetworkError(e.to_string())
                } else {
                    AiError::NetworkError(e.to_string())
                }
            })?;

        // Check HTTP status
        let status = response.status();
        if !status.is_success() {
            let message = map_http_error(status.as_u16());
            return Err(AiError::HttpError {
                status: status.as_u16(),
                message,
            });
        }

        // Read SSE stream
        let mut accumulated = String::new();
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_e| AiError::StreamInterrupted {
                partial_content: accumulated.clone(),
            })?;

            buffer.push_str(&String::from_utf8_lossy(&chunk));

            // Process complete lines
            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim_end_matches('\r').to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                let event = super::sse::parse_sse_line(&line, &Provider::OpenAI);
                match event {
                    super::sse::SseEvent::Delta(text) => {
                        accumulated.push_str(&text);
                        callback.on_delta(&text);
                    }
                    super::sse::SseEvent::Done => {
                        callback.on_complete();
                        return Ok(());
                    }
                    super::sse::SseEvent::Skip => {}
                }
            }
        }

        // Stream ended without [DONE]
        callback.on_complete();
        Ok(())
    }
}
