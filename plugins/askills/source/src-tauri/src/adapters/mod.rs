/// Physical roots may be read by multiple agents. Never imply per-agent isolation.
pub const SKILL_ROOTS: &[(&str, &[&str])] = &[
    (".agents", &["codex", "cursor"]),
    (".cursor", &["cursor"]),
    (".claude", &["claudeCode", "cursor"]),
    // Current Codex documentation specifies .agents/skills. Keep its legacy path visible
    // without claiming that current Codex versions discover it.
    (".codex", &["cursor"]),
];

pub fn consumers(directory: &str) -> Vec<String> {
    SKILL_ROOTS
        .iter()
        .find(|(name, _)| *name == directory)
        .map(|(_, tools)| tools.iter().map(|tool| (*tool).to_string()).collect())
        .unwrap_or_default()
}

pub fn excluded_directory(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | ".venv"
            | "venv"
            | ".idea"
            | ".cache"
            | "$RECYCLE.BIN"
            | "System Volume Information"
    )
}
