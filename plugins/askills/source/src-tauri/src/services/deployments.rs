//! Project installations are planned in SQLite and applied using a recoverable journal.
//! No path or plan supplied by the webview is trusted as a write destination.

use crate::{
    domain::{AppError, Result, Revision},
    platform::fs as safe_fs,
    storage::Store,
};
use fs2::FileExt;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

mod filesystem;
mod library_migration;
pub use library_migration::{preflight_library_migration, relocate_library};
#[cfg(test)]
mod tests;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deployment {
    pub id: String,
    pub project_id: String,
    pub skill_id: String,
    pub revision_id: String,
    pub name: String,
    pub agent: String,
    pub mode: String,
    pub target_path: String,
    pub previous_revision_id: Option<String>,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub project_id: String,
    pub revision_id: String,
    pub skill_id: String,
    pub name: String,
    pub agent: String,
    pub mode: String,
    pub target_path: String,
    pub previous_revision_id: Option<String>,
    pub conflict: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct SavedDeployment {
    view: Deployment,
    revision_path: String,
    hash: String,
    identity: String,
}

#[derive(Deserialize, Serialize)]
struct SavedPlan {
    view: Plan,
    project_path: String,
    revision_path: String,
    hash: String,
    before: Option<SavedDeployment>,
    lock_before: Option<String>,
    created: u64,
}

#[derive(Clone, Deserialize, Serialize)]
struct Journal {
    id: String,
    project_id: String,
    project_path: String,
    target: String,
    before: Option<SavedDeployment>,
    after: Option<SavedDeployment>,
    lock_before: Option<String>,
    lock_after: String,
    lock_old_identity: Option<String>,
    lock_new_identity: Option<String>,
}

#[derive(Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectLock {
    schema_version: u32,
    generator: String,
    skills: Vec<LockEntry>,
}

#[derive(Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LockEntry {
    name: String,
    agent: String,
    target: String,
    mode: String,
    content_hash: String,
    source_kind: String,
    repository: Option<String>,
    reference: Option<String>,
    commit: Option<String>,
    subpath: Option<String>,
}

fn error(code: &str, message: impl Into<String>) -> AppError {
    AppError::new(code, message)
}
fn io(error: std::io::Error) -> AppError {
    AppError::new("FileSystemError", error.to_string())
}
fn sql(error: rusqlite::Error) -> AppError {
    AppError::new("StorageError", error.to_string())
}
fn json(error: serde_json::Error) -> AppError {
    AppError::new("InvalidState", error.to_string())
}
fn serialize<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(json)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}
fn cancelled(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(error("Cancelled", "操作已取消"))
    } else {
        Ok(())
    }
}

pub fn initialize(store: &Store) -> Result<()> {
    store.conn.execute_batch("CREATE TABLE IF NOT EXISTS askills_deployments (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, target_path TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS askills_deployment_plans (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS askills_deployment_journal (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, phase TEXT NOT NULL, payload TEXT NOT NULL, error TEXT);")
        .map_err(sql)
}

fn saved_list(store: &Store) -> Result<Vec<SavedDeployment>> {
    initialize(store)?;
    let mut statement = store
        .conn
        .prepare("SELECT payload FROM askills_deployments ORDER BY target_path")
        .map_err(sql)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(sql)?;
    rows.map(|row| serde_json::from_str(&row.map_err(sql)?).map_err(json))
        .collect()
}

#[cfg(test)]
pub fn list(store: &Store) -> Result<Vec<Deployment>> {
    list_cancellable(store, &AtomicBool::new(false))
}

pub fn list_cancellable(store: &Store, cancel: &AtomicBool) -> Result<Vec<Deployment>> {
    cancelled(cancel)?;
    let mut output = Vec::new();
    for saved in saved_list(store)? {
        cancelled(cancel)?;
        let mut view = saved.view.clone();
        if let Err(issue) =
            filesystem::verify_entry_cancellable(Path::new(&view.target_path), &saved, cancel)
        {
            if issue.code == "Cancelled" {
                return Err(issue);
            }
            view.status = issue.code;
        }
        output.push(view);
    }
    cancelled(cancel)?;
    Ok(output)
}

