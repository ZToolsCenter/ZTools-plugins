//! Adopt the old application index without moving skills or project links.
use super::*;

/// A consistent SQLite snapshot and explicit library setting are published
/// together by renaming a staging directory. The old data remains available.
pub fn inherit_legacy_data(destination: &Path, legacy: &Path) -> Result<()> {
    assert_safe_path(destination)?;
    if destination == legacy || destination.join("askills.db").exists() {
        return Ok(());
    }
    assert_safe_path(legacy)?;
    if !legacy.join("askills.db").exists() {
        return Ok(());
    }
    if destination.starts_with(legacy) || legacy.starts_with(destination) {
        return Err(AppError::new(
            "DataDirectoryConflict",
            "新旧应用数据目录不能重叠",
        ));
    }
    ensure_empty_destination(destination)?;
    // Holding both old instance/library locks prevents a live old version from
    // changing the database or snapshots while the new index is being adopted.
    let store = Store::open(legacy)?;
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new("InvalidPath", "应用数据目录缺少父目录"))?;
    let staging = tempfile::Builder::new()
        .prefix(".asklils-upgrade-")
        .tempdir_in(parent)?;
    let snapshot = staging.path().join("askills.db");
    // VACUUM INTO includes committed WAL data without copying live SQLite files.
    store
        .conn
        .execute("VACUUM main INTO ?1", [display_path(&snapshot)])?;
    atomic_write(
        &staging.path().join("settings.json"),
        &serde_json::to_vec_pretty(&Settings {
            schema_version: 1,
            library_root: display_path(&store.library_root),
        })?,
    )?;
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(&snapshot)?
        .sync_all()?;
    // Recheck after snapshotting. Never merge into an existing application's data.
    ensure_empty_destination(destination)?;
    if destination.exists() {
        fs::remove_dir(destination)?;
    }
    fs::rename(staging.path(), destination)?;
    Ok(())
}

fn ensure_empty_destination(path: &Path) -> Result<()> {
    assert_safe_path(path)?;
    if path.exists() && (!path.is_dir() || fs::read_dir(path)?.next().is_some()) {
        return Err(AppError::new(
            "DataDirectoryConflict",
            "新应用数据目录包含现有内容，未覆盖；请保留备份后检查该目录",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
