//! GitHub public repositories, pinned to an immutable commit before any download.
//!
//! API responses never supply request URLs or filesystem authority: URLs are built
//! against one fixed HTTPS origin and paths are validated before staging files.

use std::{
    collections::{BTreeMap, HashMap, HashSet, btree_map::Entry},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{StatusCode, blocking::Client, redirect::Policy};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha1::{Digest, Sha1};
use tempfile::TempDir;
use url::Url;

use crate::domain::{AppError, Result, SkillSource};

pub mod git;

const API_ORIGIN: &str = "https://api.github.com";
const API_VERSION: &str = "2022-11-28";
const MAX_TREE_BYTES: usize = 10 * 1024 * 1024;
const MAX_TREE_ENTRIES: usize = 100_000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_SKILL_BYTES: u64 = 32 * 1024 * 1024;
const MAX_SKILL_FILES: usize = 1_000;
const LICENSE_DIRECTORY: &str = ".askills-source-licenses";

/// Only this summary crosses IPC. The validated tree stays in backend state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub repository: String,
    pub reference: String,
    pub commit: String,
    pub candidates: Vec<Candidate>,
    #[serde(skip)]
    repo: Repository,
    #[serde(skip)]
    tree: Vec<TreeEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// Empty means the repository root. Never interpret this as a local path.
    pub path: String,
    /// Directory label only; SKILL.md frontmatter is parsed during import preview.
    pub name: String,
    pub file_count: usize,
    pub total_bytes: u64,
}

/// Keep `directory` alive until library inspection/import has finished.
#[derive(Debug)]
pub struct Download {
    pub directory: TempDir,
    pub skill_path: PathBuf,
    pub source: SkillSource,
}

/// Counts validated files written to the private stage, including source licenses.
/// This measures completed download work, not network transfer or library import.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub completed_files: usize,
    pub total_files: usize,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub current_file: String,
}

