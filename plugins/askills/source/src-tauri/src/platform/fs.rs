use crate::domain::{AppError, Result};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub const MAX_FILES: u64 = 4_000;
pub const MAX_ENTRIES: usize = 8_000;
pub const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_TREE_DEPTH: usize = 32;

#[derive(Debug, Clone)]
pub struct TreeInfo {
    pub hash: String,
    pub file_count: u64,
    pub total_bytes: u64,
    pub files: Vec<PathBuf>,
    pub directories: Vec<PathBuf>,
    pub file_hashes: BTreeMap<String, String>,
}

pub fn check_cancel(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(AppError::new("Cancelled", "操作已取消"))
    } else {
        Ok(())
    }
}

pub fn is_link(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    false
}

/// Checks every existing ancestor, including Windows junctions/reparse points.
/// A missing final component is allowed for planned creation; `..` is never accepted.
pub fn assert_safe_path(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(AppError::new("InvalidPath", "必须使用绝对路径"));
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir | Component::CurDir) {
            return Err(AppError::new("InvalidPath", "路径不能包含 . 或 .."));
        }
        current.push(component.as_os_str());
        // A Windows drive/verbatim prefix alone is not an absolute filesystem entry.
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) if is_link(&metadata) => {
                return Err(AppError::new(
                    "UnsafeLink",
                    format!("路径包含链接或重解析点：{}", current.display()),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

pub fn canonical_directory(path: &Path) -> Result<PathBuf> {
    assert_safe_path(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() || is_link(&metadata) {
        return Err(AppError::new("InvalidDirectory", "所选路径不是普通目录"));
    }
    let canonical = fs::canonicalize(path)?;
    assert_safe_path(&canonical)?;
    Ok(canonical)
}

pub fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }
    value.into_owned()
}

pub fn open_read_nofollow(path: &Path) -> Result<File> {
    assert_safe_path(path)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if is_link(&metadata) || !metadata.is_file() {
        return Err(AppError::new(
            "UnsafeFile",
            format!("不是普通文件：{}", path.display()),
        ));
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(AppError::new(
            "LimitExceeded",
            format!("单文件超过 16 MiB：{}", path.display()),
        ));
    }
    Ok(file)
}

pub fn read_text(path: &Path) -> Result<String> {
    let mut text = String::new();
    open_read_nofollow(path)?
        .take(MAX_FILE_BYTES + 1)
        .read_to_string(&mut text)?;
    if text.len() as u64 > MAX_FILE_BYTES {
        return Err(AppError::new("LimitExceeded", "文本文件超过读取上限"));
    }
    Ok(text)
}

fn portable_name(name: &str) -> Result<()> {
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit());
    if name.is_empty()
        || name.ends_with(['.', ' '])
        || reserved
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, ':' | '\\' | '<' | '>' | '"' | '|' | '?' | '*'))
    {
        return Err(AppError::new(
            "InvalidFileName",
            format!("文件名不能安全跨平台使用：{name}"),
        ));
    }
    Ok(())
}

fn walk(
    root: &Path,
    relative: &Path,
    entries: &mut Vec<(PathBuf, bool)>,
    cancel: &AtomicBool,
) -> Result<()> {
    check_cancel(cancel)?;
    if relative.components().count() > MAX_TREE_DEPTH {
        return Err(AppError::new("LimitExceeded", "skill 目录超过 32 层"));
    }
    let directory = root.join(relative);
    assert_safe_path(&directory)?;
    let mut names = HashSet::new();
    let mut children = Vec::new();
    for child in fs::read_dir(&directory)? {
        check_cancel(cancel)?;
        if children.len() + entries.len() >= MAX_ENTRIES {
            return Err(AppError::new(
                "LimitExceeded",
                "skill 目录超过 8,000 个条目",
            ));
        }
        children.push(child?);
    }
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        check_cancel(cancel)?;
        let name = child
            .file_name()
            .into_string()
            .map_err(|_| AppError::new("InvalidFileName", "文件名不是有效 UTF-8"))?;
        portable_name(&name)?;
        if !names.insert(name.to_lowercase()) {
            return Err(AppError::new(
                "PathConflict",
                format!("目录存在大小写冲突：{}", directory.display()),
            ));
        }
        if entries.len() >= MAX_ENTRIES {
            return Err(AppError::new(
                "LimitExceeded",
                "skill 目录超过 8,000 个条目",
            ));
        }
        let relative_child = relative.join(name);
        let metadata = fs::symlink_metadata(child.path())?;
        if is_link(&metadata) {
            return Err(AppError::new(
                "UnsafeLink",
                format!(
                    "skill 内不允许符号链接或 junction：{}",
                    child.path().display()
                ),
            ));
        }
        if !metadata.is_dir() && !metadata.is_file() {
            return Err(AppError::new(
                "UnsafeFile",
                "skill 内只能包含普通文件与目录",
            ));
        }
        entries.push((relative_child.clone(), metadata.is_dir()));
        if metadata.is_dir() {
            walk(root, &relative_child, entries, cancel)?;
        }
    }
    Ok(())
}

