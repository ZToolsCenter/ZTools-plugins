use crate::adapters::{SKILL_ROOTS, consumers, excluded_directory};
use crate::domain::{AppError, DetectedSkill, ProjectCandidate, Result};
use crate::platform::fs::{
    assert_safe_path, canonical_directory, check_cancel, display_path, is_link, read_text,
};
use crate::services::library::parse_frontmatter;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

const MAX_PROJECT_DEPTH: usize = 12;
const MAX_SCAN_ENTRIES: usize = 40_000;
const MAX_SKILLS: usize = 4_000;
const MAX_SKILL_DEPTH: usize = 8;

struct ScanBudget {
    entries: usize,
    skills: usize,
}

impl ScanBudget {
    fn entry(&mut self, cancel: &AtomicBool) -> Result<()> {
        check_cancel(cancel)?;
        self.entries += 1;
        if self.entries > MAX_SCAN_ENTRIES {
            return Err(AppError::new(
                "ScanLimitExceeded",
                "扫描超过 40,000 个条目；请缩小扫描范围",
            ));
        }
        Ok(())
    }
}

fn sorted_children(path: &Path, cancel: &AtomicBool) -> Result<Vec<fs::DirEntry>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(path)? {
        check_cancel(cancel)?;
        if entries.len() >= MAX_SCAN_ENTRIES {
            return Err(AppError::new(
                "ScanLimitExceeded",
                "单目录超过 40,000 个条目；请缩小扫描范围",
            ));
        }
        entries.push(entry?);
    }
    entries.sort_by_key(|entry| entry.file_name());
    Ok(entries)
}

fn record(
    path: &Path,
    scope: &Path,
    agent_directory: &str,
    budget: &mut ScanBudget,
    cancel: &AtomicBool,
) -> Result<DetectedSkill> {
    check_cancel(cancel)?;
    budget.skills += 1;
    if budget.skills > MAX_SKILLS {
        return Err(AppError::new(
            "ScanLimitExceeded",
            "扫描超过 4,000 个 skill 入口",
        ));
    }
    let mut skill = DetectedSkill {
        path: display_path(path),
        resolved_path: None,
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        description: String::new(),
        scope_path: display_path(scope),
        consumers: consumers(agent_directory),
        status: "external".into(),
        diagnostics: Vec::new(),
    };
    if agent_directory == ".codex" {
        skill.diagnostics.push(
            "兼容候选路径；当前 Codex 官方项目入口为 .agents/skills，未据此宣称 Codex 可发现此项"
                .into(),
        );
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => {
            skill.status = "unreadable".into();
            skill.diagnostics.push(error.to_string());
            return Ok(skill);
        }
    };
    let linked = is_link(&metadata);
    let actual = if linked {
        match fs::canonicalize(path) {
            Ok(target) => {
                skill.resolved_path = Some(display_path(&target));
                skill.status = "linked".into();
                target
            }
            Err(error) => {
                skill.status = "broken".into();
                skill.diagnostics.push(format!("无法解析链接目标：{error}"));
                return Ok(skill);
            }
        }
    } else {
        path.to_path_buf()
    };
    // Only this explicitly detected skill entry may resolve a link. We never recursively
    // follow links while discovering projects, categories or nested workspace scopes.
    let document = actual.join("SKILL.md");
    let parsed = assert_safe_path(&actual)
        .and_then(|_| read_text(&document))
        .and_then(|text| parse_frontmatter(&text));
    match parsed {
        Ok((name, description, _)) => {
            if name != skill.name {
                skill
                    .diagnostics
                    .push(format!("目录名与 frontmatter name 不同：{name}"));
            }
            skill.name = name;
            skill.description = description;
        }
        Err(error) => {
            skill.status = if error.code == "PermissionDenied" {
                "unreadable".into()
            } else {
                "invalid".into()
            };
            skill.diagnostics.push(error.message);
        }
    }
    if linked {
        skill
            .diagnostics
            .push("外部链接仅只读检查；扫描不会接管、改写或递归跟随其中链接".into());
    }
    Ok(skill)
}

fn collect_skills(
    directory: &Path,
    scope: &Path,
    agent_directory: &str,
    depth: usize,
    result: &mut Vec<DetectedSkill>,
    budget: &mut ScanBudget,
    cancel: &AtomicBool,
) -> Result<()> {
    if depth > MAX_SKILL_DEPTH {
        return Err(AppError::new(
            "ScanLimitExceeded",
            "skill 分类目录超过 8 层",
        ));
    }
    assert_safe_path(directory)?;
    for entry in sorted_children(directory, cancel)? {
        budget.entry(cancel)?;
        let metadata = fs::symlink_metadata(entry.path())?;
        let path = entry.path();
        if is_link(&metadata) {
            result.push(record(&path, scope, agent_directory, budget, cancel)?);
            continue;
        }
        if !metadata.is_dir() {
            continue;
        }
        let document_exists = fs::symlink_metadata(path.join("SKILL.md")).is_ok();
        if document_exists {
            result.push(record(&path, scope, agent_directory, budget, cancel)?);
        } else {
            let children = sorted_children(&path, cancel)?;
            if children
                .iter()
                .any(|child| child.file_type().is_ok_and(|kind| kind.is_dir()))
            {
                collect_skills(
                    &path,
                    scope,
                    agent_directory,
                    depth + 1,
                    result,
                    budget,
                    cancel,
                )?;
            } else {
                // Show malformed leaf directories instead of making them silently disappear.
                result.push(record(&path, scope, agent_directory, budget, cancel)?);
            }
        }
    }
    Ok(())
}