fn get_saved(store: &Store, id: &str) -> Result<SavedDeployment> {
    initialize(store)?;
    let value: Option<String> = store
        .conn
        .query_row(
            "SELECT payload FROM askills_deployments WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql)?;
    serde_json::from_str(&value.ok_or_else(|| error("NotFound", "找不到项目安装记录"))?)
        .map_err(json)
}

fn target(project: &Path, name: &str, agent: &str) -> Result<PathBuf> {
    if name.is_empty()
        || name.chars().count() > 64
        || name.starts_with('-')
        || name.ends_with('-')
        || name.contains("--")
        || !name
            .chars()
            .all(|c| c == '-' || (c.is_alphanumeric() && !c.is_uppercase()))
    {
        return Err(error(
            "InvalidSkillName",
            "skill 名称必须是安全的小写字母、数字和连字符",
        ));
    }
    let upper = name.to_ascii_uppercase();
    if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&upper.as_str())
    {
        return Err(error(
            "InvalidSkillName",
            "skill 名称与 Windows 保留设备名称冲突",
        ));
    }
    let directory = match agent {
        "codex" => ".agents",
        "cursor" => ".cursor",
        "claude-code" => ".claude",
        _ => return Err(error("UnsupportedAgent", "不支持此 Agent")),
    };
    Ok(project.join(directory).join("skills").join(name))
}

fn check_mode(mode: &str) -> Result<()> {
    if ["auto", "copy", "symlink", "junction"].contains(&mode) {
        Ok(())
    } else {
        Err(error("InvalidMode", "未知安装方式"))
    }
}

fn check_revision(store: &Store, revision: &Revision, cancel: &AtomicBool) -> Result<()> {
    let path = Path::new(&revision.path);
    safe_fs::assert_safe_path(path)?;
    let real = fs::canonicalize(path).map_err(io)?;
    let root = fs::canonicalize(&store.library_root).map_err(io)?;
    if !real.starts_with(&root) || real == root {
        return Err(error("UnsafePath", "skill 版本不在授权 skills 库内"));
    }
    if safe_fs::hash_tree(path, cancel)? != revision.hash {
        return Err(error(
            "RevisionModified",
            "skills 库版本已被外部修改，请重新导入后再安装",
        ));
    }
    Ok(())
}

fn lock_document(
    store: &Store,
    project_id: &str,
    replacement: Option<&SavedDeployment>,
    remove_id: Option<&str>,
) -> Result<ProjectLock> {
    lock_document_with(store, project_id, replacement, remove_id, Store::revision)
}

fn lock_document_with(
    store: &Store,
    project_id: &str,
    replacement: Option<&SavedDeployment>,
    remove_id: Option<&str>,
    read_revision: fn(&Store, &str) -> Result<Revision>,
) -> Result<ProjectLock> {
    let mut entries = saved_list(store)?;
    if let Some(id) = remove_id {
        entries.retain(|entry| entry.view.id != id);
    }
    if let Some(value) = replacement {
        entries.retain(|entry| entry.view.id != value.view.id);
        entries.push(value.clone());
    }
    let project = store.project(project_id)?;
    let mut skills = Vec::new();
    for entry in entries
        .into_iter()
        .filter(|entry| entry.view.project_id == project_id)
    {
        let revision = read_revision(store, &entry.view.revision_id)?;
        let relative = Path::new(&entry.view.target_path)
            .strip_prefix(&project.path)
            .map_err(|_| error("UnsafePath", "安装路径不属于记录的项目"))?
            .to_string_lossy()
            .replace('\\', "/");
        skills.push(LockEntry {
            name: entry.view.name,
            agent: entry.view.agent,
            target: relative,
            mode: entry.view.mode,
            content_hash: entry.hash,
            source_kind: revision.source.kind,
            repository: revision.source.url,
            reference: revision.source.reference,
            commit: revision.source.commit,
            subpath: revision.source.subpath,
        });
    }
    skills.sort_by(|left, right| left.target.cmp(&right.target));
    Ok(ProjectLock {
        schema_version: 1,
        generator: "askills".into(),
        skills,
    })
}