impl DownloadProgress {
    fn new(files: &[PlannedFile<'_>]) -> Self {
        Self {
            completed_files: 0,
            total_files: files.len(),
            completed_bytes: 0,
            // plan_download has already checked presence, limits and overflow.
            total_bytes: files.iter().map(|file| file.entry.size.unwrap_or(0)).sum(),
            current_file: String::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct Repository {
    owner: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct RepositoryResponse {
    private: bool,
    default_branch: String,
}

#[derive(Debug, Deserialize)]
struct CommitResponse {
    sha: String,
    commit: CommitDetails,
}

#[derive(Debug, Deserialize)]
struct CommitDetails {
    tree: ObjectId,
}

#[derive(Debug, Deserialize)]
struct ObjectId {
    sha: String,
}

#[derive(Debug, Deserialize)]
struct TreeResponse {
    sha: String,
    tree: Vec<TreeEntry>,
    truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct TreeEntry {
    path: String,
    mode: String,
    #[serde(rename = "type")]
    kind: String,
    sha: String,
    size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct BlobResponse {
    sha: String,
    encoding: String,
    size: u64,
    content: String,
}

/// Resolve the repository URL and a separate branch/tag/SHA (blank = default).
/// URLs containing `/tree/...` are intentionally rejected: refs may contain `/`.
pub fn resolve(repository: &str, reference: &str, cancel: &AtomicBool) -> Result<Catalog> {
    resolve_with(&GitHubApi::new()?, repository, reference, cancel)
}

/// Download a candidate from an already resolved, backend-owned catalog.
pub fn download(catalog: &Catalog, skill_path: &str, cancel: &AtomicBool) -> Result<Download> {
    download_with_progress(catalog, skill_path, cancel, &|_| {})
}

pub fn download_with_progress(
    catalog: &Catalog,
    skill_path: &str,
    cancel: &AtomicBool,
    progress: &dyn Fn(DownloadProgress),
) -> Result<Download> {
    download_using_transport(&GitHubApi::new()?, catalog, skill_path, cancel, progress)
}

/// This trait is private; no production API accepts a configurable HTTP origin.
trait Transport {
    fn get(
        &self,
        segments: &[&str],
        query: &[(&str, &str)],
        limit: usize,
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>>;
}

struct GitHubApi {
    client: Client,
}

impl GitHubApi {
    fn new() -> Result<Self> {
        let client = Client::builder()
            .user_agent(concat!("Askills/", env!("CARGO_PKG_VERSION")))
            .https_only(true)
            .redirect(Policy::none())
            .referer(false)
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(25))
            .build()
            .map_err(|_| AppError::new("github_client", "无法初始化 GitHub HTTPS 客户端"))?;
        Ok(Self { client })
    }
}

impl Transport for GitHubApi {
    fn get(
        &self,
        segments: &[&str],
        query: &[(&str, &str)],
        limit: usize,
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>> {
        check_cancel(cancel)?;
        let url = api_url(segments, query)?;
        // No Authorization header, credential store, shell, or git invocation.
        let mut response = self
            .client
            .get(url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .send()
            .map_err(|error| {
                if cancel.load(Ordering::Relaxed) {
                    cancelled()
                } else if error.is_timeout() {
                    AppError::new("github_timeout", "GitHub 请求超时，请检查网络后重试")
                } else {
                    AppError::new("github_network", "无法连接 GitHub，请检查网络或代理设置")
                }
            })?;
        check_cancel(cancel)?;
        if response.status() != StatusCode::OK {
            let remaining = response
                .headers()
                .get("x-ratelimit-remaining")
                .and_then(|v| v.to_str().ok());
            let retry = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok());
            return Err(http_error(response.status(), remaining, retry));
        }
        if response
            .content_length()
            .is_some_and(|length| length > limit as u64)
        {
            return Err(AppError::new(
                "github_response_limit",
                "GitHub 响应超出允许大小",
            ));
        }
        read_limited(&mut response, limit, cancel)
    }
}

fn api_url(segments: &[&str], query: &[(&str, &str)]) -> Result<Url> {
    let mut url =
        Url::parse(API_ORIGIN).map_err(|_| AppError::new("github_url", "GitHub API 地址无效"))?;
    url.path_segments_mut()
        .map_err(|_| AppError::new("github_url", "GitHub API 路径无效"))?
        .extend(segments);
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query.iter().copied());
    }
    Ok(url)
}

fn http_error(status: StatusCode, remaining: Option<&str>, retry: Option<&str>) -> AppError {
    if status == StatusCode::TOO_MANY_REQUESTS
        || (status == StatusCode::FORBIDDEN && (remaining == Some("0") || retry.is_some()))
    {
        let hint = retry
            .and_then(|value| value.parse::<u64>().ok())
            .map(|seconds| format!("，请在 {seconds} 秒后重试"))
            .unwrap_or_else(|| "，请稍后重试（未登录的公共 API 有请求额度限制）".into());
        return AppError::new(
            "github_rate_limit",
            format!("GitHub 请求额度已用尽或触发限流{hint}"),
        );
    }
    match status {
        StatusCode::NOT_FOUND => AppError::new(
            "github_not_found",
            "未找到公开仓库、分支、标签或提交；请检查输入，目前仅支持公开仓库",
        ),
        StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED => AppError::new(
            "github_forbidden",
            "GitHub 拒绝访问；目前仅支持无需登录的公开仓库，也可能触发了临时限流",
        ),
        StatusCode::CONFLICT => AppError::new("github_empty", "仓库为空或 GitHub 无法解析当前提交"),
        status if status.is_redirection() => AppError::new(
            "github_redirect",
            "仓库地址发生重定向；请使用仓库当前的完整 GitHub 地址重新预览",
        ),
        _ => AppError::new(
            "github_http",
            format!("GitHub 返回 HTTP {}，请检查输入或稍后重试", status.as_u16()),
        ),
    }
}

fn read_limited(reader: &mut impl Read, limit: usize, cancel: &AtomicBool) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        check_cancel(cancel)?;
        let read = reader.read(&mut buffer).map_err(|_| {
            if cancel.load(Ordering::Relaxed) {
                cancelled()
            } else {
                AppError::new("github_read", "读取 GitHub 响应失败或超时，请重试")
            }
        })?;
        if read == 0 {
            break;
        }
        if bytes.len().saturating_add(read) > limit {
            return Err(AppError::new(
                "github_response_limit",
                "GitHub 响应超出允许大小",
            ));
        }
        bytes.extend_from_slice(&buffer[..read]);
    }
    check_cancel(cancel)?;
    Ok(bytes)
}

fn get_json<T: DeserializeOwned>(
    transport: &impl Transport,
    segments: &[&str],
    query: &[(&str, &str)],
    limit: usize,
    cancel: &AtomicBool,
) -> Result<T> {
    let bytes = transport.get(segments, query, limit, cancel)?;
    serde_json::from_slice(&bytes)
        .map_err(|_| AppError::new("github_response", "GitHub 返回的数据格式不完整或无效"))
}

fn resolve_with(
    transport: &impl Transport,
    repository: &str,
    reference: &str,
    cancel: &AtomicBool,
) -> Result<Catalog> {
    check_cancel(cancel)?;
    let repo = parse_repository(repository)?;
    let metadata: RepositoryResponse = get_json(
        transport,
        &["repos", &repo.owner, &repo.name],
        &[],
        256 * 1024,
        cancel,
    )?;
    if metadata.private {
        return Err(AppError::new(
            "github_private",
            "目前仅支持 GitHub 公开仓库",
        ));
    }
    let reference = if reference.trim().is_empty() {
        metadata.default_branch
    } else {
        reference.trim().into()
    };
    validate_reference(&reference)?;
    let commit: CommitResponse = get_json(
        transport,
        &["repos", &repo.owner, &repo.name, "commits", &reference],
        &[("per_page", "1")],
        3 * 1024 * 1024,
        cancel,
    )?;
    validate_sha(&commit.sha)?;
    validate_sha(&commit.commit.tree.sha)?;
    let tree: TreeResponse = get_json(
        transport,
        &[
            "repos",
            &repo.owner,
            &repo.name,
            "git",
            "trees",
            &commit.commit.tree.sha,
        ],
        &[("recursive", "1")],
        MAX_TREE_BYTES,
        cancel,
    )?;
    validate_tree(&tree, &commit.commit.tree.sha, cancel)?;
    catalog_from_tree(repo, reference, commit.sha, tree, cancel)
}

fn catalog_from_tree(
    repo: Repository,
    reference: String,
    commit: String,
    tree: TreeResponse,
    cancel: &AtomicBool,
) -> Result<Catalog> {
    validate_sha(&commit)?;
    validate_tree(&tree, &tree.sha, cancel)?;
    // Aggregate once per ancestor; a repository with many skills must not turn
    // candidate discovery into a quadratic scan of the complete tree.
    let mut directory_sizes: HashMap<&str, (usize, u64)> = HashMap::new();
    for file in tree.tree.iter().filter(|entry| entry.kind == "blob") {
        check_cancel(cancel)?;
        let mut parent = file
            .path
            .rsplit_once('/')
            .map(|(parent, _)| parent)
            .unwrap_or("");
        loop {
            let aggregate = directory_sizes.entry(parent).or_default();
            aggregate.0 += 1;
            aggregate.1 = aggregate
                .1
                .checked_add(file.size.unwrap_or(0))
                .ok_or_else(|| AppError::new("github_size", "仓库文件大小数据无效"))?;
            if parent.is_empty() {
                break;
            }
            parent = parent
                .rsplit_once('/')
                .map(|(parent, _)| parent)
                .unwrap_or("");
        }
    }
    let mut candidates = Vec::new();
    for entry in &tree.tree {
        if entry.kind != "blob" || entry.path.rsplit('/').next() != Some("SKILL.md") {
            continue;
        }
        let path = entry
            .path
            .rsplit_once('/')
            .map(|(parent, _)| parent)
            .unwrap_or("");
        let (file_count, total_bytes) = directory_sizes.get(path).copied().unwrap_or_default();
        candidates.push(Candidate {
            path: path.into(),
            name: path
                .rsplit('/')
                .next()
                .filter(|name| !name.is_empty())
                .unwrap_or(&repo.name)
                .into(),
            file_count,
            total_bytes,
        });
    }
    candidates.sort_by(|left, right| left.path.cmp(&right.path));
    if candidates.is_empty() {
        return Err(AppError::new(
            "github_no_skills",
            "该提交中没有找到名称完全匹配的 SKILL.md",
        ));
    }
    check_cancel(cancel)?;
    Ok(Catalog {
        repository: format!("https://github.com/{}/{}", repo.owner, repo.name),
        reference,
        commit,
        candidates,
        repo,
        tree: tree.tree,
    })
}

pub fn canonical_repository(input: &str) -> Result<String> {
    let repo = parse_repository(input)?;
    Ok(format!("https://github.com/{}/{}", repo.owner, repo.name))
}

fn parse_repository(input: &str) -> Result<Repository> {
    let input = input.trim();
    let path = if input.contains("://") {
        let url = Url::parse(input).map_err(|_| invalid_repository())?;
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(invalid_repository());
        }
        // Inspect the original path too: Url normalizes dot segments on parsing.
        input
            .split_once("://")
            .and_then(|(_, authority)| authority.split_once('/'))
            .map(|(_, path)| path)
            .ok_or_else(invalid_repository)?
    } else {
        input
    };
    let parts: Vec<_> = path.trim_end_matches('/').split('/').collect();
    if parts.len() != 2 {
        return Err(invalid_repository());
    }
    let owner = parts[0];
    let name = parts[1].strip_suffix(".git").unwrap_or(parts[1]);
    if owner.is_empty()
        || owner.len() > 39
        || owner.starts_with('-')
        || owner.ends_with('-')
        || !owner
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        || name.is_empty()
        || name.len() > 100
        || name == "."
        || name == ".."
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(invalid_repository());
    }
    Ok(Repository {
        // GitHub coordinates are case-insensitive; stable casing also prevents
        // duplicate source identities when users paste differently cased URLs.
        owner: owner.to_ascii_lowercase(),
        name: name.to_ascii_lowercase(),
    })
}

fn invalid_repository() -> AppError {
    AppError::new(
        "github_repository",
        "请输入 owner/repository 或 https://github.com/owner/repository；分支、标签或提交请填在独立的版本输入框中",
    )
}

fn validate_reference(reference: &str) -> Result<()> {
    if reference.is_empty()
        || reference.len() > 512
        || reference == "@"
        || reference.starts_with('/')
        || reference.ends_with('/')
        || reference.ends_with('.')
        || reference.contains("..")
        || reference.contains("//")
        || reference.contains("@{")
        || reference
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace() || "~^:?*[\\".contains(ch))
        || reference
            .split('/')
            .any(|part| part.starts_with('.') || part.ends_with(".lock"))
    {
        return Err(AppError::new(
            "github_reference",
            "分支、标签或提交格式无效；允许在独立版本字段中使用带 / 的分支名称",
        ));
    }
    Ok(())
}

fn validate_sha(sha: &str) -> Result<()> {
    if sha.len() != 40
        || !sha
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AppError::new(
            "github_sha",
            "GitHub 返回了无效的完整对象 SHA",
        ));
    }
    Ok(())
}

