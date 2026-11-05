use serde::{Deserialize, Serialize};
use std::fmt;

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::PermissionDenied => "PermissionDenied",
            std::io::ErrorKind::NotFound => "PathNotFound",
            std::io::ErrorKind::AlreadyExists => "PathConflict",
            _ => "IoError",
        };
        Self::new(code, error.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("DatabaseError", error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::new("InvalidJson", error.to_string())
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillSource {
    pub kind: String,
    pub url: Option<String>,
    pub reference: Option<String>,
    pub commit: Option<String>,
    pub subpath: Option<String>,
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    pub description: String,
    pub license: Option<String>,
    pub latest_revision_id: String,
    pub source: SkillSource,
    pub revision_count: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub id: String,
    pub skill_id: String,
    pub hash: String,
    pub path: String,
    pub source: SkillSource,
    pub file_count: u64,
    pub total_bytes: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub name: String,
    pub description: String,
    pub license: Option<String>,
    pub hash: String,
    pub file_count: u64,
    pub total_bytes: u64,
    pub markdown: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDocument {
    pub skill: Skill,
    pub revision: Revision,
    pub markdown: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedSkill {
    pub path: String,
    pub resolved_path: Option<String>,
    pub name: String,
    pub description: String,
    pub scope_path: String,
    pub consumers: Vec<String>,
    pub status: String,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCandidate {
    pub name: String,
    pub path: String,
    pub reason: String,
}

pub fn now_string() -> String {
    // Unix time is an unambiguous UTC instant; presentation formats it for the user's locale.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}
