use super::*;
use std::io::{Read, Write};

pub(super) struct Paths {
    pub target: PathBuf,
    pub parent: PathBuf,
    pub temp: PathBuf,
    pub backup: PathBuf,
    pub lock: PathBuf,
    pub lock_temp: PathBuf,
    pub lock_backup: PathBuf,
}

impl Paths {
    pub fn new(journal: &Journal) -> Result<Self> {
        Uuid::parse_str(&journal.id).map_err(|_| error("InvalidState", "操作 ID 无效"))?;
        let entry = journal
            .after
            .as_ref()
            .or(journal.before.as_ref())
            .ok_or_else(|| error("InvalidState", "操作没有安装信息"))?;
        let project = Path::new(&journal.project_path);
        safe_fs::assert_safe_path(project)?;
        let target = super::target(project, &entry.view.name, &entry.view.agent)?;
        if target != Path::new(&journal.target) || entry.view.target_path != journal.target {
            return Err(error("UnsafePath", "操作日志路径不匹配"));
        }
        let parent = target
            .parent()
            .ok_or_else(|| error("UnsafePath", "目标没有父目录"))?
            .to_path_buf();
        safe_fs::assert_safe_path(&parent)?;
        let stem = format!(".askills-{}", journal.id);
        Ok(Self {
            temp: parent.join(format!("{stem}.new")),
            backup: parent.join(format!("{stem}.old")),
            lock: project.join("askills.lock.json"),
            lock_temp: project.join(format!("{stem}.lock.new")),
            lock_backup: project.join(format!("{stem}.lock.old")),
            target,
            parent,
        })
    }
}

pub(super) fn must_not_exist(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Err(issue) if issue.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(issue) => Err(io(issue)),
        Ok(_) => Err(error(
            "PathConflict",
            format!("位置已有内容，拒绝覆盖：{}", path.display()),
        )),
    }
}

fn exists(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(issue) if issue.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(issue) => Err(io(issue)),
    }
}

#[cfg(unix)]
pub(super) fn identity(path: &Path) -> Result<String> {
    use std::os::unix::fs::MetadataExt;
    let meta = fs::symlink_metadata(path).map_err(io)?;
    Ok(format!("{}:{}", meta.dev(), meta.ino()))
}

#[cfg(windows)]
pub(super) fn identity(path: &Path) -> Result<String> {
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    #[repr(C)]
    #[derive(Default)]
    struct Information {
        attributes: u32,
        creation_low: u32,
        creation_high: u32,
        access_low: u32,
        access_high: u32,
        write_low: u32,
        write_high: u32,
        volume: u32,
        size_high: u32,
        size_low: u32,
        links: u32,
        index_high: u32,
        index_low: u32,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetFileInformationByHandle(
            handle: *mut std::ffi::c_void,
            information: *mut Information,
        ) -> i32;
    }
    // OPEN_REPARSE_POINT identifies the entry itself; BACKUP_SEMANTICS permits directories.
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(0x0020_0000 | 0x0200_0000)
        .open(path)
        .map_err(io)?;
    let mut information = Information::default();
    // SAFETY: the file handle remains live and Information matches BY_HANDLE_FILE_INFORMATION.
    let ok = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) };
    if ok == 0 {
        return Err(io(std::io::Error::last_os_error()));
    }
    Ok(format!(
        "{}:{}:{}",
        information.volume, information.index_high, information.index_low
    ))
}

#[cfg(not(any(unix, windows)))]
compile_error!("Deployment entry identity requires Unix or Windows.");

pub(super) fn verify_entry(path: &Path, entry: &SavedDeployment) -> Result<()> {
    verify_entry_cancellable(path, entry, &AtomicBool::new(false))
}

pub(super) fn verify_entry_cancellable(
    path: &Path,
    entry: &SavedDeployment,
    cancel: &AtomicBool,
) -> Result<()> {
    cancelled(cancel)?;
    safe_fs::assert_safe_path(
        path.parent()
            .ok_or_else(|| error("UnsafePath", "入口没有父目录"))?,
    )?;
    let meta = fs::symlink_metadata(path).map_err(|issue| {
        if issue.kind() == std::io::ErrorKind::NotFound {
            error("MissingEntry", "受管理的安装入口已丢失")
        } else {
            io(issue)
        }
    })?;
    if identity(path)? != entry.identity {
        return Err(error("EntryReplaced", "安装入口被其他程序替换，拒绝覆盖"));
    }
    if entry.view.mode == "copy" {
        if safe_fs::is_link(&meta) || !meta.is_dir() {
            return Err(error("EntryReplaced", "复制安装的入口类型已改变"));
        }
        if safe_fs::hash_tree(path, cancel)? != entry.hash {
            return Err(error(
                "LocalChangesDetected",
                "安装副本已被编辑，请先保留或导入修改",
            ));
        }
    } else {
        if !safe_fs::is_link(&meta) {
            return Err(error("EntryReplaced", "链接入口被普通目录替换"));
        }
        safe_fs::assert_safe_path(Path::new(&entry.revision_path))?;
        let expected = fs::canonicalize(&entry.revision_path).map_err(io)?;
        if fs::canonicalize(path).map_err(io)? != expected {
            return Err(error("EntryReplaced", "链接目标发生改变"));
        }
        if safe_fs::hash_tree(&expected, cancel)? != entry.hash {
            return Err(error("RevisionModified", "链接所指的 skill 版本已被编辑"));
        }
    }
    cancelled(cancel)?;
    if identity(path)? != entry.identity {
        return Err(error("EntryReplaced", "检查过程中入口发生变化"));
    }
    Ok(())
}