fn validate_tree(tree: &TreeResponse, expected_sha: &str, cancel: &AtomicBool) -> Result<()> {
    if tree.truncated || tree.tree.len() > MAX_TREE_ENTRIES {
        return Err(AppError::new(
            "github_tree_truncated",
            "仓库目录树过大或已被 GitHub 截断，无法保证完整下载；请先将目标 skill 完整保存到本地后导入",
        ));
    }
    if tree.sha != expected_sha {
        return Err(AppError::new(
            "github_tree_sha",
            "仓库目录树与固定提交不匹配",
        ));
    }
    let mut paths = HashMap::new();
    for entry in &tree.tree {
        check_cancel(cancel)?;
        validate_path(&entry.path)?;
        validate_sha(&entry.sha)?;
        match (entry.kind.as_str(), entry.mode.as_str()) {
            ("blob", "100644" | "100755") if entry.size.is_some() => {}
            ("tree", "040000") => {}
            ("blob", "120000") | ("commit", "160000") => {
                return Err(AppError::new(
                    "github_unsafe_entry",
                    format!("仓库包含符号链接或子模块，无法完整安全导入：{}", entry.path),
                ));
            }
            _ => {
                return Err(AppError::new(
                    "github_entry_type",
                    format!("仓库文件类型或大小信息无效：{}", entry.path),
                ));
            }
        }
        // Uppercase folds ASCII and common Unicode aliases (e.g. sharp s).
        if paths.insert(entry.path.to_uppercase(), entry).is_some() {
            return Err(AppError::new(
                "github_path_collision",
                format!("仓库存在重复或大小写冲突路径：{}", entry.path),
            ));
        }
    }
    for entry in &tree.tree {
        let mut parent = entry.path.as_str();
        while let Some((prefix, _)) = parent.rsplit_once('/') {
            let directory = paths
                .get(&prefix.to_uppercase())
                .ok_or_else(|| AppError::new("github_missing_parent", "仓库目录树缺少父目录"))?;
            if directory.kind != "tree" || directory.path != prefix {
                return Err(AppError::new(
                    "github_path_collision",
                    format!("仓库父目录与文件冲突：{}", entry.path),
                ));
            }
            parent = prefix;
        }
    }
    Ok(())
}

