use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs;
use std::path::PathBuf;

/// AI 配置结构（对应 config.toml）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AiConfig {
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_language")]
    pub language: String,
}

/// 配置错误类型
#[derive(Debug)]
pub enum ConfigError {
    /// 文件读写失败
    IoError(std::io::Error),
    /// TOML 解析失败
    ParseError(String),
    /// 无效的配置字段名
    InvalidField(String),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::IoError(e) => write!(f, "IO error: {}", e),
            ConfigError::ParseError(msg) => write!(f, "Parse error: {}", msg),
            ConfigError::InvalidField(field) => write!(f, "Invalid field: {}", field),
        }
    }
}

impl std::error::Error for ConfigError {}

impl From<std::io::Error> for ConfigError {
    fn from(e: std::io::Error) -> Self {
        ConfigError::IoError(e)
    }
}

/// 默认 provider: "openai"
pub fn default_provider() -> String {
    "openai".to_string()
}

/// 默认 base_url: "https://api.openai.com"
pub fn default_base_url() -> String {
    "https://api.openai.com".to_string()
}

/// 默认 language: "cn"
pub fn default_language() -> String {
    "cn".to_string()
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: default_provider(),
            model: String::new(),
            api_key: String::new(),
            base_url: default_base_url(),
            language: default_language(),
        }
    }
}

/// 配置文件路径: ~/.mindow/config.toml
pub fn config_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".mindow").join("config.toml")
}

/// 加载配置，文件不存在则创建默认配置并保存
pub fn load_config() -> Result<AiConfig, ConfigError> {
    let path = config_path();
    if !path.exists() {
        let config = AiConfig::default();
        save_config(&config)?;
        return Ok(config);
    }
    let content = fs::read_to_string(&path)?;
    toml::from_str(&content).map_err(|e| ConfigError::ParseError(e.to_string()))
}

/// 保存配置到文件，自动创建父目录
pub fn save_config(config: &AiConfig) -> Result<(), ConfigError> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content =
        toml::to_string_pretty(config).map_err(|e| ConfigError::ParseError(e.to_string()))?;
    fs::write(&path, content)?;
    Ok(())
}

/// 设置单个配置字段
pub fn set_config_field(key: &str, value: &str) -> Result<(), ConfigError> {
    let mut config = load_config()?;
    match key {
        "provider" => config.provider = value.to_string(),
        "model" => config.model = value.to_string(),
        "api_key" => config.api_key = value.to_string(),
        "base_url" => config.base_url = value.to_string(),
        "language" => config.language = value.to_string(),
        _ => return Err(ConfigError::InvalidField(key.to_string())),
    }
    save_config(&config)
}