#[cfg(unix)]
fn symlink(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, destination)
}
#[cfg(windows)]
fn symlink(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(source, destination)
}

pub(super) fn prepare_entry<F>(
    destination: &Path,
    source: &Path,
    mode: &str,
    cancel: &AtomicBool,
    mut created: F,
) -> Result<()>
where
    F: FnMut(&str, String) -> Result<()>,
{
    cancelled(cancel)?;
    must_not_exist(destination)?;
    safe_fs::assert_safe_path(source)?;
    if mode == "auto" || mode == "symlink" {
        match symlink(source, destination) {
            Ok(()) => {
                created("symlink", identity(destination)?)?;
                return Ok(());
            }
            Err(issue) if mode == "symlink" => return Err(io(issue)),
            Err(_) => must_not_exist(destination)?,
        }
    }
    #[cfg(windows)]
    if mode == "auto" || mode == "junction" {
        match junction::create(source, destination) {
            Ok(()) => {
                created("junction", identity(destination)?)?;
                return Ok(());
            }
            Err(issue) if mode == "junction" => return Err(io(issue)),
            Err(_) => must_not_exist(destination)?,
        }
    }
    #[cfg(not(windows))]
    if mode == "junction" {
        return Err(error("UnsupportedMode", "junction 仅在 Windows 支持"));
    }
    let tree = safe_fs::inspect_tree(source, cancel)?;
    fs::create_dir(destination).map_err(io)?;
    // Persist ownership before copying so cancellation can safely remove an incomplete tree.
    created("copy", identity(destination)?)?;
    for directory in &tree.directories {
        cancelled(cancel)?;
        let output = destination.join(directory);
        safe_fs::assert_safe_path(&output)?;
        fs::create_dir(&output).map_err(io)?;
    }
    let mut total = 0u64;
    for relative in &tree.files {
        cancelled(cancel)?;
        let mut input_file = safe_fs::open_read_nofollow(&source.join(relative))?;
        let output = destination.join(relative);
        safe_fs::assert_safe_path(&output)?;
        let mut output_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output)
            .map_err(io)?;
        let mut count = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            cancelled(cancel)?;
            let bytes = input_file.read(&mut buffer).map_err(io)?;
            if bytes == 0 {
                break;
            }
            count += bytes as u64;
            total += bytes as u64;
            if count > safe_fs::MAX_FILE_BYTES || total > safe_fs::MAX_TOTAL_BYTES {
                return Err(error("LimitExceeded", "复制时文件超过安全大小限制"));
            }
            output_file.write_all(&buffer[..bytes]).map_err(io)?;
        }
        output_file.sync_all().map_err(io)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = input_file.metadata().map_err(io)?.permissions().mode() & 0o777;
            fs::set_permissions(&output, fs::Permissions::from_mode(mode)).map_err(io)?;
        }
    }
    if safe_fs::hash_tree(destination, cancel)? != tree.hash
        || safe_fs::hash_tree(source, cancel)? != tree.hash
    {
        return Err(error("SourceChanged", "复制过程中来源或目标内容发生变化"));
    }
    cancelled(cancel)
}

pub(super) fn prepare_lock<F>(path: &Path, content: &[u8], created: F) -> Result<()>
where
    F: FnOnce(String) -> Result<()>,
{
    safe_fs::assert_safe_path(path)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(io)?;
    created(identity(path)?)?;
    file.write_all(content).map_err(io)?;
    file.sync_all().map_err(io)
}

