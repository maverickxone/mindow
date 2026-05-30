use crate::client::Provider;

/// SSE 事件解析结果
#[derive(Debug, Clone, PartialEq)]
pub enum SseEvent {
    /// 文本增量内容
    Delta(String),
    /// 流结束信号
    Done,
    /// 非内容事件（心跳、注释等），应忽略
    Skip,
}

/// 解析单行 SSE 数据，根据 provider 提取文本增量
pub fn parse_sse_line(line: &str, provider: &Provider) -> SseEvent {
    // Empty lines and comments → Skip
    if line.is_empty() || line.starts_with(':') {
        return SseEvent::Skip;
    }

    match provider {
        Provider::OpenAI => parse_openai_line(line),
        Provider::Claude => parse_claude_line(line),
    }
}

/// OpenAI SSE line handling
fn parse_openai_line(line: &str) -> SseEvent {
    if let Some(data) = line.strip_prefix("data: ") {
        if data == "[DONE]" {
            return SseEvent::Done;
        }
        parse_openai_delta(data)
    } else {
        SseEvent::Skip
    }
}

/// Claude SSE line handling
fn parse_claude_line(line: &str) -> SseEvent {
    if let Some(event_type) = line.strip_prefix("event: ") {
        if event_type.trim() == "message_stop" {
            return SseEvent::Done;
        }
        return SseEvent::Skip;
    }

    if let Some(data) = line.strip_prefix("data: ") {
        parse_claude_delta(data)
    } else {
        SseEvent::Skip
    }
}

/// OpenAI 格式: 从 choices[0].delta.content 提取文本
fn parse_openai_delta(json_str: &str) -> SseEvent {
    let value: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return SseEvent::Skip,
    };

    if let Some(content) = value
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|choice| choice.get("delta"))
        .and_then(|delta| delta.get("content"))
        .and_then(|c| c.as_str())
    {
        SseEvent::Delta(content.to_string())
    } else {
        // No content field (e.g. role-only delta) → Skip
        SseEvent::Skip
    }
}

/// Claude 格式: 从 content_block_delta.delta.text 提取文本
fn parse_claude_delta(json_str: &str) -> SseEvent {
    let value: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return SseEvent::Skip,
    };

    match value.get("type").and_then(|t| t.as_str()) {
        Some("content_block_delta") => {
            if let Some(text) = value
                .get("delta")
                .and_then(|d| d.get("text"))
                .and_then(|t| t.as_str())
            {
                SseEvent::Delta(text.to_string())
            } else {
                SseEvent::Skip
            }
        }
        Some("message_stop") => SseEvent::Done,
        _ => SseEvent::Skip,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // === OpenAI Tests ===

    #[test]
    fn test_openai_normal_delta() {
        let line = r#"data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}"#;
        let result = parse_sse_line(line, &Provider::OpenAI);
        assert_eq!(result, SseEvent::Delta("Hello".to_string()));
    }

    #[test]
    fn test_openai_unicode_delta() {
        let line = r#"data: {"choices":[{"delta":{"content":"你好世界"},"index":0}]}"#;
        let result = parse_sse_line(line, &Provider::OpenAI);
        assert_eq!(result, SseEvent::Delta("你好世界".to_string()));
    }

    #[test]
    fn test_openai_done() {
        let line = "data: [DONE]";
        let result = parse_sse_line(line, &Provider::OpenAI);
        assert_eq!(result, SseEvent::Done);
    }

    #[test]
    fn test_openai_role_only_delta() {
        let line = r#"data: {"choices":[{"delta":{"role":"assistant"},"index":0}]}"#;
        let result = parse_sse_line(line, &Provider::OpenAI);
        assert_eq!(result, SseEvent::Skip);
    }

    #[test]
    fn test_openai_empty_content() {
        let line = r#"data: {"choices":[{"delta":{"content":""},"index":0}]}"#;
        let result = parse_sse_line(line, &Provider::OpenAI);
        assert_eq!(result, SseEvent::Delta("".to_string()));
    }

    #[test]
    fn test_openai_empty_choices() {
        let line = r#"data: {"choices":[]}"#;
        let result = parse_sse_line(line, &Provider::OpenAI);
        assert_eq!(result, SseEvent::Skip);
    }

    // === Claude Tests ===

    #[test]
    fn test_claude_content_block_delta() {
        let line = r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"分析"}}"#;
        let result = parse_sse_line(line, &Provider::Claude);
        assert_eq!(result, SseEvent::Delta("分析".to_string()));
    }

    #[test]
    fn test_claude_message_stop_event() {
        let line = "event: message_stop";
        let result = parse_sse_line(line, &Provider::Claude);
        assert_eq!(result, SseEvent::Done);
    }

    #[test]
    fn test_claude_message_stop_data() {
        let line = r#"data: {"type":"message_stop"}"#;
        let result = parse_sse_line(line, &Provider::Claude);
        assert_eq!(result, SseEvent::Done);
    }

    #[test]
    fn test_claude_other_event_type() {
        let line = "event: content_block_start";
        let result = parse_sse_line(line, &Provider::Claude);
        assert_eq!(result, SseEvent::Skip);
    }

    #[test]
    fn test_claude_message_start_data() {
        let line = r#"data: {"type":"message_start","message":{"id":"msg_123"}}"#;
        let result = parse_sse_line(line, &Provider::Claude);
        assert_eq!(result, SseEvent::Skip);
    }

    // === Common Tests ===

    #[test]
    fn test_empty_line() {
        assert_eq!(parse_sse_line("", &Provider::OpenAI), SseEvent::Skip);
        assert_eq!(parse_sse_line("", &Provider::Claude), SseEvent::Skip);
    }

    #[test]
    fn test_comment_line() {
        assert_eq!(parse_sse_line(": heartbeat", &Provider::OpenAI), SseEvent::Skip);
        assert_eq!(parse_sse_line(": keep-alive", &Provider::Claude), SseEvent::Skip);
    }

    #[test]
    fn test_comment_empty() {
        assert_eq!(parse_sse_line(":", &Provider::OpenAI), SseEvent::Skip);
    }

    #[test]
    fn test_malformed_json() {
        let line = "data: {not valid json}";
        assert_eq!(parse_sse_line(line, &Provider::OpenAI), SseEvent::Skip);
        assert_eq!(parse_sse_line(line, &Provider::Claude), SseEvent::Skip);
    }

    #[test]
    fn test_unknown_line_format() {
        let line = "id: 12345";
        assert_eq!(parse_sse_line(line, &Provider::OpenAI), SseEvent::Skip);
        assert_eq!(parse_sse_line(line, &Provider::Claude), SseEvent::Skip);
    }

    #[test]
    fn test_openai_special_characters_in_content() {
        let line = r#"data: {"choices":[{"delta":{"content":"line1\nline2\ttab"},"index":0}]}"#;
        let result = parse_sse_line(line, &Provider::OpenAI);
        assert_eq!(result, SseEvent::Delta("line1\nline2\ttab".to_string()));
    }

    #[test]
    fn test_claude_special_characters_in_content() {
        let line = r#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello\nworld"}}"#;
        let result = parse_sse_line(line, &Provider::Claude);
        assert_eq!(result, SseEvent::Delta("hello\nworld".to_string()));
    }
}
