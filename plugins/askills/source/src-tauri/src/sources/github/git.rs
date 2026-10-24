//! Use the installed Git in a private bare repository, never a user's worktree.
//! Read raw blobs instead of checking out files: hooks, filters and submodules
//! cannot execute from downloaded content. Git's own proxy/credential config is used.
use super::*;
use std::{
    process::{Command, Stdio},
    sync::{Arc, mpsc},
    thread,
    time::Instant,
};

const MAX_REPOSITORY_BYTES: u64 = 256 * 1024 * 1024;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

pub struct GitCatalog {
    pub catalog: Catalog,
    checkout: Checkout,
}

struct Checkout {
    root: TempDir,
}
impl Checkout {
    fn new(cancel: &AtomicBool) -> Result<Self> {
        check_cancel(cancel)?;
        let root = tempfile::Builder::new().prefix("askills-git-").tempdir()?;
        fs::create_dir(root.path().join("empty-template"))?;
        fs::create_dir(root.path().join("no-hooks"))?;
        let checkout = Self { root };
        let target = checkout.repository();
        let template = checkout.root.path().join("empty-template");
        checkout.run(
            &[
                "init",
                "--bare",
                "--object-format=sha1",
                &format!("--template={}", template.display()),
                target
                    .to_str()
                    .ok_or_else(|| AppError::new("GitPath", "Git 暂存目录必须是 UTF-8 路径"))?,
            ],
            64 * 1024,
            cancel,
        )?;
        Ok(checkout)
    }
    fn repository(&self) -> PathBuf {
        self.root.path().join("repo.git")
    }
    fn run(&self, args: &[&str], limit: usize, cancel: &AtomicBool) -> Result<Vec<u8>> {
        let mut command = git_command(Some(self.root.path()));
        command.arg(format!("--git-dir={}", self.repository().display()));
        command.args([
            "-c",
            &format!(
                "core.hooksPath={}",
                self.root.path().join("no-hooks").display()
            ),
        ]);
        command.args(args);
        run(
            command,
            limit,
            cancel,
            COMMAND_TIMEOUT,
            Some(self.root.path()),
        )
    }
}

pub fn version(cancel: &AtomicBool) -> Result<String> {
    let mut command = git_command(None);
    command.arg("--version");
    let output = run(command, 4096, cancel, Duration::from_secs(10), None)?;
    let version = String::from_utf8_lossy(&output).trim().to_string();
    if !version.starts_with("git version ") {
        return Err(AppError::new("GitVersion", "未识别到有效的 Git 安装"));
    }
    Ok(version)
}

fn git_command(directory: Option<&Path>) -> Command {
    let mut command = Command::new("git");
    if let Some(path) = directory {
        command.current_dir(path);
    }
    // Ignore inherited repository/config injections while retaining normal Git
    // system/global files (e.g. the user's HTTP proxy and credential helper).
    for (key, _) in std::env::vars_os() {
        if key
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("GIT_")
        {
            command.env_remove(key);
        }
    }
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env("GIT_ASKPASS", "")
        .env("SSH_ASKPASS_REQUIRE", "never");
    for setting in [
        "protocol.allow=never",
        "protocol.https.allow=always",
        "protocol.ssh.allow=always",
        "protocol.file.allow=never",
        "protocol.ext.allow=never",
        "http.followRedirects=false",
        "http.sslVerify=true",
        "fetch.recurseSubmodules=false",
        "transfer.fsckObjects=true",
        "fetch.fsckObjects=true",
        "gc.auto=0",
        "maintenance.auto=false",
    ] {
        command.args(["-c", setting]);
    }
    command
}

fn read_pipe(
    mut input: impl Read,
    limit: usize,
    overflow: &AtomicBool,
) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        if bytes.len() + count > limit {
            overflow.store(true, Ordering::Release);
            break;
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    Ok(bytes)
}

fn within_budget(root: &Path) -> Result<()> {
    let mut pending = vec![root.to_path_buf()];
    let mut total = 0u64;
    let mut entries = 0usize;
    while let Some(path) = pending.pop() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let metadata = match fs::symlink_metadata(entry.path()) {
                Ok(value) => value,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(e.into()),
            };
            entries += 1;
            if crate::platform::fs::is_link(&metadata) {
                return Err(AppError::new(
                    "GitUnsafeCache",
                    "Git 暂存目录出现链接，操作已停止",
                ));
            }
            if metadata.is_dir() {
                pending.push(entry.path());
            } else {
                total = total.saturating_add(metadata.len());
            }
            if total > MAX_REPOSITORY_BYTES || entries > 20_000 {
                return Err(AppError::new(
                    "GitLimit",
                    "Git 拉取的仓库超过 256 MiB 或条目上限，请改用 API 或本地导入",
                ));
            }
        }
    }
    Ok(())
}