fn read_lock(path: &Path) -> Result<Option<String>> {
    safe_fs::assert_safe_path(path)?;
    match fs::metadata(path) {
        Ok(meta) => {
            if !meta.is_file() || meta.len() > 4 * 1024 * 1024 {
                return Err(error("LockConflict", "项目锁文件不是有效的小型普通文件"));
            }
            Ok(Some(safe_fs::read_text(path)?))
        }
        Err(issue) if issue.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(issue) => Err(io(issue)),
    }
}

fn validate_lock(store: &Store, project_id: &str, project: &Path) -> Result<Option<String>> {
    validate_lock_with(store, project_id, project, Store::revision)
}

fn validate_lock_with(
    store: &Store,
    project_id: &str,
    project: &Path,
    read_revision: fn(&Store, &str) -> Result<Revision>,
) -> Result<Option<String>> {
    let current = read_lock(&project.join("askills.lock.json"))?;
    let expected = lock_document_with(store, project_id, None, None, read_revision)?;
    match current.as_ref() {
        Some(text) => {
            let parsed: ProjectLock = serde_json::from_str(text).map_err(|_| {
                error(
                    "LockConflict",
                    "已有 askills.lock.json 包含未知格式或字段，不能覆盖",
                )
            })?;
            if parsed != expected {
                return Err(error(
                    "LockConflict",
                    "项目锁文件与本机受管理记录不一致，请先处理差异",
                ));
            }
        }
        None if !expected.skills.is_empty() => {
            return Err(error("LockConflict", "项目锁文件已被移除，停止覆盖安装"));
        }
        None => (),
    }
    Ok(current)
}

fn project_guard(store: &Store, project_id: &str) -> Result<fs::File> {
    let parsed =
        Uuid::parse_str(project_id).map_err(|_| error("InvalidProject", "项目 ID 无效"))?;
    let directory = store.data_dir.join("deployment-locks");
    safe_fs::assert_safe_path(&directory)?;
    fs::create_dir_all(&directory).map_err(io)?;
    let path = directory.join(format!("{parsed}.lock"));
    safe_fs::assert_safe_path(&path)?;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(io)?;
    file.try_lock_exclusive()
        .map_err(|_| error("ProjectBusy", "其他 Askills 进程正在修改此项目"))?;
    Ok(file)
}