fn frame(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
}

pub fn inspect_tree(root: &Path, cancel: &AtomicBool) -> Result<TreeInfo> {
    canonical_directory(root)?;
    let mut entries = Vec::new();
    walk(root, Path::new(""), &mut entries, cancel)?;
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hasher = Sha256::new();
    hasher.update(b"askills-tree-v1\0");
    let mut info = TreeInfo {
        hash: String::new(),
        file_count: 0,
        total_bytes: 0,
        files: Vec::new(),
        directories: Vec::new(),
        file_hashes: BTreeMap::new(),
    };
    for (relative, directory) in entries {
        check_cancel(cancel)?;
        hasher.update(if directory { b"D" } else { b"F" });
        let name = relative
            .to_str()
            .ok_or_else(|| AppError::new("InvalidPath", "路径不是有效 UTF-8"))?
            .replace('\\', "/");
        frame(&mut hasher, name.as_bytes());
        if directory {
            info.directories.push(relative);
            continue;
        }
        info.file_count += 1;
        if info.file_count > MAX_FILES {
            return Err(AppError::new("LimitExceeded", "skill 超过 4,000 个文件"));
        }
        let mut file = open_read_nofollow(&root.join(&relative))?;
        let expected = file.metadata()?.len();
        if expected > MAX_FILE_BYTES {
            return Err(AppError::new("LimitExceeded", "单文件超过 16 MiB"));
        }
        hasher.update(expected.to_le_bytes());
        let mut bytes = 0u64;
        let mut file_hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            check_cancel(cancel)?;
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            bytes += count as u64;
            info.total_bytes += count as u64;
            if bytes > MAX_FILE_BYTES || info.total_bytes > MAX_TOTAL_BYTES {
                return Err(AppError::new(
                    "LimitExceeded",
                    "skill 超过大小上限（单文件 16 MiB / 总计 128 MiB）",
                ));
            }
            hasher.update(&buffer[..count]);
            file_hasher.update(&buffer[..count]);
        }
        if bytes != expected || file.metadata()?.len() != expected {
            return Err(AppError::new(
                "SourceChanged",
                "读取期间文件发生变化，请重新预览",
            ));
        }
        info.file_hashes
            .insert(name, format!("{:x}", file_hasher.finalize()));
        info.files.push(relative);
    }
    info.hash = format!("{:x}", hasher.finalize());
    Ok(info)
}

pub fn hash_tree(root: &Path, cancel: &AtomicBool) -> Result<String> {
    Ok(inspect_tree(root, cancel)?.hash)
}

/// Copies only ordinary files; destination must not exist and parents must be safe.
/// An interrupted destination is intentionally left for its caller's journal/recovery.
pub fn copy_tree(source: &Path, destination: &Path, cancel: &AtomicBool) -> Result<()> {
    let info = inspect_tree(source, cancel)?;
    assert_safe_path(destination)?;
    fs::create_dir(destination)?;
    for directory in &info.directories {
        check_cancel(cancel)?;
        let path = destination.join(directory);
        assert_safe_path(&path)?;
        fs::create_dir(&path)?;
    }
    let mut total_copied = 0u64;
    for relative in &info.files {
        check_cancel(cancel)?;
        let source_path = source.join(relative);
        let target = destination.join(relative);
        let mut input = open_read_nofollow(&source_path)?;
        assert_safe_path(&target)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)?;
        let mut buffer = [0u8; 64 * 1024];
        let mut count = 0u64;
        loop {
            check_cancel(cancel)?;
            let read = input.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            count += read as u64;
            total_copied += read as u64;
            if count > MAX_FILE_BYTES || total_copied > MAX_TOTAL_BYTES {
                return Err(AppError::new("LimitExceeded", "复制期间文件超过大小上限"));
            }
            output.write_all(&buffer[..read])?;
        }
        output.sync_all()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = input.metadata()?.permissions().mode() & 0o777;
            fs::set_permissions(&target, fs::Permissions::from_mode(mode))?;
        }
    }
    if hash_tree(destination, cancel)? != info.hash || hash_tree(source, cancel)? != info.hash {
        return Err(AppError::new(
            "SourceChanged",
            "复制后校验失败；源内容可能已改变",
        ));
    }
    Ok(())
}