fn stop(child: &mut std::process::Child) {
    // Target only the process started by this operation, including its helpers.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn run(
    mut command: Command,
    limit: usize,
    cancel: &AtomicBool,
    timeout: Duration,
    budget_root: Option<&Path>,
) -> Result<Vec<u8>> {
    check_cancel(cancel)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::new(
                    "GitNotInstalled",
                    "未找到本机 Git，请安装 Git 并重新启动 Askills，或切换 GitHub API",
                )
            } else {
                AppError::new("GitLaunch", format!("无法启动本机 Git：{e}"))
            }
        })?;
    let overflow = Arc::new(AtomicBool::new(false));
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let (tx, rx) = mpsc::channel();
    let out_overflow = overflow.clone();
    let out_tx = tx.clone();
    thread::spawn(move || {
        let _ = out_tx.send((true, read_pipe(stdout, limit, &out_overflow)));
    });
    let err_overflow = overflow.clone();
    thread::spawn(move || {
        let _ = tx.send((false, read_pipe(stderr, 64 * 1024, &err_overflow)));
    });
    let start = Instant::now();
    let mut checked = Instant::now();
    let status = loop {
        let failure = if cancel.load(Ordering::Acquire) {
            Some(cancelled())
        } else if start.elapsed() > timeout {
            Some(AppError::new(
                "GitTimeout",
                "Git 操作超时；请检查本机代理、网络或凭据配置",
            ))
        } else if overflow.load(Ordering::Acquire) {
            Some(AppError::new("GitLimit", "Git 输出超过安全限额"))
        } else if checked.elapsed() > Duration::from_millis(200) {
            checked = Instant::now();
            budget_root.and_then(|p| within_budget(p).err())
        } else {
            None
        };
        if let Some(error) = failure {
            stop(&mut child);
            return Err(error);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => {
                stop(&mut child);
                return Err(error.into());
            }
        }
    };
    let mut output = Vec::new();
    for _ in 0..2 {
        let (is_stdout, bytes) = rx
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| AppError::new("GitOutput", "无法完成 Git 输出读取"))?;
        let bytes = bytes.map_err(AppError::from)?;
        if is_stdout {
            output = bytes;
        }
        // Never expose raw stderr: credential helpers or proxy URLs can print secrets.
    }
    if overflow.load(Ordering::Acquire) {
        return Err(AppError::new("GitLimit", "Git 输出超过安全限额"));
    }
    check_cancel(cancel)?;
    if !status.success() {
        return Err(AppError::new(
            "GitFailed",
            "本机 Git 操作失败。请检查仓库/版本是否存在、本机代理和已配置凭据；交互登录提示已禁用，也可切换 GitHub API",
        ));
    }
    if let Some(root) = budget_root {
        within_budget(root)?;
    }
    Ok(output)
}

pub fn resolve(repository: &str, reference: &str, cancel: &AtomicBool) -> Result<GitCatalog> {
    let repo = parse_repository(repository)?;
    let reference = if reference.trim().is_empty() {
        "HEAD"
    } else {
        reference.trim()
    };
    validate_reference(reference)?;
    if reference.starts_with('-') {
        return Err(AppError::new("GitReference", "版本不能以连字符开头"));
    }
    let checkout = Checkout::new(cancel)?;
    let remote = format!("https://github.com/{}/{}.git", repo.owner, repo.name);
    checkout.run(
        &[
            "fetch",
            "--depth=1",
            "--no-tags",
            "--no-recurse-submodules",
            "--no-auto-maintenance",
            "--no-progress",
            "--",
            &remote,
            reference,
        ],
        64 * 1024,
        cancel,
    )?;
    from_checkout(checkout, repo, reference.into(), cancel)
}

fn from_checkout(
    checkout: Checkout,
    repo: Repository,
    reference: String,
    cancel: &AtomicBool,
) -> Result<GitCatalog> {
    let commit = text_output(checkout.run(
        &["rev-parse", "--verify", "FETCH_HEAD^{commit}"],
        128,
        cancel,
    )?)?;
    validate_sha(&commit)?;
    let tree_sha = text_output(checkout.run(
        &["rev-parse", "--verify", &format!("{commit}^{{tree}}")],
        128,
        cancel,
    )?)?;
    validate_sha(&tree_sha)?;
    let tree = parse_tree(
        &checkout.run(
            &["ls-tree", "-r", "-t", "-l", "-z", "--full-tree", &commit],
            MAX_TREE_BYTES,
            cancel,
        )?,
        tree_sha,
    )?;
    let catalog = catalog_from_tree(repo, reference, commit, tree, cancel)?;
    Ok(GitCatalog { catalog, checkout })
}

