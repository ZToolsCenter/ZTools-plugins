use crate::domain::{
    AppError, Project, Result, Revision, Skill, SkillDocument, SkillSource, now_string,
};
use crate::platform::fs::{
    assert_safe_path, atomic_write, canonical_directory, check_cancel, copy_tree, display_path,
    hash_tree, is_link, read_text, remove_tree,
};
use crate::services::library::inspect_skill;
use fs2::FileExt;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::AtomicBool;
use uuid::Uuid;

mod appearance;
mod legacy;
mod locale;
mod management;
mod migration;
mod repository_history;
pub use appearance::{Appearance, ThemeMode};
pub use legacy::inherit_legacy_data;
pub use locale::Locale;
pub use migration::{LibraryMigrationPlan, LibraryMigrationResult};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryIdentity {
    schema_version: u32,
    id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    schema_version: u32,
    library_root: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillManifest {
    schema_version: u32,
    skill: Skill,
    revisions: Vec<Revision>,
}

pub struct Store {
    pub(crate) conn: Connection,
    pub library_root: PathBuf,
    pub data_dir: PathBuf,
    library_id: String,
    _data_lock: File,
    _library_lock: File,
}

fn open_lock(path: &Path) -> Result<File> {
    assert_safe_path(path)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    FileExt::try_lock_exclusive(&file).map_err(|_| {
        AppError::new(
            "LibraryBusy",
            "此数据目录或 skills 库正在被另一个 Askills 实例使用",
        )
    })?;
    Ok(file)
}

fn path_key(path: &Path) -> String {
    // Callers canonicalize filesystem paths first. Preserve case: Windows can enable
    // case-sensitive directories, so lowercasing can alias two distinct projects.
    display_path(path)
}

fn safe_library_root(path: &Path) -> Result<()> {
    assert_safe_path(path)?;
    if path.parent().is_none()
        || !path
            .components()
            .any(|component| matches!(component, Component::Normal(_)))
    {
        return Err(AppError::new(
            "UnsafeLibraryRoot",
            "skills 库不能是磁盘根目录",
        ));
    }
    let dangerous = [
        ".git",
        ".ssh",
        ".aws",
        ".codex",
        ".cursor",
        ".claude",
        ".agents",
        "windows",
        "system32",
        "program files",
        "program files (x86)",
    ];
    if path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| dangerous.contains(&name.to_ascii_lowercase().as_str()))
    {
        return Err(AppError::new(
            "UnsafeLibraryRoot",
            "请选择专用 skills 库目录，不要使用系统、凭据或 Agent 配置目录",
        ));
    }
    for variable in ["HOME", "USERPROFILE"] {
        if let Some(home) = std::env::var_os(variable)
            && path_key(path) == path_key(Path::new(&home))
        {
            return Err(AppError::new(
                "UnsafeLibraryRoot",
                "skills 库不能是用户主目录本身",
            ));
        }
    }
    Ok(())
}

fn initialize_library(path: &Path) -> Result<(PathBuf, String, File)> {
    safe_library_root(path)?;
    if !path.exists() {
        fs::create_dir_all(path)?;
    }
    let root = canonical_directory(path)?;
    let marker = root.join("library.json");
    assert_safe_path(&marker)?;
    if !marker.exists() {
        for entry in fs::read_dir(&root)? {
            let entry = entry?;
            let metadata = fs::symlink_metadata(entry.path())?;
            // A crash after lock creation but before the first marker is recoverable.
            // Nothing else in an unmarked directory is treated as ours.
            if entry.file_name() != ".askills.lock" || !metadata.is_file() || is_link(&metadata) {
                return Err(AppError::new(
                    "DirectoryNotEmpty",
                    "目标目录包含现有内容；请选择空目录或已有 Askills skills 库",
                ));
            }
        }
    }
    let lock = open_lock(&root.join(".askills.lock"))?;
    let identity = if marker.exists() {
        let identity: LibraryIdentity = serde_json::from_str(&read_text(&marker)?)?;
        if identity.schema_version != 1 || Uuid::parse_str(&identity.id).is_err() {
            return Err(AppError::new(
                "InvalidLibrary",
                "skills 库标记无效或版本不受支持",
            ));
        }
        identity
    } else {
        let identity = LibraryIdentity {
            schema_version: 1,
            id: Uuid::new_v4().to_string(),
        };
        atomic_write(&marker, &serde_json::to_vec_pretty(&identity)?)?;
        identity
    };
    for child in ["skills", "staging", "trash", "local"] {
        let directory = root.join(child);
        assert_safe_path(&directory)?;
        fs::create_dir_all(directory)?;
    }
    Ok((root, identity.id, lock))
}

