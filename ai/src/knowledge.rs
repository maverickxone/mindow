use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// A cached knowledge entry for a process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessKnowledge {
    pub description: String,
    pub category: String,
    pub typical_memory: String,
    pub risk: String,     // "safe", "caution", "suspicious"
    #[serde(default)]
    pub advice: String,   // AI-generated advice
    pub updated: String,  // ISO date
}

/// The local knowledge database
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct KnowledgeBase {
    pub entries: HashMap<String, ProcessKnowledge>,
}

/// Path to knowledge file: ~/.mindow/knowledge.json
pub fn knowledge_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".mindow").join("knowledge.json")
}

/// Result of loading data from disk, with write-safety flag.
pub struct KnowledgeLoadResult {
    pub kb: KnowledgeBase,
    /// If true, the data was loaded cleanly (or file didn't exist).
    /// If false, the file was corrupted — saving would overwrite corrupt data.
    pub writable: bool,
}

/// Load knowledge base from disk.
/// If the file doesn't exist, returns an empty writable knowledge base.
/// If the file exists but is corrupted, returns empty with writable=false
/// and prints a warning to stderr.
pub fn load_knowledge() -> KnowledgeLoadResult {
    let path = knowledge_path();
    if !path.exists() {
        return KnowledgeLoadResult { kb: KnowledgeBase::default(), writable: true };
    }
    match fs::read_to_string(&path) {
        Ok(content) => {
            match serde_json::from_str(&content) {
                Ok(kb) => KnowledgeLoadResult { kb, writable: true },
                Err(e) => {
                    eprintln!(
                        "Warning: knowledge.json is corrupted ({}). Using empty defaults. File NOT overwritten.",
                        e
                    );
                    KnowledgeLoadResult { kb: KnowledgeBase::default(), writable: false }
                }
            }
        }
        Err(e) => {
            eprintln!(
                "Warning: Failed to read knowledge.json ({}). Using empty defaults. File NOT overwritten.",
                e
            );
            KnowledgeLoadResult { kb: KnowledgeBase::default(), writable: false }
        }
    }
}

/// Save knowledge base to disk.
pub fn save_knowledge(kb: &KnowledgeBase) -> Result<(), std::io::Error> {
    let path = knowledge_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(kb)?;
    fs::write(&path, content)
}

/// Look up a process by name (case-insensitive, strips .exe suffix)
pub fn lookup<'a>(kb: &'a KnowledgeBase, process_name: &str) -> Option<&'a ProcessKnowledge> {
    let key = normalize_name(process_name);
    kb.entries.get(&key)
}

/// Insert or update a knowledge entry
pub fn upsert(kb: &mut KnowledgeBase, process_name: &str, knowledge: ProcessKnowledge) {
    let key = normalize_name(process_name);
    kb.entries.insert(key, knowledge);
}

/// Normalize process name: lowercase, strip .exe
fn normalize_name(name: &str) -> String {
    name.to_lowercase()
        .trim_end_matches(".exe")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_name() {
        assert_eq!(normalize_name("Kiro.exe"), "kiro");
        assert_eq!(normalize_name("chrome.EXE"), "chrome");
        assert_eq!(normalize_name("svchost"), "svchost");
    }

    #[test]
    fn test_lookup_empty() {
        let kb = KnowledgeBase::default();
        assert!(lookup(&kb, "chrome.exe").is_none());
    }

    #[test]
    fn test_upsert_and_lookup() {
        let mut kb = KnowledgeBase::default();
        upsert(&mut kb, "Kiro.exe", ProcessKnowledge {
            description: "AI IDE by AWS".to_string(),
            category: "IDE".to_string(),
            typical_memory: "800MB-2GB".to_string(),
            risk: "safe".to_string(),
            advice: "正常使用".to_string(),
            updated: "2026-05-31".to_string(),
        });
        let result = lookup(&kb, "kiro.exe");
        assert!(result.is_some());
        assert_eq!(result.unwrap().description, "AI IDE by AWS");
    }

    #[test]
    fn test_case_insensitive_lookup() {
        let mut kb = KnowledgeBase::default();
        upsert(&mut kb, "Chrome.exe", ProcessKnowledge {
            description: "Web browser".to_string(),
            category: "Browser".to_string(),
            typical_memory: "500MB-3GB".to_string(),
            risk: "safe".to_string(),
            advice: "正常使用".to_string(),
            updated: "2026-05-31".to_string(),
        });
        assert!(lookup(&kb, "CHROME.EXE").is_some());
        assert!(lookup(&kb, "chrome").is_some());
    }
}