fn validate_path(path: &str) -> Result<()> {
    if path.is_empty()
        || path.len() > 1024
        || path.split('/').count() > 32
        || path
            .chars()
            .any(|ch| ch.is_control() || "\\<>:\"|?*".contains(ch))
    {
        return Err(unsafe_path(path));
    }
    for component in path.split('/') {
        let stem = component.split('.').next().unwrap_or("").to_uppercase();
        let device = matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|number| {
                matches!(
                    number,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
        if component.is_empty()
            || component == "."
            || component == ".."
            || component.len() > 255
            || component.ends_with('.')
            || component.ends_with(' ')
            || component.eq_ignore_ascii_case(".git")
            || device
        {
            return Err(unsafe_path(path));
        }
    }
    Ok(())
}

fn unsafe_path(path: &str) -> AppError {
    AppError::new(
        "github_unsafe_path",
        format!("仓库路径不安全或不兼容本地文件系统：{path}"),
    )
}

fn relative_path<'a>(path: &'a str, directory: &str) -> Option<&'a str> {
    if directory.is_empty() {
        Some(path)
    } else {
        path.strip_prefix(directory)?.strip_prefix('/')
    }
}

struct PlannedFile<'a> {
    entry: &'a TreeEntry,
    destination: String,
}

fn plan_download<'a>(catalog: &'a Catalog, skill_path: &str) -> Result<Vec<PlannedFile<'a>>> {
    if !catalog
        .candidates
        .iter()
        .any(|candidate| candidate.path == skill_path)
    {
        return Err(AppError::new(
            "github_candidate",
            "所选 skill 不在本次仓库预览中，请重新预览",
        ));
    }
    let mut files = Vec::new();
    for entry in catalog.tree.iter().filter(|entry| entry.kind == "blob") {
        if let Some(relative) = relative_path(&entry.path, skill_path) {
            if relative
                .split('/')
                .next()
                .is_some_and(|part| part.eq_ignore_ascii_case(LICENSE_DIRECTORY))
            {
                return Err(AppError::new(
                    "github_reserved_path",
                    format!(
                        "skill 使用了来源许可证保留目录 {LICENSE_DIRECTORY}，请改为本地导入并检查许可文件"
                    ),
                ));
            }
            files.push(PlannedFile {
                entry,
                destination: relative.into(),
            });
        } else if is_ancestor_license(&entry.path, skill_path) {
            // Preserve root and intermediate licenses without replacing a skill's own license.
            files.push(PlannedFile {
                entry,
                destination: format!("{LICENSE_DIRECTORY}/{}", entry.path),
            });
        }
    }
    let mut total = 0_u64;
    let mut destinations = HashSet::new();
    for file in &files {
        validate_path(&file.destination)?;
        let size = file
            .entry
            .size
            .ok_or_else(|| AppError::new("github_size", "仓库文件缺少大小信息"))?;
        if size > MAX_FILE_BYTES {
            return Err(AppError::new(
                "github_file_limit",
                format!("单个文件超过 2 MiB：{}", file.entry.path),
            ));
        }
        total = total
            .checked_add(size)
            .ok_or_else(|| AppError::new("github_skill_limit", "skill 总大小无效"))?;
        if !destinations.insert(file.destination.to_uppercase()) {
            return Err(AppError::new(
                "github_path_collision",
                "下载目标包含冲突文件",
            ));
        }
    }
    if files.len() > MAX_SKILL_FILES || total > MAX_SKILL_BYTES {
        return Err(AppError::new(
            "github_skill_limit",
            "一个 skill（含来源许可证）最多支持 1000 个文件、32 MiB",
        ));
    }
    files.sort_by(|left, right| left.destination.cmp(&right.destination));
    Ok(files)
}