fn validate_uuid(value: &str) -> Result<()> {
    if Uuid::parse_str(value).is_err() || value.contains(['/', '\\']) {
        return Err(AppError::new("InvalidIdentifier", "内部标识不是有效 UUID"));
    }
    Ok(())
}

fn validate_hash(value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(AppError::new("InvalidHash", "内容摘要不是有效 SHA-256"));
    }
    Ok(())
}

fn normalize_source(mut source: SkillSource, input: &Path) -> Result<SkillSource> {
    match source.kind.as_str() {
        "local" => {
            source.local_path = Some(display_path(&canonical_directory(input)?));
            source.url = None;
            source.reference = None;
            source.commit = None;
            source.subpath = None;
        }
        "github" => {
            let mut url = url::Url::parse(source.url.as_deref().unwrap_or_default())
                .map_err(|_| AppError::new("InvalidSource", "GitHub 来源 URL 无效"))?;
            if url.scheme() != "https"
                || url.host_str() != Some("github.com")
                || !url.username().is_empty()
                || url.password().is_some()
                || url.port().is_some()
            {
                return Err(AppError::new(
                    "InvalidSource",
                    "GitHub 来源必须是无凭据的 https://github.com URL",
                ));
            }
            let repository = url
                .path()
                .trim_matches('/')
                .trim_end_matches(".git")
                .to_string();
            if repository.split('/').count() != 2 || repository.split('/').any(str::is_empty) {
                return Err(AppError::new(
                    "InvalidSource",
                    "来源 URL 必须精确指定 GitHub owner/repo",
                ));
            }
            url.set_path(&repository);
            url.set_query(None);
            url.set_fragment(None);
            source.url = Some(url.as_str().trim_end_matches('/').to_string());
            let commit = source.commit.as_deref().unwrap_or_default();
            if !matches!(commit.len(), 40 | 64)
                || !commit.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(AppError::new(
                    "InvalidSource",
                    "GitHub 导入必须固定完整 commit SHA",
                ));
            }
            source.commit = Some(commit.to_ascii_lowercase());
            let subpath = source
                .subpath
                .as_deref()
                .unwrap_or_default()
                .replace('\\', "/");
            if subpath.starts_with('/')
                || subpath.contains(':')
                || Path::new(&subpath)
                    .components()
                    .any(|part| !matches!(part, Component::Normal(_)))
            {
                return Err(AppError::new("InvalidSource", "GitHub skill 子路径不安全"));
            }
            source.subpath = Some(subpath);
            source.local_path = None;
        }
        _ => {
            return Err(AppError::new(
                "InvalidSource",
                "仅支持 local 或 github 来源",
            ));
        }
    }
    Ok(source)
}

fn source_key(source: &SkillSource) -> Result<String> {
    let local = source
        .local_path
        .as_ref()
        .map(|path| path_key(Path::new(path)));
    Ok(serde_json::to_string(&(
        &source.kind,
        source.url.as_ref().map(|url| url.to_lowercase()),
        &source.subpath,
        local,
    ))?)
}