fn text_output(bytes: Vec<u8>) -> Result<String> {
    String::from_utf8(bytes)
        .map(|s| s.trim().to_string())
        .map_err(|_| AppError::new("GitEncoding", "Git 输出不是 UTF-8"))
}

fn parse_tree(bytes: &[u8], sha: String) -> Result<TreeResponse> {
    if !bytes.is_empty() && !bytes.ends_with(&[0]) {
        return Err(AppError::new("GitTree", "Git 目录树输出不完整"));
    }
    let mut tree = Vec::new();
    for record in bytes.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let text = std::str::from_utf8(record)
            .map_err(|_| AppError::new("GitEncoding", "Git 路径不是 UTF-8"))?;
        let (header, path) = text
            .split_once('\t')
            .ok_or_else(|| AppError::new("GitTree", "无法解析 Git 目录树"))?;
        let parts: Vec<_> = header.split_whitespace().collect();
        if parts.len() != 4 {
            return Err(AppError::new("GitTree", "Git 目录树元数据无效"));
        }
        let size = if parts[3] == "-" {
            None
        } else {
            Some(
                parts[3]
                    .parse::<u64>()
                    .map_err(|_| AppError::new("GitTree", "Git 文件大小无效"))?,
            )
        };
        tree.push(TreeEntry {
            path: path.into(),
            mode: parts[0].into(),
            kind: parts[1].into(),
            sha: parts[2].into(),
            size,
        });
        if tree.len() > MAX_TREE_ENTRIES {
            return Err(AppError::new("GitLimit", "仓库目录树过大"));
        }
    }
    Ok(TreeResponse {
        sha,
        tree,
        truncated: false,
    })
}

pub fn download(resolved: &GitCatalog, skill_path: &str, cancel: &AtomicBool) -> Result<Download> {
    download_with_progress(resolved, skill_path, cancel, &|_| {})
}

pub fn download_with_progress(
    resolved: &GitCatalog,
    skill_path: &str,
    cancel: &AtomicBool,
    progress: &dyn Fn(DownloadProgress),
) -> Result<Download> {
    check_cancel(cancel)?;
    let catalog = &resolved.catalog;
    let files = plan_download(catalog, skill_path)?;
    let mut completed = DownloadProgress::new(&files);
    let directory = tempfile::Builder::new()
        .prefix("askills-git-skill-")
        .tempdir()?;
    let stage = directory.path().join("skill");
    fs::create_dir(&stage)?;
    progress(completed.clone());
    let mut blobs = BTreeMap::new();
    for file in files {
        check_cancel(cancel)?;
        completed.current_file.clone_from(&file.destination);
        progress(completed.clone());
        check_cancel(cancel)?;
        let content = match blobs.entry(file.entry.sha.clone()) {
            Entry::Vacant(entry) => {
                let bytes = resolved.checkout.run(
                    &["cat-file", "blob", &file.entry.sha],
                    MAX_FILE_BYTES as usize,
                    cancel,
                )?;
                // Share the API's size/object identity checks, even if local Git
                // storage is externally tampered with after catalog resolution.
                let blob = BlobResponse {
                    sha: file.entry.sha.clone(),
                    encoding: "base64".into(),
                    size: bytes.len() as u64,
                    content: STANDARD.encode(&bytes),
                };
                entry.insert(decode_blob(&blob, file.entry)?)
            }
            Entry::Occupied(entry) => entry.into_mut(),
        };
        if content.len() as u64 != file.entry.size.unwrap_or(u64::MAX) {
            return Err(AppError::new(
                "github_blob_size",
                "相同内容 SHA 对应了不一致的文件大小",
            ));
        }
        write_stage_file(&stage, &file.destination, content, &file.entry.mode)?;
        check_cancel(cancel)?;
        completed.completed_files += 1;
        completed.completed_bytes += content.len() as u64;
        progress(completed.clone());
    }
    Ok(Download {
        directory,
        skill_path: stage,
        source: SkillSource {
            kind: "github".into(),
            url: Some(catalog.repository.clone()),
            reference: Some(catalog.reference.clone()),
            commit: Some(catalog.commit.clone()),
            subpath: Some(skill_path.into()),
            local_path: None,
        },
    })
}

#[cfg(test)]
mod tests;