fn scan_roots(
    scope: &Path,
    result: &mut Vec<DetectedSkill>,
    budget: &mut ScanBudget,
    cancel: &AtomicBool,
) -> Result<()> {
    check_cancel(cancel)?;
    assert_safe_path(scope)?;
    for (agent_directory, _) in SKILL_ROOTS {
        let root = scope.join(agent_directory).join("skills");
        if fs::symlink_metadata(&root).is_err() {
            continue;
        }
        if let Err(error) = assert_safe_path(&root) {
            result.push(DetectedSkill {
                path: display_path(&root),
                resolved_path: None,
                name: format!("{agent_directory}/skills"),
                description: String::new(),
                scope_path: display_path(scope),
                consumers: consumers(agent_directory),
                status: "unreadable".into(),
                diagnostics: vec![
                    error.message,
                    "扫描不跟随整个 skills 根目录的链接；请注册真实项目路径或检查单个 skill 入口"
                        .into(),
                ],
            });
            continue;
        }
        if !root.is_dir() {
            continue;
        }
        match collect_skills(&root, scope, agent_directory, 0, result, budget, cancel) {
            Ok(()) => {}
            Err(error) if error.code == "PermissionDenied" => {
                result.push(DetectedSkill {
                    path: display_path(&root),
                    resolved_path: None,
                    name: format!("{agent_directory}/skills"),
                    description: String::new(),
                    scope_path: display_path(scope),
                    consumers: consumers(agent_directory),
                    status: "unreadable".into(),
                    diagnostics: vec![error.message],
                });
            }
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn scan_scope(
    scope: &Path,
    depth: usize,
    result: &mut Vec<DetectedSkill>,
    budget: &mut ScanBudget,
    cancel: &AtomicBool,
) -> Result<()> {
    check_cancel(cancel)?;
    if depth > MAX_PROJECT_DEPTH {
        return Ok(());
    }
    scan_roots(scope, result, budget, cancel)?;
    for entry in sorted_children(scope, cancel)? {
        budget.entry(cancel)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if excluded_directory(&name) || SKILL_ROOTS.iter().any(|(agent, _)| *agent == name) {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path())?;
        if !metadata.is_dir() || is_link(&metadata) {
            continue;
        }
        if entry.path().join("library.json").is_file() {
            continue;
        }
        if let Err(error) = scan_scope(&entry.path(), depth + 1, result, budget, cancel) {
            if error.code != "PermissionDenied" {
                return Err(error);
            }
            result.push(DetectedSkill {
                path: display_path(&entry.path()),
                resolved_path: None,
                name,
                description: String::new(),
                scope_path: display_path(scope),
                consumers: Vec::new(),
                status: "unreadable".into(),
                diagnostics: vec![error.message],
            });
        }
    }
    Ok(())
}

pub fn scan_project(root: &Path, cancel: &AtomicBool) -> Result<Vec<DetectedSkill>> {
    let root = canonical_directory(root)?;
    let mut result = Vec::new();
    let mut budget = ScanBudget {
        entries: 0,
        skills: 0,
    };
    scan_scope(&root, 0, &mut result, &mut budget, cancel)?;
    // A registered monorepo subdirectory inherits known roots up to its nearest Git
    // worktree boundary. Read only those roots, never recurse sibling projects.
    let ancestors: Vec<&Path> = root.ancestors().collect();
    if let Some(boundary) = ancestors.iter().position(|path| {
        fs::symlink_metadata(path.join(".git")).is_ok_and(|metadata| !is_link(&metadata))
    }) {
        for ancestor in ancestors.iter().take(boundary + 1).skip(1) {
            let first = result.len();
            scan_roots(ancestor, &mut result, &mut budget, cancel)?;
            for skill in &mut result[first..] {
                skill
                    .diagnostics
                    .push("从仓库上级目录继承；作用目录以 scopePath 为准".into());
            }
        }
    }
    result.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

fn discover(
    directory: &Path,
    depth: usize,
    max_depth: usize,
    results: &mut Vec<ProjectCandidate>,
    visited: &mut HashSet<PathBuf>,
    budget: &mut ScanBudget,
    cancel: &AtomicBool,
) -> Result<()> {
    budget.entry(cancel)?;
    assert_safe_path(directory)?;
    if !visited.insert(directory.to_path_buf()) {
        return Ok(());
    }
    if directory.join("library.json").is_file() {
        return Ok(());
    }
    let git = fs::symlink_metadata(directory.join(".git"))
        .is_ok_and(|metadata| !is_link(&metadata) && (metadata.is_dir() || metadata.is_file()));
    let agent = SKILL_ROOTS
        .iter()
        .any(|(name, _)| directory.join(name).join("skills").is_dir());
    if git || agent {
        results.push(ProjectCandidate {
            name: directory
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "项目".into()),
            path: display_path(directory),
            reason: if git {
                "Git 工作区（含 worktree）".into()
            } else {
                "发现 Agent skills 目录".into()
            },
        });
    }
    if depth == max_depth {
        return Ok(());
    }
    for entry in sorted_children(directory, cancel)? {
        budget.entry(cancel)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if excluded_directory(&name) || SKILL_ROOTS.iter().any(|(agent, _)| *agent == name) {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path())?;
        if !metadata.is_dir() || is_link(&metadata) {
            continue;
        }
        discover(
            &entry.path(),
            depth + 1,
            max_depth,
            results,
            visited,
            budget,
            cancel,
        )?;
    }
    Ok(())
}

pub fn discover_projects(
    root: &Path,
    max_depth: usize,
    cancel: &AtomicBool,
) -> Result<Vec<ProjectCandidate>> {
    if max_depth > MAX_PROJECT_DEPTH {
        return Err(AppError::new(
            "InvalidDepth",
            "项目扫描深度必须在 0–12 之间",
        ));
    }
    let root = canonical_directory(root)?;
    let mut results = Vec::new();
    discover(
        &root,
        0,
        max_depth,
        &mut results,
        &mut HashSet::new(),
        &mut ScanBudget {
            entries: 0,
            skills: 0,
        },
        cancel,
    )?;
    results.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_skill(project: &Path, relative: &str) {
        let root = project.join(relative);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("SKILL.md"),
            "---\nname: example\ndescription: 测试\n---\n",
        )
        .unwrap();
    }

    #[test]
    fn scan_records_consumers_and_nested_scopes_without_mutation() {
        let temporary = tempfile::tempdir().unwrap();
        write_skill(temporary.path(), ".agents/skills/example");
        write_skill(temporary.path(), "apps/中文项目/.claude/skills/example");
        fs::create_dir_all(temporary.path().join(".cursor/skills/broken")).unwrap();
        let result = scan_project(temporary.path(), &AtomicBool::new(false)).unwrap();
        assert_eq!(result.len(), 3);
        let shared = result
            .iter()
            .find(|skill| skill.path.contains(".agents"))
            .unwrap();
        assert_eq!(shared.consumers, vec!["codex", "cursor"]);
        let nested = result
            .iter()
            .find(|skill| skill.path.contains(".claude"))
            .unwrap();
        assert!(nested.scope_path.ends_with("中文项目"));
        assert!(nested.consumers.contains(&"cursor".into()));
        assert_eq!(
            result
                .iter()
                .find(|skill| skill.path.contains("broken"))
                .unwrap()
                .status,
            "invalid"
        );
    }

    #[test]
    fn discovery_recognizes_git_files_and_depth_limits() {
        let temporary = tempfile::tempdir().unwrap();
        let project = temporary.path().join("worktree");
        fs::create_dir(&project).unwrap();
        fs::write(
            project.join(".git"),
            "gitdir: ../repository/.git/worktrees/example",
        )
        .unwrap();
        assert!(
            discover_projects(temporary.path(), 0, &AtomicBool::new(false))
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            discover_projects(temporary.path(), 1, &AtomicBool::new(false))
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            discover_projects(temporary.path(), 13, &AtomicBool::new(false))
                .unwrap_err()
                .code,
            "InvalidDepth"
        );
        assert_eq!(
            scan_project(temporary.path(), &AtomicBool::new(true))
                .unwrap_err()
                .code,
            "Cancelled"
        );
    }

    #[test]
    fn nested_registration_includes_repository_ancestors_only() {
        let temporary = tempfile::tempdir().unwrap();
        let repository = temporary.path().join("repository");
        fs::create_dir_all(repository.join("apps/web")).unwrap();
        fs::create_dir(repository.join(".git")).unwrap();
        write_skill(&repository, ".agents/skills/example");
        write_skill(&repository, "apps/other/.cursor/skills/example");
        let result = scan_project(&repository.join("apps/web"), &AtomicBool::new(false)).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0].scope_path,
            display_path(&fs::canonicalize(&repository).unwrap())
        );
        assert!(
            result[0]
                .diagnostics
                .iter()
                .any(|message| message.contains("继承"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn broken_skill_link_is_reported_but_workspace_cycle_is_not_followed() {
        let temporary = tempfile::tempdir().unwrap();
        fs::create_dir_all(temporary.path().join(".agents/skills")).unwrap();
        std::os::unix::fs::symlink(
            "/nonexistent-askills-test-path",
            temporary.path().join(".agents/skills/broken"),
        )
        .unwrap();
        std::os::unix::fs::symlink(temporary.path(), temporary.path().join("cycle")).unwrap();
        let result = scan_project(temporary.path(), &AtomicBool::new(false)).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].status, "broken");
    }
}