fn is_ancestor_license(path: &str, skill_path: &str) -> bool {
    let (directory, filename) = path.rsplit_once('/').unwrap_or(("", path));
    let filename = filename.to_ascii_uppercase();
    let legal_file = [
        "LICENSE",
        "LICENCE",
        "COPYING",
        "NOTICE",
        "COPYRIGHT",
        "AUTHORS",
    ]
    .iter()
    .any(|name| {
        filename == *name
            || filename
                .strip_prefix(name)
                .is_some_and(|suffix| suffix.starts_with('.') || suffix.starts_with('-'))
    });
    legal_file
        && !skill_path.is_empty()
        && (directory.is_empty()
            || skill_path
                .strip_prefix(directory)
                .is_some_and(|suffix| suffix.starts_with('/')))
}

#[cfg(test)]
fn download_with(
    transport: &impl Transport,
    catalog: &Catalog,
    skill_path: &str,
    cancel: &AtomicBool,
) -> Result<Download> {
    download_using_transport(transport, catalog, skill_path, cancel, &|_| {})
}

fn download_using_transport(
    transport: &impl Transport,
    catalog: &Catalog,
    skill_path: &str,
    cancel: &AtomicBool,
    progress: &dyn Fn(DownloadProgress),
) -> Result<Download> {
    check_cancel(cancel)?;
    let files = plan_download(catalog, skill_path)?;
    let mut completed = DownloadProgress::new(&files);
    let directory = tempfile::Builder::new()
        .prefix("askills-github-")
        .tempdir()
        .map_err(|_| AppError::new("github_stage", "无法创建 skill 下载临时目录"))?;
    let stage = directory.path().join("skill");
    fs::create_dir(&stage).map_err(|_| AppError::new("github_stage", "无法创建 skill 暂存目录"))?;
    progress(completed.clone());
    // Deduplicate content requests without retaining more than the 32 MiB skill limit.
    let mut blobs = BTreeMap::new();
    for file in files {
        check_cancel(cancel)?;
        completed.current_file.clone_from(&file.destination);
        progress(completed.clone());
        check_cancel(cancel)?;
        let content = match blobs.entry(file.entry.sha.clone()) {
            Entry::Vacant(entry) => {
                let blob: BlobResponse = get_json(
                    transport,
                    &[
                        "repos",
                        &catalog.repo.owner,
                        &catalog.repo.name,
                        "git",
                        "blobs",
                        &file.entry.sha,
                    ],
                    &[],
                    (MAX_FILE_BYTES as usize * 2) + 64 * 1024,
                    cancel,
                )?;
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

fn decode_blob(blob: &BlobResponse, expected: &TreeEntry) -> Result<Vec<u8>> {
    if blob.sha != expected.sha
        || blob.encoding != "base64"
        || blob.size != expected.size.unwrap_or(u64::MAX)
        || blob.size > MAX_FILE_BYTES
    {
        return Err(AppError::new(
            "github_blob",
            format!("下载文件元数据与固定提交不匹配：{}", expected.path),
        ));
    }
    let base64: String = blob
        .content
        .chars()
        .filter(|ch| !matches!(ch, '\r' | '\n'))
        .collect();
    let bytes = STANDARD
        .decode(base64)
        .map_err(|_| AppError::new("github_blob_encoding", "GitHub 返回的文件编码无效"))?;
    if bytes.len() as u64 != blob.size {
        return Err(AppError::new(
            "github_blob_size",
            format!("下载文件大小与固定提交不匹配：{}", expected.path),
        ));
    }
    let mut hash = Sha1::new();
    hash.update(format!("blob {}\0", bytes.len()).as_bytes());
    hash.update(&bytes);
    if format!("{:x}", hash.finalize()) != expected.sha {
        return Err(AppError::new(
            "github_blob_integrity",
            format!("下载文件内容校验失败：{}", expected.path),
        ));
    }
    Ok(bytes)
}

fn write_stage_file(stage: &Path, destination: &str, bytes: &[u8], mode: &str) -> Result<()> {
    validate_path(destination)?;
    let target = stage.join(destination);
    let parent = target.parent().ok_or_else(|| unsafe_path(destination))?;
    fs::create_dir_all(parent)
        .map_err(|_| AppError::new("github_stage", "无法创建下载文件的目录"))?;
    // The stage is fresh/private; create_new additionally prevents any overwrite.
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|_| AppError::new("github_stage", format!("无法创建下载文件：{destination}")))?;
    file.write_all(bytes)
        .map_err(|_| AppError::new("github_stage", "保存下载文件失败"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(if mode == "100755" {
            0o755
        } else {
            0o644
        }))
        .map_err(|_| AppError::new("github_stage", "无法保留下载文件权限"))?;
    }
    #[cfg(not(unix))]
    let _ = mode;
    Ok(())
}

fn cancelled() -> AppError {
    AppError::new("cancelled", "已取消 GitHub 操作")
}

fn check_cancel(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(cancelled())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests;