impl Store {
    pub fn open(data_dir: &Path) -> Result<Self> {
        assert_safe_path(data_dir)?;
        fs::create_dir_all(data_dir)?;
        let data_dir = canonical_directory(data_dir)?;
        let data_lock = open_lock(&data_dir.join(".instance.lock"))?;
        let settings_path = data_dir.join("settings.json");
        let selected = if settings_path.exists() {
            let settings: Settings = serde_json::from_str(&read_text(&settings_path)?)?;
            if settings.schema_version != 1 {
                return Err(AppError::new("UnsupportedVersion", "设置文件版本不受支持"));
            }
            PathBuf::from(settings.library_root)
        } else {
            data_dir.join("library")
        };
        let (library_root, library_id, library_lock) = initialize_library(&selected)?;
        for name in ["askills.db", "askills.db-wal", "askills.db-shm"] {
            assert_safe_path(&data_dir.join(name))?;
        }
        let conn = Connection::open(data_dir.join("askills.db"))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version > 1 {
            return Err(AppError::new(
                "UnsupportedVersion",
                "数据库由更新版本创建，不能降级写入",
            ));
        }
        conn.execute_batch(
            "BEGIN IMMEDIATE;
             CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, json TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id), hash TEXT NOT NULL, source_version TEXT NOT NULL, json TEXT NOT NULL, UNIQUE(skill_id,hash,source_version));
             CREATE INDEX IF NOT EXISTS revisions_by_skill ON revisions(skill_id);
             CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, path_key TEXT NOT NULL UNIQUE, json TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS repository_history(position INTEGER PRIMARY KEY, repository TEXT NOT NULL UNIQUE);
             CREATE TABLE IF NOT EXISTS app_preferences(key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS removed_projects(id TEXT PRIMARY KEY REFERENCES projects(id));
             PRAGMA user_version=1;
             COMMIT;"
        )?;
        let mut store = Self {
            conn,
            library_root,
            data_dir,
            library_id,
            _data_lock: data_lock,
            _library_lock: library_lock,
        };
        store.recover_library_migration()?;
        store.recover_manifests()?;
        store.recover_staging()?;
        Ok(store)
    }

    fn verify_library(&self) -> Result<()> {
        assert_safe_path(&self.library_root)?;
        let identity: LibraryIdentity =
            serde_json::from_str(&read_text(&self.library_root.join("library.json"))?)?;
        if identity.id != self.library_id || identity.schema_version != 1 {
            return Err(AppError::new(
                "LibraryChanged",
                "skills 库目录已被外部替换，请重启并重新检查",
            ));
        }
        Ok(())
    }

    pub fn set_library_root(&mut self, path: &Path) -> Result<()> {
        self.migrate_library(path, &AtomicBool::new(false))
            .map(|_| ())
    }

    pub fn list_skills(&self) -> Result<Vec<Skill>> {
        let json = self
            .conn
            .prepare("SELECT json FROM skills ORDER BY id")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut skills = json
            .into_iter()
            .map(|text| serde_json::from_str::<Skill>(&text).map_err(AppError::from))
            .collect::<Result<Vec<_>>>()?;
        let removed = self.removed_skills()?;
        skills.retain(|skill| !removed.contains(&skill.id));
        skills.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
        Ok(skills)
    }

    pub fn skill(&self, id: &str) -> Result<Skill> {
        validate_uuid(id)?;
        let json: Option<String> = self
            .conn
            .query_row("SELECT json FROM skills WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()?;
        serde_json::from_str(&json.ok_or_else(|| AppError::new("SkillNotFound", "skill 不存在"))?)
            .map_err(Into::into)
    }

    pub fn list_revisions(&self, skill_id: &str) -> Result<Vec<Revision>> {
        self.skill(skill_id)?;
        let ids = self
            .conn
            .prepare("SELECT id FROM revisions WHERE skill_id=?1 ORDER BY rowid DESC")?
            .query_map([skill_id], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ids.iter().map(|id| self.revision(id)).collect()
    }

    pub fn revision(&self, id: &str) -> Result<Revision> {
        validate_uuid(id)?;
        let json: Option<String> = self
            .conn
            .query_row("SELECT json FROM revisions WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()?;
        let mut revision: Revision = serde_json::from_str(
            &json.ok_or_else(|| AppError::new("RevisionNotFound", "版本不存在"))?,
        )?;
        self.validate_revision(&revision)?;
        revision.path = display_path(&self.expected_revision_path(&revision)?);
        Ok(revision)
    }

    fn expected_revision_path(&self, revision: &Revision) -> Result<PathBuf> {
        validate_uuid(&revision.id)?;
        validate_uuid(&revision.skill_id)?;
        validate_hash(&revision.hash)?;
        Ok(self
            .library_root
            .join("skills")
            .join(&revision.skill_id)
            .join("revisions")
            .join(&revision.hash))
    }

    fn validate_revision(&self, revision: &Revision) -> Result<()> {
        self.verify_library()?;
        let expected = self.expected_revision_path(revision)?;
        if path_key(Path::new(&revision.path)) != path_key(&expected) {
            return Err(AppError::new(
                "InvalidRevisionPath",
                "版本路径与 skills 库目录不匹配",
            ));
        }
        canonical_directory(&expected)?;
        Ok(())
    }

    #[cfg(test)]
    pub fn read_revision(&self, id: &str) -> Result<SkillDocument> {
        self.read_revision_cancellable(id, &AtomicBool::new(false))
    }

    pub fn read_revision_cancellable(
        &self,
        id: &str,
        cancel: &AtomicBool,
    ) -> Result<SkillDocument> {
        check_cancel(cancel)?;
        let revision = self.revision(id)?;
        let preview = inspect_skill(Path::new(&revision.path), cancel)?;
        if preview.hash != revision.hash {
            return Err(AppError::new(
                "DriftDetected",
                "skills 库版本已被外部修改，停止读取受信版本；请重新导入来源",
            ));
        }
        let skill = self.skill(&revision.skill_id)?;
        let warnings = preview
            .warnings
            .into_iter()
            .filter(|warning| !warning.starts_with("来源目录名与 name 不同"))
            .collect();
        Ok(SkillDocument {
            skill,
            revision,
            markdown: preview.markdown,
            warnings,
        })
    }

    pub fn import_local(
        &self,
        path: &Path,
        source: Option<SkillSource>,
        expected_hash: Option<&str>,
        cancel: &AtomicBool,
    ) -> Result<Skill> {
        self.verify_library()?;
        check_cancel(cancel)?;
        let path = canonical_directory(path)?;
        let preview = inspect_skill(&path, cancel)?;
        if expected_hash.is_some_and(|expected| expected != preview.hash) {
            return Err(AppError::new(
                "PreviewExpired",
                "源内容与预览不同，请重新预览后导入",
            ));
        }
        let source = normalize_source(
            source.unwrap_or_else(|| SkillSource {
                kind: "local".into(),
                ..Default::default()
            }),
            &path,
        )?;
        let key = source_key(&source)?;
        let existing: Option<String> = self
            .conn
            .query_row("SELECT id FROM skills WHERE source_key=?1", [&key], |row| {
                row.get(0)
            })
            .optional()?;
        let mut skill = if let Some(id) = existing {
            self.skill(&id)?
        } else {
            Skill {
                id: Uuid::new_v4().to_string(),
                name: preview.name.clone(),
                display_name: None,
                description: preview.description.clone(),
                license: preview.license.clone(),
                latest_revision_id: String::new(),
                source: source.clone(),
                revision_count: 0,
                created_at: now_string(),
            }
        };
        if skill.name != preview.name {
            return Err(AppError::new(
                "SkillIdentityChanged",
                "同一来源的 name 已改变；此版本不支持跨版本重命名，请先核对来源或将改名内容保存到独立本地目录后导入",
            ));
        }
        let mut revisions = if skill.revision_count > 0 {
            self.list_revisions(&skill.id)?
        } else {
            Vec::new()
        };
        let source_version = source
            .commit
            .clone()
            .unwrap_or_else(|| preview.hash.clone());
        let existing_revision = revisions
            .iter()
            .find(|revision| {
                revision.hash == preview.hash && revision.source.commit == source.commit
            })
            .cloned();
        let revision = if let Some(revision) = existing_revision {
            if hash_tree(Path::new(&revision.path), cancel)? != revision.hash {
                return Err(AppError::new(
                    "DriftDetected",
                    "已有同版本快照被修改，不能重复使用",
                ));
            }
            revision
        } else {
            let skill_root = self.library_root.join("skills").join(&skill.id);
            let revisions_root = skill_root.join("revisions");
            assert_safe_path(&revisions_root)?;
            fs::create_dir_all(&revisions_root)?;
            let destination = revisions_root.join(&preview.hash);
            assert_safe_path(&destination)?;
            if destination.exists() {
                if hash_tree(&destination, cancel)? != preview.hash {
                    return Err(AppError::new("DriftDetected", "目标快照目录存在不同内容"));
                }
            } else {
                let staging = self
                    .library_root
                    .join("staging")
                    .join(Uuid::new_v4().to_string());
                if let Err(error) = copy_tree(&path, &staging, cancel) {
                    let _ = remove_tree(&staging);
                    return Err(error);
                }
                let copied = inspect_skill(&staging, cancel);
                match copied {
                    Ok(copy) if copy.hash == preview.hash => {}
                    Ok(_) => {
                        let _ = remove_tree(&staging);
                        return Err(AppError::new("SourceChanged", "复制内容与预览不一致"));
                    }
                    Err(error) => {
                        let _ = remove_tree(&staging);
                        return Err(error);
                    }
                }
                if let Err(error) = check_cancel(cancel) {
                    let _ = remove_tree(&staging);
                    return Err(error);
                }
                assert_safe_path(&destination)?;
                fs::rename(&staging, &destination)?;
            }
            let revision = Revision {
                id: Uuid::new_v4().to_string(),
                skill_id: skill.id.clone(),
                hash: preview.hash.clone(),
                path: display_path(&destination),
                source: source.clone(),
                file_count: preview.file_count,
                total_bytes: preview.total_bytes,
                created_at: now_string(),
            };
            revisions.push(revision.clone());
            revision
        };
        skill.name = preview.name;
        skill.description = preview.description;
        skill.license = preview.license;
        skill.source = source;
        skill.latest_revision_id = revision.id.clone();
        skill.revision_count = revisions.len() as u64;
        self.write_manifest(&skill, &revisions)?;
        let transaction = self.conn.unchecked_transaction()?;
        transaction.execute("INSERT INTO skills(id,source_key,json) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET source_key=excluded.source_key,json=excluded.json",
            params![skill.id, key, serde_json::to_string(&skill)?])?;
        transaction.execute("INSERT OR IGNORE INTO revisions(id,skill_id,hash,source_version,json) VALUES(?1,?2,?3,?4,?5)",
            params![revision.id, skill.id, revision.hash, source_version, serde_json::to_string(&revision)?])?;
        transaction.commit()?;
        self.restore_skill(&skill.id)?;
        Ok(skill)
    }

    pub fn set_display_name(&self, id: &str, name: &str) -> Result<Skill> {
        self.verify_library()?;
        let name = name.trim();
        if name.chars().count() > 80 || name.chars().any(char::is_control) {
            return Err(AppError::new(
                "InvalidDisplayName",
                "显示名称最多 80 个字符，且不能包含换行或控制字符",
            ));
        }
        let mut skill = self.skill(id)?;
        skill.display_name = if name.is_empty() {
            None
        } else {
            Some(name.to_owned())
        };
        let revisions = self.list_revisions(id)?;
        // Follow the same manifest-first recovery protocol as imports. This changes
        // metadata only; revision bytes, source identity and deployment names stay fixed.
        self.write_manifest(&skill, &revisions)?;
        self.conn.execute(
            "UPDATE skills SET json=?2 WHERE id=?1",
            params![id, serde_json::to_string(&skill)?],
        )?;
        Ok(skill)
    }

    fn write_manifest(&self, skill: &Skill, revisions: &[Revision]) -> Result<()> {
        validate_uuid(&skill.id)?;
        let relative_revisions = revisions
            .iter()
            .map(|revision| {
                let mut relative = revision.clone();
                relative.path = format!("revisions/{}", revision.hash);
                relative
            })
            .collect();
        let manifest = SkillManifest {
            schema_version: 1,
            skill: skill.clone(),
            revisions: relative_revisions,
        };
        atomic_write(
            &self
                .library_root
                .join("skills")
                .join(&skill.id)
                .join("manifest.json"),
            &serde_json::to_vec_pretty(&manifest)?,
        )
    }

    fn recover_manifests(&self) -> Result<()> {
        self.verify_library()?;
        let root = self.library_root.join("skills");
        assert_safe_path(&root)?;
        for (index, entry) in fs::read_dir(root)?.enumerate() {
            if index >= 10_000 {
                return Err(AppError::new(
                    "LimitExceeded",
                    "skills 库超过 10,000 个 skill 目录",
                ));
            }
            let entry = entry?;
            if is_link(&fs::symlink_metadata(entry.path())?) {
                return Err(AppError::new("UnsafeLink", "skills 库中出现链接目录"));
            }
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let manifest_path = entry.path().join("manifest.json");
            if !manifest_path.exists() {
                continue;
            } // A crash before manifest commit leaves an unreferenced snapshot.
            let mut manifest: SkillManifest = serde_json::from_str(&read_text(&manifest_path)?)?;
            validate_uuid(&manifest.skill.id)?;
            if manifest.schema_version != 1
                || entry.file_name().to_string_lossy() != manifest.skill.id
                || manifest.revisions.is_empty()
            {
                return Err(AppError::new(
                    "InvalidManifest",
                    "skill 清单版本、目录或版本列表无效",
                ));
            }
            let mut revision_ids = std::collections::HashSet::new();
            let expected_source_key = source_key(&manifest.skill.source)?;
            for revision in &mut manifest.revisions {
                if revision.skill_id != manifest.skill.id
                    || !revision_ids.insert(revision.id.clone())
                {
                    return Err(AppError::new(
                        "InvalidManifest",
                        "版本所属 skill 或版本 ID 不一致",
                    ));
                }
                if revision.path != format!("revisions/{}", revision.hash)
                    || source_key(&revision.source)? != expected_source_key
                {
                    return Err(AppError::new(
                        "InvalidManifest",
                        "版本相对路径或来源身份与 skill 清单不一致",
                    ));
                }
                revision.path = display_path(&self.expected_revision_path(revision)?);
                self.validate_revision(revision)?;
            }
            if !revision_ids.contains(&manifest.skill.latest_revision_id)
                || manifest.skill.revision_count != manifest.revisions.len() as u64
            {
                return Err(AppError::new(
                    "InvalidManifest",
                    "skill 清单版本计数或当前版本无效",
                ));
            }
            let transaction = self.conn.unchecked_transaction()?;
            transaction.execute("INSERT INTO skills(id,source_key,json) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET source_key=excluded.source_key,json=excluded.json",
                params![manifest.skill.id, source_key(&manifest.skill.source)?, serde_json::to_string(&manifest.skill)?])?;
            for revision in manifest.revisions {
                transaction.execute("INSERT INTO revisions(id,skill_id,hash,source_version,json) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
                    params![revision.id, revision.skill_id, revision.hash, revision.source.commit.clone().unwrap_or_else(|| revision.hash.clone()), serde_json::to_string(&revision)?])?;
            }
            transaction.commit()?;
        }
        Ok(())
    }

    fn recover_staging(&self) -> Result<()> {
        let root = self.library_root.join("staging");
        assert_safe_path(&root)?;
        for (index, entry) in fs::read_dir(&root)?.enumerate() {
            if index >= 1_000 {
                return Err(AppError::new(
                    "LimitExceeded",
                    "暂存区超过 1,000 个未完成操作；请检查 skills 库",
                ));
            }
            let entry = entry?;
            // Only our UUID-named staging directories are eligible. Keep other items.
            if entry
                .file_name()
                .to_str()
                .is_some_and(|name| Uuid::parse_str(name).is_ok())
            {
                let metadata = fs::symlink_metadata(entry.path())?;
                if metadata.is_dir() && !is_link(&metadata) {
                    remove_tree(&entry.path())?;
                } else if is_link(&metadata) {
                    return Err(AppError::new(
                        "UnsafeLink",
                        "暂存区出现链接；已停止自动清理",
                    ));
                }
            }
        }
        Ok(())
    }

    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let json = self
            .conn
            .prepare("SELECT json FROM projects WHERE id NOT IN (SELECT id FROM removed_projects) ORDER BY path_key")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        json.into_iter()
            .map(|text| serde_json::from_str(&text).map_err(Into::into))
            .collect()
    }

    pub fn add_project(&self, path: &Path) -> Result<Project> {
        let canonical = canonical_directory(path)?;
        if canonical.starts_with(&self.library_root)
            || self.library_root.starts_with(&canonical)
            || canonical == self.data_dir
        {
            return Err(AppError::new(
                "InvalidProject",
                "项目不能包含 skills 库，也不能位于 skills 库内部",
            ));
        }
        let key = path_key(&canonical);
        let existing: Option<String> = self
            .conn
            .query_row("SELECT id FROM projects WHERE path_key=?1", [&key], |row| {
                row.get(0)
            })
            .optional()?;
        if let Some(id) = existing {
            self.conn
                .execute("DELETE FROM removed_projects WHERE id=?1", [&id])?;
            return self.project(&id);
        }
        let name = canonical
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("项目")
            .to_string();
        let project = Project {
            id: Uuid::new_v4().to_string(),
            name,
            display_name: None,
            path: display_path(&canonical),
        };
        self.conn.execute(
            "INSERT INTO projects(id,path_key,json) VALUES(?1,?2,?3)",
            params![project.id, key, serde_json::to_string(&project)?],
        )?;
        Ok(project)
    }

    pub fn project(&self, id: &str) -> Result<Project> {
        validate_uuid(id)?;
        let json: Option<String> = self
            .conn
            .query_row("SELECT json FROM projects WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()?;
        serde_json::from_str(&json.ok_or_else(|| AppError::new("ProjectNotFound", "项目不存在"))?)
            .map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) fn fixture(root: &Path) -> PathBuf {
        let path = root.join("中文 skill source");
        fs::create_dir(&path).unwrap();
        fs::write(
            path.join("SKILL.md"),
            "---\nname: sample\ndescription: 测试\n---\noriginal\n",
        )
        .unwrap();
        fs::create_dir(path.join("assets")).unwrap();
        fs::write(path.join("assets/data.txt"), "原文附件").unwrap();
        path
    }

    #[test]
    fn display_name_survives_import_and_manifest_recovery_without_changing_snapshots() {
        let temp = tempfile::tempdir().unwrap();
        let source = fixture(temp.path());
        let cancel = AtomicBool::new(false);
        let data = temp.path().join("app");
        let store = Store::open(&data).unwrap();
        let skill = store.import_local(&source, None, None, &cancel).unwrap();
        let revision = store.revision(&skill.latest_revision_id).unwrap();
        let renamed = store
            .set_display_name(&skill.id, "  我的 Rust 技能  ")
            .unwrap();
        assert_eq!(renamed.name, "sample");
        assert_eq!(renamed.display_name.as_deref(), Some("我的 Rust 技能"));
        assert_eq!(
            hash_tree(Path::new(&revision.path), &cancel).unwrap(),
            revision.hash
        );
        assert_eq!(
            store
                .import_local(&source, None, None, &cancel)
                .unwrap()
                .display_name,
            renamed.display_name
        );
        drop(store);
        fs::remove_file(data.join("askills.db")).unwrap();
        let restored = Store::open(&data).unwrap();
        assert_eq!(
            restored.skill(&skill.id).unwrap().display_name,
            renamed.display_name
        );
        assert_eq!(
            restored
                .set_display_name(&skill.id, " ")
                .unwrap()
                .display_name,
            None
        );
        assert_eq!(
            restored.skill(&skill.id).unwrap().latest_revision_id,
            revision.id
        );
    }

    #[test]
    fn invalid_display_names_are_rejected_and_old_skill_json_remains_readable() {
        let temp = tempfile::tempdir().unwrap();
        let source = fixture(temp.path());
        let store = Store::open(&temp.path().join("app")).unwrap();
        let skill = store
            .import_local(&source, None, None, &AtomicBool::new(false))
            .unwrap();
        for bad in ["a\nb".to_string(), "a".repeat(81)] {
            assert_eq!(
                store.set_display_name(&skill.id, &bad).unwrap_err().code,
                "InvalidDisplayName"
            );
        }
        assert!(store.skill(&skill.id).unwrap().display_name.is_none());
        let mut legacy = serde_json::to_value(&skill).unwrap();
        legacy.as_object_mut().unwrap().remove("displayName");
        assert!(
            serde_json::from_value::<Skill>(legacy)
                .unwrap()
                .display_name
                .is_none()
        );
    }

    #[test]
    fn import_is_idempotent_keeps_original_and_preserves_versions() {
        let temporary = tempfile::tempdir().unwrap();
        let path = fixture(temporary.path());
        let store = Store::open(&temporary.path().join("app")).unwrap();
        let cancel = AtomicBool::new(false);
        let first = store.import_local(&path, None, None, &cancel).unwrap();
        let again = store.import_local(&path, None, None, &cancel).unwrap();
        assert_eq!(first.latest_revision_id, again.latest_revision_id);
        assert_eq!(store.list_skills().unwrap().len(), 1);
        fs::write(path.join("assets/data.txt"), "new content").unwrap();
        let second = store.import_local(&path, None, None, &cancel).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(second.revision_count, 2);
        assert_ne!(first.latest_revision_id, second.latest_revision_id);
        let old = store.revision(&first.latest_revision_id).unwrap();
        assert_eq!(
            fs::read_to_string(Path::new(&old.path).join("assets/data.txt")).unwrap(),
            "原文附件"
        );
        assert!(path.join("SKILL.md").exists());
    }

    #[test]
    fn modified_snapshot_and_stale_preview_are_rejected() {
        let temporary = tempfile::tempdir().unwrap();
        let path = fixture(temporary.path());
        let store = Store::open(&temporary.path().join("app")).unwrap();
        let cancel = AtomicBool::new(false);
        assert_eq!(
            store
                .import_local(&path, None, Some("stale"), &cancel)
                .unwrap_err()
                .code,
            "PreviewExpired"
        );
        let skill = store.import_local(&path, None, None, &cancel).unwrap();
        let revision = store.revision(&skill.latest_revision_id).unwrap();
        fs::write(
            Path::new(&revision.path).join("assets/data.txt"),
            "tampered",
        )
        .unwrap();
        assert_eq!(
            store.read_revision(&revision.id).unwrap_err().code,
            "DriftDetected"
        );
    }

    #[test]
    fn manifests_recover_deleted_index_and_lock_excludes_second_writer() {
        let temporary = tempfile::tempdir().unwrap();
        let path = fixture(temporary.path());
        let app = temporary.path().join("app");
        let store = Store::open(&app).unwrap();
        let skill = store
            .import_local(&path, None, None, &AtomicBool::new(false))
            .unwrap();
        assert!(matches!(Store::open(&app), Err(error) if error.code == "LibraryBusy"));
        drop(store);
        fs::remove_file(app.join("askills.db")).unwrap();
        let recovered = Store::open(&app).unwrap();
        assert_eq!(
            recovered.skill(&skill.id).unwrap().latest_revision_id,
            skill.latest_revision_id
        );
        recovered.read_revision(&skill.latest_revision_id).unwrap();
    }

    #[test]
    fn changing_empty_library_is_persistent_and_rejects_foreign_files() {
        let temporary = tempfile::tempdir().unwrap();
        let app = temporary.path().join("app");
        let target = temporary.path().join("chosen library");
        let mut store = Store::open(&app).unwrap();
        store.set_library_root(&target).unwrap();
        drop(store);
        let mut store = Store::open(&app).unwrap();
        assert_eq!(store.library_root, fs::canonicalize(&target).unwrap());
        let foreign = temporary.path().join("foreign");
        fs::create_dir(&foreign).unwrap();
        fs::write(foreign.join("keep.txt"), "untouched").unwrap();
        assert_eq!(
            store.set_library_root(&foreign).unwrap_err().code,
            "DirectoryNotEmpty"
        );
        assert_eq!(
            fs::read_to_string(foreign.join("keep.txt")).unwrap(),
            "untouched"
        );
    }

    #[test]
    fn interrupted_initial_marker_recovers_only_its_plain_lock() {
        let temporary = tempfile::tempdir().unwrap();
        let app = temporary.path().join("app");
        fs::create_dir_all(app.join("library")).unwrap();
        fs::write(app.join("library/.askills.lock"), "").unwrap();
        let store = Store::open(&app).unwrap();
        assert!(store.library_root.join("library.json").is_file());
        drop(store);
        let foreign = temporary.path().join("foreign-app");
        fs::create_dir_all(foreign.join("library")).unwrap();
        fs::write(foreign.join("library/.askills.lock"), "").unwrap();
        fs::write(foreign.join("library/user-file.txt"), "keep").unwrap();
        assert!(matches!(Store::open(&foreign), Err(error) if error.code == "DirectoryNotEmpty"));
    }

    #[test]
    fn startup_removes_only_known_staging_and_cancellation_is_observed() {
        let temporary = tempfile::tempdir().unwrap();
        let app = temporary.path().join("app");
        let path = fixture(temporary.path());
        let store = Store::open(&app).unwrap();
        let skill = store
            .import_local(&path, None, None, &AtomicBool::new(false))
            .unwrap();
        assert_eq!(
            store
                .read_revision_cancellable(&skill.latest_revision_id, &AtomicBool::new(true))
                .unwrap_err()
                .code,
            "Cancelled"
        );
        let staging = store
            .library_root
            .join("staging")
            .join(Uuid::new_v4().to_string());
        fs::create_dir(&staging).unwrap();
        fs::write(staging.join("partial.txt"), "partial").unwrap();
        drop(store);
        let _store = Store::open(&app).unwrap();
        assert!(!staging.exists());
    }

    #[test]
    fn github_identity_is_independent_of_download_directory_and_ref() {
        let temporary = tempfile::tempdir().unwrap();
        let path = fixture(temporary.path());
        let copied = temporary.path().join("second-download");
        copy_tree(&path, &copied, &AtomicBool::new(false)).unwrap();
        let store = Store::open(&temporary.path().join("app")).unwrap();
        let mut source = SkillSource {
            kind: "github".into(),
            url: Some("https://github.com/Owner/Repo".into()),
            reference: Some("main".into()),
            commit: Some("a".repeat(40)),
            subpath: Some("skills/sample".into()),
            local_path: None,
        };
        let first = store
            .import_local(&path, Some(source.clone()), None, &AtomicBool::new(false))
            .unwrap();
        source.reference = Some("v1".into());
        let repeated = store
            .import_local(&copied, Some(source.clone()), None, &AtomicBool::new(false))
            .unwrap();
        assert_eq!(first.latest_revision_id, repeated.latest_revision_id);
        source.commit = Some("b".repeat(40));
        let second = store
            .import_local(&copied, Some(source), None, &AtomicBool::new(false))
            .unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(second.revision_count, 2);
        let revisions = store.list_revisions(&second.id).unwrap();
        assert_eq!(revisions[0].path, revisions[1].path);
        assert!(
            revisions
                .iter()
                .all(|revision| revision.source.local_path.is_none())
        );
    }
}
