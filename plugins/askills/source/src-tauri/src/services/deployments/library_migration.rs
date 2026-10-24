//! Rebind fixed-version installations while both library copies remain available.
//! The library migration coordinator owns the cross-project commit/recovery journal.

use super::*;

fn no_pending_operations(store: &Store) -> Result<()> {
    initialize(store)?;
    let pending: i64 = store.conn.query_row(
        "SELECT COUNT(*) FROM askills_deployment_journal WHERE phase NOT IN ('complete','rolled_back')",
        [],
        |row| row.get(0),
    ).map_err(sql)?;
    if pending > 0 {
        return Err(error(
            "RecoveryRequired",
            "存在待恢复的项目安装操作，请先恢复后再迁移 skills 库",
        ));
    }
    Ok(())
}

fn validate_saved(
    store: &Store,
    saved: &SavedDeployment,
    cancel: &AtomicBool,
    read_revision: fn(&Store, &str) -> Result<Revision>,
) -> Result<(crate::domain::Project, Revision, Option<String>)> {
    cancelled(cancel)?;
    if !["copy", "symlink", "junction"].contains(&saved.view.mode.as_str()) {
        return Err(error(
            "InvalidState",
            "项目安装方式无效，无法迁移 skills 库",
        ));
    }
    // project() includes logically removed projects whose installations are still live.
    let project = store.project(&saved.view.project_id)?;
    safe_fs::canonical_directory(Path::new(&project.path))?;
    let expected_target = target(
        Path::new(&project.path),
        &saved.view.name,
        &saved.view.agent,
    )?;
    if expected_target != Path::new(&saved.view.target_path) {
        return Err(error("UnsafePath", "安装入口与记录的项目路径不匹配"));
    }
    let revision = read_revision(store, &saved.view.revision_id)?;
    if revision.skill_id != saved.view.skill_id || revision.hash != saved.hash {
        return Err(error("InvalidState", "项目安装记录与 skill 版本不匹配"));
    }
    filesystem::verify_entry_cancellable(&expected_target, saved, cancel)?;
    let lock = validate_lock_with(store, &project.id, Path::new(&project.path), read_revision)?;
    Ok((project, revision, lock))
}

pub fn preflight_library_migration(store: &Store, cancel: &AtomicBool) -> Result<u64> {
    cancelled(cancel)?;
    no_pending_operations(store)?;
    let entries = saved_list(store)?;
    for saved in &entries {
        let _guard = project_guard(store, &saved.view.project_id)?;
        let (_, revision, _) = validate_saved(store, saved, cancel, Store::revision)?;
        if saved.revision_path != revision.path {
            return Err(error(
                "InvalidRevisionPath",
                "项目安装引用的版本不在当前 skills 库中",
            ));
        }
        check_revision(store, &revision, cancel)?;
    }
    cancelled(cancel)?;
    Ok(entries.len() as u64)
}

fn path_at(root: &Path, revision: &Revision) -> PathBuf {
    root.join("skills")
        .join(&revision.skill_id)
        .join("revisions")
        .join(&revision.hash)
}

fn migration_revision(store: &Store, id: &str) -> Result<Revision> {
    // A crash can leave settings pointing at the new root while the SQLite index
    // still has old absolute paths. Only the fixed identity/hash/source metadata
    // are needed here; both destination paths are reconstructed and checked below.
    let raw: String = store
        .conn
        .query_row("SELECT json FROM revisions WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .map_err(sql)?;
    let revision: Revision = serde_json::from_str(&raw).map_err(json)?;
    if revision.id != id
        || Uuid::parse_str(id).is_err()
        || Uuid::parse_str(&revision.skill_id).is_err()
        || revision.hash.len() != 64
        || !revision
            .hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(error("InvalidState", "迁移中的 skill 版本记录无效"));
    }
    Ok(revision)
}