/// Remove a known staging directory without following a link at any level.
pub fn remove_tree(path: &Path) -> Result<()> {
    assert_safe_path(path)?;
    if !path.exists() {
        return Ok(());
    }
    if !path.is_dir() {
        return Err(AppError::new("InvalidDirectory", "清理目标不是目录"));
    }
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if is_link(&metadata) {
            return Err(AppError::new(
                "UnsafeLink",
                "暂存目录中出现重解析点，已停止清理",
            ));
        }
        if metadata.is_dir() {
            remove_tree(&entry.path())?;
        } else {
            assert_safe_path(&entry.path())?;
            fs::remove_file(entry.path())?;
        }
    }
    assert_safe_path(path)?;
    fs::remove_dir(path)?;
    Ok(())
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    assert_safe_path(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("InvalidPath", "文件没有父目录"))?;
    let temporary = parent.join(format!(".askills-write-{}", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    assert_safe_path(path)?;
    match fs::rename(&temporary, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error.into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_preserve_paths_bytes_and_empty_directories() {
        let temporary = tempfile::tempdir().unwrap();
        let a = temporary.path().join("中文 a");
        let b = temporary.path().join("copy b");
        fs::create_dir(&a).unwrap();
        fs::create_dir(a.join("empty")).unwrap();
        fs::write(a.join("file.md"), "same bytes\n").unwrap();
        let cancel = AtomicBool::new(false);
        copy_tree(&a, &b, &cancel).unwrap();
        assert_eq!(
            hash_tree(&a, &cancel).unwrap(),
            hash_tree(&b, &cancel).unwrap()
        );
        fs::remove_dir(b.join("empty")).unwrap();
        assert_ne!(
            hash_tree(&a, &cancel).unwrap(),
            hash_tree(&b, &cancel).unwrap()
        );
        assert_eq!(copy_tree(&a, &b, &cancel).unwrap_err().code, "PathConflict");
    }

    #[test]
    fn cancellation_prevents_copy_creation() {
        let temporary = tempfile::tempdir().unwrap();
        let target = temporary.path().join("new");
        assert_eq!(
            copy_tree(temporary.path(), &target, &AtomicBool::new(true))
                .unwrap_err()
                .code,
            "Cancelled"
        );
        assert!(!target.exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_and_linked_ancestors_are_rejected() {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        fs::create_dir(&source).unwrap();
        std::os::unix::fs::symlink("/etc/passwd", source.join("escape")).unwrap();
        assert_eq!(
            hash_tree(&source, &AtomicBool::new(false))
                .unwrap_err()
                .code,
            "UnsafeLink"
        );
        let alias = temporary.path().join("alias");
        std::os::unix::fs::symlink(&source, &alias).unwrap();
        assert_eq!(
            assert_safe_path(&alias.join("child")).unwrap_err().code,
            "UnsafeLink"
        );
    }

    #[cfg(windows)]
    #[test]
    fn junctions_are_rejected_without_touching_the_target() {
        let temporary = tempfile::tempdir().unwrap();
        let outside = temporary.path().join("outside");
        let skill = temporary.path().join("skill");
        fs::create_dir(&outside).unwrap();
        fs::create_dir(&skill).unwrap();
        fs::write(outside.join("keep.txt"), "protected").unwrap();
        let junction_path = skill.join("escape");
        junction::create(&outside, &junction_path).unwrap();
        assert!(is_link(&fs::symlink_metadata(&junction_path).unwrap()));
        assert_eq!(
            hash_tree(&skill, &AtomicBool::new(false)).unwrap_err().code,
            "UnsafeLink"
        );
        assert_eq!(
            assert_safe_path(&junction_path.join("keep.txt"))
                .unwrap_err()
                .code,
            "UnsafeLink"
        );
        assert_eq!(remove_tree(&skill).unwrap_err().code, "UnsafeLink");
        assert_eq!(
            fs::read_to_string(outside.join("keep.txt")).unwrap(),
            "protected"
        );
        junction::delete(&junction_path).unwrap();
    }
}