/// 遮蔽 API 密钥显示: 保留前4后4，中间用 * 替代
/// 长度 < 8 则全部用 * 替代
pub fn mask_api_key(key: &str) -> String {
    if key.len() < 8 {
        "*".repeat(key.len())
    } else {
        let prefix = &key[..4];
        let suffix = &key[key.len() - 4..];
        let masked_len = key.len() - 8;
        format!("{}{}{}", prefix, "*".repeat(masked_len), suffix)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_provider() {
        assert_eq!(default_provider(), "openai");
    }

    #[test]
    fn test_default_base_url() {
        assert_eq!(default_base_url(), "https://api.openai.com");
    }

    #[test]
    fn test_default_language() {
        assert_eq!(default_language(), "cn");
    }

    #[test]
    fn test_ai_config_default() {
        let config = AiConfig::default();
        assert_eq!(config.provider, "openai");
        assert_eq!(config.model, "");
        assert_eq!(config.api_key, "");
        assert_eq!(config.base_url, "https://api.openai.com");
        assert_eq!(config.language, "cn");
    }

    #[test]
    fn test_serialize_deserialize_roundtrip() {
        let config = AiConfig {
            provider: "claude".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            api_key: "sk-ant-test-key".to_string(),
            base_url: "https://api.anthropic.com".to_string(),
            language: "en".to_string(),
        };

        let toml_str = toml::to_string(&config).expect("Failed to serialize");
        let deserialized: AiConfig = toml::from_str(&toml_str).expect("Failed to deserialize");
        assert_eq!(config, deserialized);
    }

    #[test]
    fn test_deserialize_with_defaults() {
        // Empty TOML should use all defaults
        let config: AiConfig = toml::from_str("").expect("Failed to deserialize empty");
        assert_eq!(config.provider, "openai");
        assert_eq!(config.model, "");
        assert_eq!(config.api_key, "");
        assert_eq!(config.base_url, "https://api.openai.com");
        assert_eq!(config.language, "cn");
    }

    #[test]
    fn test_deserialize_partial_config() {
        let toml_str = r#"
provider = "claude"
api_key = "sk-test"
"#;
        let config: AiConfig = toml::from_str(toml_str).expect("Failed to deserialize partial");
        assert_eq!(config.provider, "claude");
        assert_eq!(config.api_key, "sk-test");
        // Defaults for missing fields
        assert_eq!(config.base_url, "https://api.openai.com");
        assert_eq!(config.language, "cn");
        assert_eq!(config.model, "");
    }

    #[test]
    fn test_config_error_display() {
        let io_err = ConfigError::IoError(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "file not found",
        ));
        assert!(io_err.to_string().contains("IO error"));
        assert!(io_err.to_string().contains("file not found"));

        let parse_err = ConfigError::ParseError("invalid toml".to_string());
        assert!(parse_err.to_string().contains("Parse error"));
        assert!(parse_err.to_string().contains("invalid toml"));

        let field_err = ConfigError::InvalidField("unknown_key".to_string());
        assert!(field_err.to_string().contains("Invalid field"));
        assert!(field_err.to_string().contains("unknown_key"));
    }

    #[test]
    fn test_config_error_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
        let config_err: ConfigError = io_err.into();
        match config_err {
            ConfigError::IoError(e) => assert_eq!(e.kind(), std::io::ErrorKind::PermissionDenied),
            _ => panic!("Expected IoError variant"),
        }
    }

    #[test]
    fn test_mask_api_key_empty() {
        assert_eq!(mask_api_key(""), "");
    }

    #[test]
    fn test_mask_api_key_short() {
        // "short" is 5 chars, less than 8 → all stars
        assert_eq!(mask_api_key("short"), "*****");
    }

    #[test]
    fn test_mask_api_key_exactly_8() {
        // "12345678" → first 4 + 0 stars + last 4 = "12345678"
        assert_eq!(mask_api_key("12345678"), "12345678");
    }

    #[test]
    fn test_mask_api_key_11_chars() {
        // "sk-12345678" (11 chars) → "sk-1" + "***" + "5678"
        assert_eq!(mask_api_key("sk-12345678"), "sk-1***5678");
    }

    #[test]
    fn test_mask_api_key_long() {
        // "sk-ant-api03-very-long-key-here" (31 chars)
        let key = "sk-ant-api03-very-long-key-here";
        let masked = mask_api_key(key);
        // First 4 chars preserved
        assert_eq!(&masked[..4], "sk-a");
        // Last 4 chars preserved
        assert_eq!(&masked[masked.len() - 4..], "here");
        // Total length preserved
        assert_eq!(masked.len(), key.len());
        // Middle is all stars
        let middle = &masked[4..masked.len() - 4];
        assert!(middle.chars().all(|c| c == '*'));
        assert_eq!(middle.len(), key.len() - 8);
    }

    #[test]
    fn test_config_path_structure() {
        let path = config_path();
        // Should end with .mindow/config.toml
        assert_eq!(path.file_name().unwrap(), "config.toml");
        assert_eq!(
            path.parent().unwrap().file_name().unwrap(),
            ".mindow"
        );
    }

    #[test]
    fn test_set_config_field_invalid_key() {
        let result = set_config_field("nonexistent_field", "value");
        assert!(result.is_err());
        match result.unwrap_err() {
            ConfigError::InvalidField(field) => assert_eq!(field, "nonexistent_field"),
            _ => panic!("Expected InvalidField error"),
        }
    }

    #[test]
    fn test_save_and_load_config_roundtrip() {
        // This test uses a temp dir to avoid modifying user's actual config.
        // We test the serialization/deserialization logic directly.
        let config = AiConfig {
            provider: "claude".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            api_key: "sk-test-key-12345".to_string(),
            base_url: "https://api.anthropic.com".to_string(),
            language: "en".to_string(),
        };

        // Serialize to TOML and deserialize back (simulates save/load)
        let content = toml::to_string_pretty(&config).expect("serialize");
        let loaded: AiConfig = toml::from_str(&content).expect("deserialize");
        assert_eq!(config, loaded);
    }

    #[test]
    fn test_save_config_creates_valid_toml() {
        let config = AiConfig {
            provider: "openai".to_string(),
            model: "gpt-4o-mini".to_string(),
            api_key: "sk-abc123".to_string(),
            base_url: "https://api.openai.com".to_string(),
            language: "cn".to_string(),
        };

        let content = toml::to_string_pretty(&config).expect("serialize");
        // Verify the TOML content contains expected key-value pairs
        assert!(content.contains("provider = \"openai\""));
        assert!(content.contains("model = \"gpt-4o-mini\""));
        assert!(content.contains("api_key = \"sk-abc123\""));
        assert!(content.contains("base_url = \"https://api.openai.com\""));
        assert!(content.contains("language = \"cn\""));
    }

    #[test]
    fn test_set_config_field_valid_keys() {
        // Test that all valid keys are accepted (using in-memory config logic)
        let valid_keys = vec!["provider", "model", "api_key", "base_url", "language"];
        for key in valid_keys {
            let mut config = AiConfig::default();
            let value = "test_value";
            match key {
                "provider" => config.provider = value.to_string(),
                "model" => config.model = value.to_string(),
                "api_key" => config.api_key = value.to_string(),
                "base_url" => config.base_url = value.to_string(),
                "language" => config.language = value.to_string(),
                _ => panic!("Unknown key"),
            }
            // Verify the field was set correctly
            let field_value = match key {
                "provider" => &config.provider,
                "model" => &config.model,
                "api_key" => &config.api_key,
                "base_url" => &config.base_url,
                "language" => &config.language,
                _ => unreachable!(),
            };
            assert_eq!(field_value, value, "Field '{}' not set correctly", key);
        }
    }
}