fn validate_relocation(
    store: &Store,
    saved: &SavedDeployment,
    old_root: &Path,
    new_root: &Path,
    cancel: &AtomicBool,
) -> Result<(crate::domain::Project, String, Option<String>)> {
    let (project, revision, lock) = validate_saved(store, saved, cancel, migration_revision)?;
    let old_path = safe_fs::display_path(&path_at(old_root, &revision));
    let destination = path_at(new_root, &revision);
    let new_path = safe_fs::display_path(&destination);
    if saved.revision_path != old_path && saved.revision_path != new_path {
        return Err(error(
            "InvalidRevisionPath",
            "项目安装引用的版本不属于本次迁移的 skills 库",
        ));
    }
    if safe_fs::hash_tree(&destination, cancel)? != revision.hash {
        return Err(error("RevisionModified", "目标 skills 库版本校验失败"));
    }
    Ok((project, new_path, lock))
}

/// Safe to repeat after deployment recovery, including with installations split
/// between the two roots. Neither root may be removed until this has completed.
pub fn relocate_library(
    store: &mut Store,
    old_root: &Path,
    new_root: &Path,
    cancel: &AtomicBool,
) -> Result<()> {
    cancelled(cancel)?;
    no_pending_operations(store)?;
    let old_root = safe_fs::canonical_directory(old_root)?;
    let new_root = safe_fs::canonical_directory(new_root)?;
    let active_root = safe_fs::canonical_directory(&store.library_root)?;
    if old_root == new_root {
        return Ok(());
    }
    if old_root.starts_with(&new_root)
        || new_root.starts_with(&old_root)
        || (active_root != old_root && active_root != new_root)
    {
        return Err(error("UnsafeLibraryRoot", "skills 库迁移路径无效"));
    }
    let entries = saved_list(store)?;
    // Reject known problems across the whole set before changing any installation.
    for saved in &entries {
        let _guard = project_guard(store, &saved.view.project_id)?;
        validate_relocation(store, saved, &old_root, &new_root, cancel)?;
    }
    cancelled(cancel)?;
    store
        .conn
        .execute("DELETE FROM askills_deployment_plans", [])
        .map_err(sql)?;
    for saved in entries {
        cancelled(cancel)?;
        let _guard = project_guard(store, &saved.view.project_id)?;
        let (project, new_path, lock_before) =
            validate_relocation(store, &saved, &old_root, &new_root, cancel)?;
        if saved.revision_path == new_path {
            continue;
        }
        let mut after = saved.clone();
        after.revision_path = new_path;
        if saved.view.mode == "copy" {
            // A copy is independent of the library's location. Preserve its inode,
            // bytes, identity, rollback version, and the project's lock file.
            cancelled(cancel)?;
            store
                .conn
                .execute(
                    "UPDATE askills_deployments SET payload=?2 WHERE id=?1",
                    params![after.view.id, serialize(&after)?],
                )
                .map_err(sql)?;
            continue;
        }
        after.identity.clear();
        let unchanged_lock = lock_before
            .clone()
            .ok_or_else(|| error("LockConflict", "项目锁文件已被移除，停止迁移"))?;
        let mut journal = Journal {
            id: Uuid::new_v4().to_string(),
            project_id: project.id,
            project_path: project.path,
            target: saved.view.target_path.clone(),
            before: Some(saved),
            after: Some(after),
            lock_before,
            lock_after: String::new(),
            lock_old_identity: None,
            lock_new_identity: None,
        };
        verify_before(&journal)?;
        cancelled(cancel)?;
        journal_save(store, &journal, "prepared", None)?;
        if let Err(issue) = execute_with_lock(store, &mut journal, cancel, Some(&unchanged_lock)) {
            record_failure(store, &journal, &issue);
            return Err(issue);
        }
        // execute() may commit with cleanup still pending. Let the coordinator
        // recover that journal before proceeding or removing the old library.
        no_pending_operations(store)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