fn remove_entry(path: &Path, entry: &SavedDeployment, partial: bool) -> Result<()> {
    if !exists(path)? {
        return Ok(());
    }
    if entry.identity.is_empty() || identity(path)? != entry.identity {
        return Err(error("EntryReplaced", "待清理入口身份不匹配，保留文件"));
    }
    safe_fs::assert_safe_path(
        path.parent()
            .ok_or_else(|| error("UnsafePath", "入口没有父目录"))?,
    )?;
    if !partial {
        verify_entry(path, entry)?;
    }
    let meta = fs::symlink_metadata(path).map_err(io)?;
    if safe_fs::is_link(&meta) {
        if entry.view.mode == "copy" {
            return Err(error("EntryReplaced", "临时目录被链接替换，保留文件"));
        }
        #[cfg(windows)]
        {
            // RemoveDirectoryW unlinks a directory symlink/junction itself without
            // following its target. junction::delete only clears reparse data and
            // leaves an empty directory, which blocks restoring the old entry.
            fs::remove_dir(path).map_err(io)?;
        }
        #[cfg(unix)]
        fs::remove_file(path).map_err(io)?;
    } else {
        if entry.view.mode != "copy" || !meta.is_dir() {
            return Err(error("EntryReplaced", "临时入口类型不匹配"));
        }
        safe_fs::assert_safe_path(path)?;
        // Inspect first: never recursively delete a tree containing an introduced reparse point.
        safe_fs::hash_tree(path, &AtomicBool::new(false))?;
        if identity(path)? != entry.identity {
            return Err(error("EntryReplaced", "清理前目录身份发生变化"));
        }
        fs::remove_dir_all(path).map_err(io)?;
    }
    Ok(())
}

fn remove_file(path: &Path, expected_identity: Option<&str>, content: &str) -> Result<()> {
    if !exists(path)? {
        return Ok(());
    }
    safe_fs::assert_safe_path(path)?;
    let expected = expected_identity
        .ok_or_else(|| error("RecoveryRequired", "临时文件身份尚未记录，保留以供检查"))?;
    if identity(path)? != expected || safe_fs::read_text(path)? != content {
        return Err(error(
            "LocalChangesDetected",
            "待清理锁文件已被修改，保留原文件",
        ));
    }
    fs::remove_file(path).map_err(io)
}

pub(super) fn cleanup(journal: &Journal) -> Result<()> {
    let paths = Paths::new(journal)?;
    if let Some(before) = journal.before.as_ref() {
        remove_entry(&paths.backup, before, false)?;
    }
    if let Some(after) = journal.after.as_ref() {
        remove_entry(&paths.temp, after, true)?;
    }
    if let Some(old) = journal.lock_before.as_ref() {
        remove_file(
            &paths.lock_backup,
            journal.lock_old_identity.as_deref(),
            old,
        )?;
    }
    if exists(&paths.lock_temp)? {
        safe_fs::assert_safe_path(&paths.lock_temp)?;
        if journal.lock_new_identity.as_deref() != Some(identity(&paths.lock_temp)?.as_str()) {
            return Err(error(
                "RecoveryRequired",
                "临时锁文件身份不匹配，保留以供检查",
            ));
        }
        // A crash can leave an incompletely written lock, but this specific inode is ours.
        fs::remove_file(&paths.lock_temp).map_err(io)?;
    }
    Ok(())
}

pub(super) fn restore(journal: &Journal) -> Result<()> {
    let paths = Paths::new(journal)?;
    if exists(&paths.target)? {
        let actual = identity(&paths.target)?;
        if let Some(before) = journal.before.as_ref().filter(|old| old.identity == actual) {
            verify_entry(&paths.target, before)?;
        } else if let Some(after) = journal
            .after
            .as_ref()
            .filter(|new| new.identity == actual && !new.identity.is_empty())
        {
            remove_entry(&paths.target, after, false)?;
        } else {
            return Err(error("EntryReplaced", "恢复时发现未知目标，保留所有文件"));
        }
    }
    if let Some(before) = journal.before.as_ref() {
        if !exists(&paths.target)? {
            verify_entry(&paths.backup, before)?;
            must_not_exist(&paths.target)?;
            fs::rename(&paths.backup, &paths.target).map_err(io)?;
        } else if exists(&paths.backup)? {
            return Err(error("RecoveryRequired", "目标与备份同时存在，需要检查"));
        }
    }
    let current = read_lock(&paths.lock)?;
    if current != journal.lock_before {
        if let Some(value) = current.as_ref() {
            if value != &journal.lock_after {
                return Err(error("LockConflict", "恢复时锁文件被外部修改"));
            }
            remove_file(
                &paths.lock,
                journal.lock_new_identity.as_deref(),
                &journal.lock_after,
            )?;
        }
        if let Some(old) = journal.lock_before.as_ref() {
            if read_lock(&paths.lock_backup)?.as_ref() != Some(old)
                || journal.lock_old_identity.as_deref()
                    != Some(identity(&paths.lock_backup)?.as_str())
            {
                return Err(error("LockConflict", "恢复时旧锁文件备份身份不匹配"));
            }
            must_not_exist(&paths.lock)?;
            fs::rename(&paths.lock_backup, &paths.lock).map_err(io)?;
        }
    }
    cleanup(journal)
}