fn no_pending(store: &Store, project_id: &str) -> Result<()> {
    let count: i64 = store.conn.query_row("SELECT COUNT(*) FROM askills_deployment_journal WHERE project_id=?1 AND phase NOT IN ('complete','rolled_back')", [project_id], |row| row.get(0)).map_err(sql)?;
    if count > 0 {
        Err(error(
            "RecoveryRequired",
            "此项目有待恢复的安装操作，请先恢复",
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
pub fn plan(
    store: &Store,
    project_id: &str,
    revision_id: &str,
    agent: &str,
    mode: &str,
) -> Result<Plan> {
    plan_cancellable(
        store,
        project_id,
        revision_id,
        agent,
        mode,
        &AtomicBool::new(false),
    )
}

pub fn plan_cancellable(
    store: &Store,
    project_id: &str,
    revision_id: &str,
    agent: &str,
    mode: &str,
    cancel: &AtomicBool,
) -> Result<Plan> {
    cancelled(cancel)?;
    initialize(store)?;
    check_mode(mode)?;
    let _guard = project_guard(store, project_id)?;
    no_pending(store, project_id)?;
    let project = store.project(project_id)?;
    let project_path = Path::new(&project.path);
    safe_fs::assert_safe_path(project_path)?;
    if !project_path.is_dir() {
        return Err(error("ProjectOffline", "项目目录不可用"));
    }
    let revision = store.revision(revision_id)?;
    check_revision(store, &revision, cancel)?;
    let (name, _, _) = crate::services::library::parse_frontmatter(&safe_fs::read_text(
        &Path::new(&revision.path).join("SKILL.md"),
    )?)?;
    let path = target(project_path, &name, agent)?;
    safe_fs::assert_safe_path(
        path.parent()
            .ok_or_else(|| error("UnsafePath", "安装路径没有父目录"))?,
    )?;
    let library_root = fs::canonicalize(&store.library_root).map_err(io)?;
    let data_root = fs::canonicalize(&store.data_dir).map_err(io)?;
    let project_root = fs::canonicalize(project_path).map_err(io)?;
    if project_root.starts_with(&library_root) || project_root.starts_with(&data_root) {
        return Err(error(
            "UnsafePath",
            "不能将 Askills 数据目录或 skills 库作为部署项目",
        ));
    }
    let before = saved_list(store)?
        .into_iter()
        .find(|entry| Path::new(&entry.view.target_path) == path);
    let conflict = if let Some(existing) = before.as_ref() {
        if existing.view.skill_id != revision.skill_id {
            Some("此名称已由不同来源的 skill 使用".into())
        } else {
            match filesystem::verify_entry_cancellable(&path, existing, cancel) {
                Ok(()) => None,
                Err(issue) if issue.code == "Cancelled" => return Err(issue),
                Err(issue) => Some(issue.message),
            }
        }
    } else if fs::symlink_metadata(&path).is_ok() {
        Some("目标位置存在非 Askills 管理的内容，将保留原文件".into())
    } else {
        None
    };
    let lock_before = validate_lock(store, project_id, project_path)?;
    let view = Plan {
        id: Uuid::new_v4().to_string(),
        project_id: project_id.into(),
        revision_id: revision_id.into(),
        skill_id: revision.skill_id,
        name,
        agent: agent.into(),
        mode: mode.into(),
        target_path: path.to_string_lossy().into_owned(),
        previous_revision_id: before.as_ref().map(|entry| entry.view.revision_id.clone()),
        conflict,
        warnings: vec![
            "链接绑定固定版本；绝对链接无法随 Git 移到其他电脑。".into(),
            if agent == "codex" {
                "Cursor 也可能读取 .agents/skills 中的 skill。".into()
            } else {
                "安装结果仍需在对应 Agent 中刷新并验证。".into()
            },
        ],
    };
    let saved = SavedPlan {
        view: view.clone(),
        project_path: project.path,
        revision_path: revision.path,
        hash: revision.hash,
        before,
        lock_before,
        created: now(),
    };
    cancelled(cancel)?;
    store
        .conn
        .execute(
            "INSERT INTO askills_deployment_plans(id,payload) VALUES(?1,?2)",
            params![view.id, serialize(&saved)?],
        )
        .map_err(sql)?;
    Ok(view)
}

fn journal_save(store: &Store, journal: &Journal, phase: &str, issue: Option<&str>) -> Result<()> {
    store.conn.execute("INSERT INTO askills_deployment_journal(id,project_id,phase,payload,error) VALUES(?1,?2,?3,?4,?5)
        ON CONFLICT(id) DO UPDATE SET phase=excluded.phase,payload=excluded.payload,error=excluded.error",
        params![journal.id, journal.project_id, phase, serialize(journal)?, issue]).map_err(sql)?;
    Ok(())
}

fn verify_before(journal: &Journal) -> Result<()> {
    let destination = Path::new(&journal.target);
    safe_fs::assert_safe_path(
        destination
            .parent()
            .ok_or_else(|| error("UnsafePath", "目标没有父目录"))?,
    )?;
    match journal.before.as_ref() {
        Some(before) => filesystem::verify_entry(destination, before)?,
        None => filesystem::must_not_exist(destination)?,
    }
    if read_lock(&Path::new(&journal.project_path).join("askills.lock.json"))?
        != journal.lock_before
    {
        return Err(error("PlanExpired", "预览后项目锁文件发生改变"));
    }
    Ok(())
}

pub fn apply(store: &mut Store, plan_id: &str, cancel: &AtomicBool) -> Result<Deployment> {
    initialize(store)?;
    let raw: Option<String> = store
        .conn
        .query_row(
            "SELECT payload FROM askills_deployment_plans WHERE id=?1",
            [plan_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql)?;
    let saved: SavedPlan = serde_json::from_str(
        &raw.ok_or_else(|| error("PlanExpired", "安装计划不存在或已使用，请重新预览"))?,
    )
    .map_err(json)?;
    if now().saturating_sub(saved.created) > 1800 {
        return Err(error("PlanExpired", "安装预览超过 30 分钟，请重新预览"));
    }
    if let Some(conflict) = saved.view.conflict {
        return Err(error("PathConflict", conflict));
    }
    let _guard = project_guard(store, &saved.view.project_id)?;
    no_pending(store, &saved.view.project_id)?;
    let project = store.project(&saved.view.project_id)?;
    if project.path != saved.project_path {
        return Err(error("PlanExpired", "项目路径已变化"));
    }
    let revision = store.revision(&saved.view.revision_id)?;
    if revision.path != saved.revision_path || revision.hash != saved.hash {
        return Err(error("PlanExpired", "skill 版本已变化"));
    }
    check_revision(store, &revision, cancel)?;
    let current = saved_list(store)?
        .into_iter()
        .find(|entry| entry.view.target_path == saved.view.target_path);
    if serialize(&current)? != serialize(&saved.before)? {
        return Err(error("PlanExpired", "项目安装记录在预览后已变化"));
    }
    let expected_target = target(
        Path::new(&project.path),
        &saved.view.name,
        &saved.view.agent,
    )?;
    if expected_target != Path::new(&saved.view.target_path) {
        return Err(error("UnsafePath", "计划安装路径无效"));
    }
    let view = Deployment {
        id: saved
            .before
            .as_ref()
            .map_or_else(|| Uuid::new_v4().to_string(), |old| old.view.id.clone()),
        project_id: saved.view.project_id.clone(),
        skill_id: saved.view.skill_id,
        revision_id: saved.view.revision_id,
        name: saved.view.name,
        agent: saved.view.agent,
        mode: saved.view.mode,
        target_path: saved.view.target_path.clone(),
        previous_revision_id: saved
            .before
            .as_ref()
            .map(|old| old.view.revision_id.clone()),
        status: "installed".into(),
    };
    let after = SavedDeployment {
        view,
        revision_path: revision.path,
        hash: revision.hash,
        identity: String::new(),
    };
    let mut journal = Journal {
        id: Uuid::new_v4().to_string(),
        project_id: saved.view.project_id,
        project_path: project.path,
        target: saved.view.target_path,
        before: saved.before,
        after: Some(after),
        lock_before: saved.lock_before,
        lock_after: String::new(),
        lock_old_identity: None,
        lock_new_identity: None,
    };
    verify_before(&journal)?;
    cancelled(cancel)?;
    journal_save(store, &journal, "prepared", None)?;
    let outcome = execute(store, &mut journal, cancel);
    store
        .conn
        .execute(
            "DELETE FROM askills_deployment_plans WHERE id=?1",
            [plan_id],
        )
        .map_err(sql)?;
    match outcome {
        Ok(()) => Ok(journal
            .after
            .ok_or_else(|| error("InvalidState", "安装结果缺失"))?
            .view),
        Err(issue) => {
            record_failure(store, &journal, &issue);
            Err(issue)
        }
    }
}

fn execute(store: &mut Store, journal: &mut Journal, cancel: &AtomicBool) -> Result<()> {
    execute_with_lock(store, journal, cancel, None)
}

fn execute_with_lock(
    store: &mut Store,
    journal: &mut Journal,
    cancel: &AtomicBool,
    unchanged_lock: Option<&str>,
) -> Result<()> {
    let paths = filesystem::Paths::new(journal)?;
    safe_fs::assert_safe_path(&paths.parent)?;
    fs::create_dir_all(&paths.parent).map_err(io)?;
    for path in [
        &paths.temp,
        &paths.backup,
        &paths.lock_temp,
        &paths.lock_backup,
    ] {
        filesystem::must_not_exist(path)?;
    }
    if let Some(after) = journal.after.as_ref() {
        let source = PathBuf::from(&after.revision_path);
        let requested = after.view.mode.clone();
        filesystem::prepare_entry(
            &paths.temp,
            &source,
            &requested,
            cancel,
            |mode, identity| {
                let after = journal
                    .after
                    .as_mut()
                    .ok_or_else(|| error("InvalidState", "安装记录缺失"))?;
                after.view.mode = mode.to_owned();
                after.identity = identity;
                journal_save(store, journal, "preparing", None)
            },
        )?;
        filesystem::verify_entry(
            &paths.temp,
            journal
                .after
                .as_ref()
                .ok_or_else(|| error("InvalidState", "安装记录缺失"))?,
        )?;
    }
    journal.lock_after = if let Some(content) = unchanged_lock {
        content.to_owned()
    } else {
        serde_json::to_string_pretty(&lock_document(
            store,
            &journal.project_id,
            journal.after.as_ref(),
            journal.before.as_ref().map(|old| old.view.id.as_str()),
        )?)
        .map_err(json)?
            + "\n"
    };
    if journal.lock_before.is_some() {
        journal.lock_old_identity = Some(filesystem::identity(&paths.lock)?);
    }
    let lock_text = journal.lock_after.clone();
    filesystem::prepare_lock(&paths.lock_temp, lock_text.as_bytes(), |identity| {
        journal.lock_new_identity = Some(identity);
        journal_save(store, journal, "preparing_lock", None)
    })?;
    journal_save(store, journal, "ready", None)?;
    cancelled(cancel)?;
    verify_before(journal)?;
    journal_save(store, journal, "applying", None)?;
    if journal.before.is_some() {
        fs::rename(&paths.target, &paths.backup).map_err(io)?;
    }
    if journal.after.is_some() {
        fs::rename(&paths.temp, &paths.target).map_err(io)?;
    }
    if let Some(after) = journal.after.as_ref() {
        filesystem::verify_entry(&paths.target, after)?;
    }
    if journal.lock_before.is_some() {
        if filesystem::identity(&paths.lock)?
            != journal.lock_old_identity.clone().unwrap_or_default()
        {
            return Err(error("LocalChangesDetected", "项目锁文件被替换"));
        }
        fs::rename(&paths.lock, &paths.lock_backup).map_err(io)?;
    }
    fs::rename(&paths.lock_temp, &paths.lock).map_err(io)?;
    journal_save(store, journal, "verifying", None)?;
    if read_lock(&paths.lock)?.as_deref() != Some(journal.lock_after.as_str()) {
        return Err(error("LocalChangesDetected", "项目锁文件在应用时变化"));
    }
    // The operation's committed phase and binding are stored in one SQLite transaction.
    let transaction = store.conn.transaction().map_err(sql)?;
    if let Some(before) = journal.before.as_ref() {
        transaction
            .execute(
                "DELETE FROM askills_deployments WHERE id=?1",
                [&before.view.id],
            )
            .map_err(sql)?;
    }
    if let Some(after) = journal.after.as_ref() {
        transaction.execute("INSERT INTO askills_deployments(id,project_id,target_path,payload) VALUES(?1,?2,?3,?4)",
            params![after.view.id, after.view.project_id, after.view.target_path, serialize(after)?]).map_err(sql)?;
    }
    transaction
        .execute(
            "UPDATE askills_deployment_journal SET phase='committed',payload=?2 WHERE id=?1",
            params![journal.id, serialize(journal)?],
        )
        .map_err(sql)?;
    transaction.commit().map_err(sql)?;
    // Cleanup failure must never roll back an already committed database transaction.
    match filesystem::cleanup(journal) {
        Ok(()) => {
            let _ = journal_save(store, journal, "complete", None);
        }
        Err(issue) => {
            let _ = journal_save(store, journal, "committed", Some(&issue.message));
        }
    }
    Ok(())
}

fn record_failure(store: &Store, journal: &Journal, issue: &AppError) {
    match filesystem::restore(journal) {
        Ok(()) => {
            let _ = journal_save(store, journal, "rolled_back", Some(&issue.message));
        }
        Err(recovery) => {
            let _ = journal_save(
                store,
                journal,
                "rollback_required",
                Some(&format!(
                    "{}；恢复失败：{}",
                    issue.message, recovery.message
                )),
            );
        }
    }
}

pub fn uninstall(store: &mut Store, id: &str, cancel: &AtomicBool) -> Result<()> {
    let before = get_saved(store, id)?;
    let _guard = project_guard(store, &before.view.project_id)?;
    no_pending(store, &before.view.project_id)?;
    let project = store.project(&before.view.project_id)?;
    let lock_before = validate_lock(store, &project.id, Path::new(&project.path))?;
    let mut journal = Journal {
        id: Uuid::new_v4().to_string(),
        project_id: project.id,
        project_path: project.path,
        target: before.view.target_path.clone(),
        before: Some(before),
        after: None,
        lock_before,
        lock_after: String::new(),
        lock_old_identity: None,
        lock_new_identity: None,
    };
    verify_before(&journal)?;
    cancelled(cancel)?;
    journal_save(store, &journal, "prepared", None)?;
    match execute(store, &mut journal, cancel) {
        Ok(()) => Ok(()),
        Err(issue) => {
            record_failure(store, &journal, &issue);
            Err(issue)
        }
    }
}

pub fn rollback(store: &mut Store, id: &str, cancel: &AtomicBool) -> Result<Deployment> {
    let before = get_saved(store, id)?;
    let previous = before
        .view
        .previous_revision_id
        .as_ref()
        .ok_or_else(|| error("NoPreviousRevision", "此安装没有可回滚版本"))?;
    let preview = plan_cancellable(
        store,
        &before.view.project_id,
        previous,
        &before.view.agent,
        &before.view.mode,
        cancel,
    )?;
    apply(store, &preview.id, cancel)
}

pub fn recover(store: &mut Store) -> Result<Vec<String>> {
    initialize(store)?;
    let pending: Vec<(String, Journal)> = {
        let mut statement = store.conn.prepare("SELECT phase,payload FROM askills_deployment_journal WHERE phase NOT IN ('complete','rolled_back') ORDER BY rowid").map_err(sql)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(sql)?;
        rows.map(|row| {
            let (phase, payload) = row.map_err(sql)?;
            Ok((phase, serde_json::from_str(&payload).map_err(json)?))
        })
        .collect::<Result<_>>()?
    };
    let mut notices = Vec::new();
    for (phase, journal) in pending {
        let attempt = (|| -> Result<()> {
            let _guard = project_guard(store, &journal.project_id)?;
            let project = store.project(&journal.project_id)?;
            if project.path != journal.project_path {
                return Err(error("ProjectMoved", "项目路径改变，需要手动恢复"));
            }
            if phase == "committed" {
                filesystem::cleanup(&journal)?;
                journal_save(store, &journal, "complete", None)?;
            } else {
                filesystem::restore(&journal)?;
                journal_save(store, &journal, "rolled_back", None)?;
            }
            Ok(())
        })();
        match attempt {
            Ok(()) => notices.push(format!("已恢复操作 {}", journal.id)),
            Err(issue) => notices.push(format!("操作 {} 需要处理：{}", journal.id, issue.message)),
        }
    }
    Ok(notices)
}
