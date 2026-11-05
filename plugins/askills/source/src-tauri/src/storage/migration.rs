//! Copy first, then roll forward a durable switch. The original library is retained
//! as a backup; it is never recursively moved or deleted by migration.
use super::*;
use crate::platform::fs::{MAX_FILE_BYTES, open_read_nofollow};
use crate::services::deployments;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};

const JOURNAL: &str = "library-migration.json";
const LIBRARY_DIRS: [&str; 4] = ["skills", "staging", "trash", "local"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMigrationPlan {
    pub source_path: String,
    pub target_path: String,
    pub skill_count: u64,
    pub revision_count: u64,
    pub deployment_count: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMigrationResult {
    pub library_root: String,
    pub previous_root: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Fingerprint {
    hash: String,
    bytes: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Inventory {
    files: BTreeMap<String, Fingerprint>,
    directories: BTreeSet<String>,
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
enum Phase {
    Copying,
    Ready,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Migration {
    schema_version: u32,
    id: String,
    source: PathBuf,
    target: PathBuf,
    source_id: String,
    target_id: String,
    phase: Phase,
    inventory: Inventory,
}

fn fingerprint(path: &Path, cancel: &AtomicBool) -> Result<Fingerprint> {
    let mut input = open_read_nofollow(path)?;
    let mut hash = Sha256::new();
    let mut bytes = 0;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        check_cancel(cancel)?;
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        bytes += read as u64;
        if bytes > MAX_FILE_BYTES {
            return Err(AppError::new("LimitExceeded", "迁移文件超过 16 MiB"));
        }
        hash.update(&buffer[..read]);
    }
    Ok(Fingerprint {
        hash: format!("{:x}", hash.finalize()),
        bytes,
    })
}

fn inventory(root: &Path, cancel: &AtomicBool) -> Result<Inventory> {
    fn visit(
        root: &Path,
        relative: &Path,
        result: &mut Inventory,
        cancel: &AtomicBool,
    ) -> Result<()> {
        check_cancel(cancel)?;
        if relative.components().count() > 64
            || result.files.len() + result.directories.len() > 100_000
        {
            return Err(AppError::new(
                "LimitExceeded",
                "库迁移超过目录深度或条目上限",
            ));
        }
        let path = root.join(relative);
        assert_safe_path(&path)?;
        for item in fs::read_dir(path)? {
            check_cancel(cancel)?;
            let item = item?;
            if relative.as_os_str().is_empty()
                && (item.file_name() == ".askills.lock" || item.file_name() == "library.json")
            {
                continue;
            }
            let relative = relative.join(item.file_name());
            let key = relative
                .to_str()
                .ok_or_else(|| AppError::new("InvalidPath", "文件名不是有效 UTF-8"))?
                .replace('\\', "/");
            let metadata = fs::symlink_metadata(item.path())?;
            if is_link(&metadata) {
                return Err(AppError::new(
                    "UnsafeLink",
                    "迁移目录不能包含链接或重解析点",
                ));
            }
            if metadata.is_dir() {
                result.directories.insert(key);
                visit(root, &relative, result, cancel)?;
            } else if metadata.is_file() {
                result.files.insert(key, fingerprint(&item.path(), cancel)?);
            } else {
                return Err(AppError::new(
                    "UnsafeFile",
                    "迁移目录只能包含普通文件和目录",
                ));
            }
        }
        Ok(())
    }
    let mut result = Inventory::default();
    visit(root, Path::new(""), &mut result, cancel)?;
    Ok(result)
}

fn verify_identity(root: &Path, expected: &str) -> Result<()> {
    canonical_directory(root)?;
    let marker: LibraryIdentity = serde_json::from_str(&read_text(&root.join("library.json"))?)?;
    if marker.schema_version != 1 || marker.id != expected {
        return Err(AppError::new(
            "LibraryChanged",
            "迁移目录已被替换，请恢复原目录后重试",
        ));
    }
    Ok(())
}

fn validate_destination(root: &Path) -> Result<()> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        let name = entry.file_name();
        if is_link(&metadata) {
            return Err(AppError::new("UnsafeLink", "目标目录包含链接"));
        }
        if name == ".askills.lock" && metadata.is_file() {
            continue;
        }
        if name == "library.json" && metadata.is_file() {
            let marker: LibraryIdentity = serde_json::from_str(&read_text(&entry.path())?)?;
            if marker.schema_version == 1 && Uuid::parse_str(&marker.id).is_ok() {
                continue;
            }
        }
        if LIBRARY_DIRS.iter().any(|known| name == *known)
            && metadata.is_dir()
            && fs::read_dir(entry.path())?.next().is_none()
        {
            continue;
        }
        return Err(AppError::new(
            "DirectoryNotEmpty",
            "请选择空目录或空的 Askills skills 库；不会合并已有内容",
        ));
    }
    Ok(())
}

impl Store {
    fn conflicts_with_application_data(&self, root: &Path) -> bool {
        // The dedicated default library is safe; never admit other children of
        // the data directory, its ancestors, or the data directory itself.
        (root.starts_with(&self.data_dir) && root != self.data_dir.join("library"))
            || self.data_dir.starts_with(root)
    }

    fn migration_target(&self, path: &Path) -> Result<PathBuf> {
        safe_library_root(path)?;
        let root = if path.exists() {
            canonical_directory(path)?
        } else {
            let parent = path
                .parent()
                .ok_or_else(|| AppError::new("InvalidPath", "目录没有父路径"))?;
            canonical_directory(parent)?.join(
                path.file_name()
                    .ok_or_else(|| AppError::new("InvalidPath", "目录名无效"))?,
            )
        };
        safe_library_root(&root)?;
        if root == self.library_root {
            return Ok(root);
        }
        if root.starts_with(&self.library_root)
            || self.library_root.starts_with(&root)
            || self.conflicts_with_application_data(&root)
        {
            return Err(AppError::new(
                "UnsafeLibraryRoot",
                "新旧库不能互相嵌套，也不能与应用数据目录重叠",
            ));
        }
        let projects = self
            .conn
            .prepare("SELECT json FROM projects")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for text in projects {
            let project: Project = serde_json::from_str(&text)?;
            let path = Path::new(&project.path);
            let project_root = if path.exists() {
                canonical_directory(path)?
            } else {
                path.to_path_buf()
            };
            let comparable_root = PathBuf::from(display_path(&root));
            let comparable_project = PathBuf::from(display_path(&project_root));
            if comparable_root.starts_with(&comparable_project)
                || comparable_project.starts_with(&comparable_root)
            {
                return Err(AppError::new(
                    "UnsafeLibraryRoot",
                    "skills 库不能与已登记项目目录重叠",
                ));
            }
        }
        Ok(root)
    }

    pub fn preview_library_migration(
        &self,
        path: &Path,
        cancel: &AtomicBool,
    ) -> Result<LibraryMigrationPlan> {
        self.verify_library()?;
        check_cancel(cancel)?;
        let root = self.migration_target(path)?;
        if root != self.library_root {
            validate_destination(&root)?;
        }
        let revisions = self
            .conn
            .prepare("SELECT json FROM revisions")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for json in &revisions {
            check_cancel(cancel)?;
            let revision: Revision = serde_json::from_str(json)?;
            self.validate_revision(&revision)?;
            if hash_tree(Path::new(&revision.path), cancel)? != revision.hash {
                return Err(AppError::new(
                    "RevisionModified",
                    "库中版本已被修改，请检查后再迁移",
                ));
            }
        }
        let deployment_count = deployments::preflight_library_migration(self, cancel)?;
        let total_bytes = inventory(&self.library_root, cancel)?
            .files
            .values()
            .map(|file| file.bytes)
            .sum();
        let skill_count = self
            .conn
            .query_row("SELECT count(*) FROM skills", [], |row| row.get(0))?;
        Ok(LibraryMigrationPlan {
            source_path: display_path(&self.library_root),
            target_path: display_path(&root),
            skill_count,
            revision_count: revisions.len() as u64,
            deployment_count,
            total_bytes,
        })
    }

    fn save_migration(&self, migration: &Migration) -> Result<()> {
        let json = serde_json::to_vec_pretty(migration)?;
        if json.len() as u64 > MAX_FILE_BYTES {
            return Err(AppError::new("LimitExceeded", "库迁移清单超过大小上限"));
        }
        atomic_write(&self.data_dir.join(JOURNAL), &json)
    }

    fn load_migration(&self) -> Result<Option<Migration>> {
        let path = self.data_dir.join(JOURNAL);
        assert_safe_path(&path)?;
        if !path.exists() {
            return Ok(None);
        }
        let migration: Migration = serde_json::from_str(&read_text(&path)?)?;
        if migration.schema_version != 1
            || (self.library_root != migration.source && self.library_root != migration.target)
        {
            return Err(AppError::new("InvalidState", "库迁移记录与当前库不匹配"));
        }
        validate_uuid(&migration.id)?;
        validate_uuid(&migration.source_id)?;
        validate_uuid(&migration.target_id)?;
        safe_library_root(&migration.source)?;
        safe_library_root(&migration.target)?;
        if migration.source.starts_with(&migration.target)
            || migration.target.starts_with(&migration.source)
            || self.conflicts_with_application_data(&migration.target)
        {
            return Err(AppError::new("InvalidState", "库迁移记录中的目录重叠"));
        }
        for path in migration
            .inventory
            .files
            .keys()
            .chain(migration.inventory.directories.iter())
        {
            if path.is_empty()
                || path.contains(['\\', ':'])
                || Path::new(path)
                    .components()
                    .any(|c| !matches!(c, Component::Normal(_)))
            {
                return Err(AppError::new(
                    "InvalidState",
                    "库迁移记录包含不安全的相对路径",
                ));
            }
        }
        Ok(Some(migration))
    }

    fn clear_migration(&self) -> Result<()> {
        let path = self.data_dir.join(JOURNAL);
        assert_safe_path(&path)?;
        fs::remove_file(path)?;
        Ok(())
    }

    fn verify_copied_library(&self, root: &Path, cancel: &AtomicBool) -> Result<()> {
        let skills = self
            .conn
            .prepare("SELECT json FROM skills")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut checked = BTreeSet::new();
        for text in skills {
            check_cancel(cancel)?;
            let skill: Skill = serde_json::from_str(&text)?;
            validate_uuid(&skill.id)?;
            let skill_root = root.join("skills").join(&skill.id);
            let manifest: SkillManifest =
                serde_json::from_str(&read_text(&skill_root.join("manifest.json"))?)?;
            if manifest.schema_version != 1
                || serde_json::to_value(&manifest.skill)? != serde_json::to_value(&skill)?
            {
                return Err(AppError::new(
                    "SourceChanged",
                    "复制的 skill 清单与库索引不一致",
                ));
            }
            let revisions = self.list_revisions(&skill.id)?;
            let mut expected = BTreeMap::new();
            for mut revision in revisions {
                validate_hash(&revision.hash)?;
                let path = skill_root.join("revisions").join(&revision.hash);
                if checked.insert(path.clone()) && hash_tree(&path, cancel)? != revision.hash {
                    return Err(AppError::new(
                        "RevisionModified",
                        "复制的版本与原内容摘要不一致，未切换 skills 库",
                    ));
                }
                revision.path = format!("revisions/{}", revision.hash);
                expected.insert(revision.id.clone(), serde_json::to_value(revision)?);
            }
            let unique_ids: BTreeSet<_> = manifest
                .revisions
                .iter()
                .map(|revision| &revision.id)
                .collect();
            if unique_ids.len() != manifest.revisions.len()
                || manifest.revisions.len() != expected.len()
                || manifest.revisions.iter().any(|revision| {
                    expected.get(&revision.id) != serde_json::to_value(revision).ok().as_ref()
                })
            {
                return Err(AppError::new(
                    "SourceChanged",
                    "复制的版本清单与库索引不一致",
                ));
            }
        }
        Ok(())
    }

    pub fn migrate_library(
        &mut self,
        path: &Path,
        cancel: &AtomicBool,
    ) -> Result<LibraryMigrationResult> {
        self.recover_library_migration()?;
        let plan = self.preview_library_migration(path, cancel)?;
        let source = self.library_root.clone();
        let target = self.migration_target(path)?;
        if source == target {
            return Ok(LibraryMigrationResult {
                library_root: plan.target_path,
                previous_root: plan.source_path,
            });
        }
        let available_path = if target.exists() {
            target.as_path()
        } else {
            target.parent().unwrap()
        };
        if fs2::available_space(available_path)? < plan.total_bytes.saturating_add(1024 * 1024) {
            return Err(AppError::new(
                "InsufficientSpace",
                "目标磁盘可用空间不足，未更改当前库",
            ));
        }
        check_cancel(cancel)?;
        let (target, target_id, lock) = initialize_library(&target)?;
        validate_destination(&target)?;
        let mut migration = Migration {
            schema_version: 1,
            id: Uuid::new_v4().to_string(),
            source,
            target,
            source_id: self.library_id.clone(),
            target_id,
            phase: Phase::Copying,
            inventory: inventory(&self.library_root, cancel)?,
        };
        self.save_migration(&migration)?;
        if let Err(issue) = copy_library(&migration, cancel)
            .and_then(|()| self.verify_copied_library(&migration.target, cancel))
        {
            // Cleanup only byte-identical files created by this attempt. Any unexpected
            // external content is retained, never overwritten or recursively removed.
            let cleanup = cleanup_copy(&migration);
            self.clear_migration()?;
            if let Err(cleanup) = cleanup {
                return Err(AppError::new(
                    "MigrationCleanupRequired",
                    format!(
                        "{}；原库仍在使用，目标保留供检查：{}（{}）",
                        issue.message,
                        display_path(&migration.target),
                        cleanup.message
                    ),
                ));
            }
            return Err(issue);
        }
        migration.phase = Phase::Ready;
        self.save_migration(&migration)?;
        self.finish_migration(&migration, Some(lock))?;
        Ok(LibraryMigrationResult {
            library_root: display_path(&migration.target),
            previous_root: display_path(&migration.source),
        })
    }

    pub fn resume_library_migration(&mut self) -> Result<()> {
        if let Some(migration) = self.load_migration()?
            && migration.phase == Phase::Ready
        {
            self.finish_migration(&migration, None)?;
        }
        Ok(())
    }

    pub(super) fn recover_library_migration(&mut self) -> Result<()> {
        if let Some(migration) = self.load_migration()? {
            if migration.phase == Phase::Ready {
                self.finish_migration(&migration, None)?;
            } else {
                // Before Ready no project or setting was changed. Retain unfamiliar
                // target content if cleanup cannot prove ownership; the old library wins.
                if let Ok(_lock) = open_lock(&migration.target.join(".askills.lock")) {
                    let _ = cleanup_copy(&migration);
                }
                self.clear_migration()?;
            }
        }
        Ok(())
    }

    fn finish_migration(&mut self, migration: &Migration, lock: Option<File>) -> Result<()> {
        let cancel = AtomicBool::new(false);
        verify_identity(&migration.source, &migration.source_id)?;
        verify_identity(&migration.target, &migration.target_id)?;
        let _source_lock = if self.library_root != migration.source {
            Some(open_lock(&migration.source.join(".askills.lock"))?)
        } else {
            None
        };
        let target_lock = if self.library_root != migration.target {
            Some(match lock {
                Some(lock) => lock,
                None => open_lock(&migration.target.join(".askills.lock"))?,
            })
        } else {
            None
        };
        if inventory(&migration.target, &cancel)? != migration.inventory {
            return Err(AppError::new(
                "MigrationRecoveryRequired",
                "迁移目标内容已变化，请恢复目标内容后重试；原库备份仍保留",
            ));
        }
        deployments::recover(self)?;
        deployments::relocate_library(self, &migration.source, &migration.target, &cancel)?;
        atomic_write(
            &self.data_dir.join("settings.json"),
            &serde_json::to_vec_pretty(&Settings {
                schema_version: 1,
                library_root: display_path(&migration.target),
            })?,
        )?;
        self.library_root = migration.target.clone();
        self.library_id = migration.target_id.clone();
        if let Some(lock) = target_lock {
            self._library_lock = lock;
        }
        let revisions = self
            .conn
            .prepare("SELECT json FROM revisions")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let transaction = self.conn.unchecked_transaction()?;
        for text in revisions {
            let mut revision: Revision = serde_json::from_str(&text)?;
            revision.path = display_path(&self.expected_revision_path(&revision)?);
            self.validate_revision(&revision)?;
            transaction.execute(
                "UPDATE revisions SET json=?2 WHERE id=?1",
                params![revision.id, serde_json::to_string(&revision)?],
            )?;
        }
        transaction.execute("DELETE FROM askills_deployment_plans", [])?;
        transaction.commit()?;
        self.clear_migration()
    }
}

fn copy_library(migration: &Migration, cancel: &AtomicBool) -> Result<()> {
    let mut directories: Vec<_> = migration.inventory.directories.iter().collect();
    directories.sort_by_key(|path| path.matches('/').count());
    for relative in directories {
        check_cancel(cancel)?;
        let path = migration.target.join(relative);
        assert_safe_path(&path)?;
        if !path.exists() {
            fs::create_dir(&path)?;
        }
        canonical_directory(&path)?;
    }
    for (relative, expected) in &migration.inventory.files {
        check_cancel(cancel)?;
        let source = migration.source.join(relative);
        let destination = migration.target.join(relative);
        assert_safe_path(&destination)?;
        let mut input = open_read_nofollow(&source)?;
        let mut temporary = tempfile::Builder::new()
            .prefix(&format!(".askills-migration-{}-", migration.id))
            .tempfile_in(&migration.target)?;
        let mut buffer = [0u8; 64 * 1024];
        let mut bytes = 0;
        loop {
            check_cancel(cancel)?;
            let count = input.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            bytes += count as u64;
            if bytes > expected.bytes {
                return Err(AppError::new("SourceChanged", "复制期间库文件发生变化"));
            }
            temporary.write_all(&buffer[..count])?;
        }
        temporary.as_file().sync_all()?;
        if fingerprint(temporary.path(), cancel)? != *expected {
            return Err(AppError::new("SourceChanged", "复制期间库文件发生变化"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                temporary.path(),
                fs::Permissions::from_mode(input.metadata()?.permissions().mode() & 0o777),
            )?;
        }
        temporary
            .persist_noclobber(&destination)
            .map_err(|error| AppError::from(error.error))?;
    }
    check_cancel(cancel)?;
    if inventory(&migration.source, cancel)? != migration.inventory
        || inventory(&migration.target, cancel)? != migration.inventory
    {
        return Err(AppError::new(
            "SourceChanged",
            "复制后校验失败，原库仍在使用",
        ));
    }
    Ok(())
}

fn cleanup_copy(migration: &Migration) -> Result<()> {
    verify_identity(&migration.target, &migration.target_id)?;
    // An interrupted atomic file copy may leave only its uniquely named temp file.
    let prefix = format!(".askills-migration-{}-", migration.id);
    for entry in fs::read_dir(&migration.target)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            assert_safe_path(&entry.path())?;
            if !entry.file_type()?.is_file() {
                return Err(AppError::new("UnsafeFile", "迁移临时文件已被替换"));
            }
            fs::remove_file(entry.path())?;
        }
    }
    let actual = inventory(&migration.target, &AtomicBool::new(false))?;
    if !actual
        .directories
        .is_subset(&migration.inventory.directories)
        || actual
            .files
            .iter()
            .any(|(path, hash)| migration.inventory.files.get(path) != Some(hash))
    {
        return Err(AppError::new(
            "LocalChangesDetected",
            "目标存在不属于本次复制的内容",
        ));
    }
    for (relative, expected) in &actual.files {
        let path = migration.target.join(relative);
        if fingerprint(&path, &AtomicBool::new(false))? != *expected {
            return Err(AppError::new("LocalChangesDetected", "目标文件已改变"));
        }
        fs::remove_file(path)?;
    }
    let mut directories: Vec<_> = actual.directories.iter().collect();
    directories.sort_by_key(|path| std::cmp::Reverse(path.matches('/').count()));
    for relative in directories {
        if LIBRARY_DIRS.contains(&relative.as_str()) {
            continue;
        }
        let path = migration.target.join(relative);
        assert_safe_path(&path)?;
        fs::remove_dir(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
