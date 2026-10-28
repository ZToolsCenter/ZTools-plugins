use super::*;
use std::{cell::RefCell, collections::VecDeque, io::Cursor};

use serde_json::{Value, json};

const COMMIT: &str = "1111111111111111111111111111111111111111";
const TREE: &str = "2222222222222222222222222222222222222222";
static CANCEL: AtomicBool = AtomicBool::new(false);

struct ExpectedRequest {
    segments: Vec<String>,
    query: Vec<(String, String)>,
    response: Value,
}

#[derive(Default)]
struct FixtureTransport {
    requests: RefCell<VecDeque<ExpectedRequest>>,
}

impl FixtureTransport {
    fn add(&self, segments: &[&str], query: &[(&str, &str)], response: Value) {
        self.requests.borrow_mut().push_back(ExpectedRequest {
            segments: segments.iter().map(|segment| (*segment).into()).collect(),
            query: query
                .iter()
                .map(|(key, value)| ((*key).into(), (*value).into()))
                .collect(),
            response,
        });
    }

    fn assert_finished(&self) {
        assert!(
            self.requests.borrow().is_empty(),
            "some fixture requests were not used"
        );
    }
}

impl Transport for FixtureTransport {
    fn get(
        &self,
        segments: &[&str],
        query: &[(&str, &str)],
        limit: usize,
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>> {
        check_cancel(cancel)?;
        let expected = self
            .requests
            .borrow_mut()
            .pop_front()
            .expect("unexpected network request");
        assert_eq!(segments, expected.segments);
        assert_eq!(
            query
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                .collect::<Vec<_>>(),
            expected.query
        );
        let bytes = serde_json::to_vec(&expected.response).unwrap();
        assert!(bytes.len() <= limit);
        Ok(bytes)
    }
}

fn blob_sha(bytes: &[u8]) -> String {
    let mut sha = Sha1::new();
    sha.update(format!("blob {}\0", bytes.len()).as_bytes());
    sha.update(bytes);
    format!("{:x}", sha.finalize())
}

fn blob(path: &str, bytes: &[u8]) -> TreeEntry {
    TreeEntry {
        path: path.into(),
        mode: "100644".into(),
        kind: "blob".into(),
        sha: blob_sha(bytes),
        size: Some(bytes.len() as u64),
    }
}

fn dir(path: &str) -> TreeEntry {
    TreeEntry {
        path: path.into(),
        mode: "040000".into(),
        kind: "tree".into(),
        sha: TREE.into(),
        size: None,
    }
}

fn tree(entries: Vec<TreeEntry>) -> TreeResponse {
    TreeResponse {
        sha: TREE.into(),
        tree: entries,
        truncated: false,
    }
}

fn entry_json(entry: &TreeEntry) -> Value {
    json!({"path":entry.path,"type":entry.kind,"mode":entry.mode,"sha":entry.sha,"size":entry.size})
}

fn resolve_fixture(entries: &[TreeEntry], reference: &str) -> FixtureTransport {
    let fixture = FixtureTransport::default();
    fixture.add(
        &["repos", "owner", "skills"],
        &[],
        json!({"private":false,"default_branch":reference}),
    );
    fixture.add(
        &["repos", "owner", "skills", "commits", reference],
        &[("per_page", "1")],
        json!({"sha":COMMIT,"commit":{"tree":{"sha":TREE}}}),
    );
    fixture.add(&["repos", "owner", "skills", "git", "trees", TREE], &[("recursive", "1")], json!({"sha":TREE,"truncated":false,"tree":entries.iter().map(entry_json).collect::<Vec<_>>()}));
    fixture
}

fn add_blob(fixture: &FixtureTransport, bytes: &[u8]) {
    let sha = blob_sha(bytes);
    fixture.add(
        &["repos", "owner", "skills", "git", "blobs", &sha],
        &[],
        json!({"sha":sha,"size":bytes.len(),"encoding":"base64","content":STANDARD.encode(bytes)}),
    );
}

#[test]
fn accepts_only_public_github_repository_coordinates() {
    for input in [
        "owner/repository",
        "Owner/Repository",
        "https://github.com/owner/repository",
        "https://github.com/owner/repository.git/",
    ] {
        let repo = parse_repository(input).unwrap();
        assert_eq!(repo.owner, "owner");
        assert_eq!(repo.name, "repository");
    }
    for input in [
        "http://github.com/owner/repository",
        "https://github.com.evil.test/owner/repository",
        "https://token@github.com/owner/repository",
        "https://github.com/owner/repository?token=secret",
        "https://github.com/owner/repository#main",
        "https://github.com/owner/repository/tree/feature/one",
        "https://github.com/owner/a/../repository",
        "https://github.com/owner/%72epository",
        "file:///owner/repository",
        "git@github.com:owner/repository",
        "owner/repo/extra",
        "owner/..",
        "owner/",
    ] {
        assert!(parse_repository(input).is_err(), "accepted {input}");
    }
}

#[test]
fn slash_refs_are_one_encoded_api_segment() {
    validate_reference("feature/中文-branch").unwrap();
    let url = api_url(
        &["repos", "owner", "skills", "commits", "feature/one"],
        &[("per_page", "1")],
    )
    .unwrap();
    assert_eq!(
        url.as_str(),
        "https://api.github.com/repos/owner/skills/commits/feature%2Fone?per_page=1"
    );
    for reference in [
        "../main",
        "feature//one",
        "a.lock",
        "a@{1}",
        "a?token=x",
        "a\n",
    ] {
        assert!(validate_reference(reference).is_err());
    }
}

#[test]
fn rejects_traversal_windows_devices_and_ambiguous_paths() {
    for path in [
        "../SKILL.md",
        "/SKILL.md",
        "C:/SKILL.md",
        "safe/../../evil",
        "a\\b",
        "a//b",
        "a/./b",
        "safe/COM1.txt",
        "safe/lpt².md",
        "safe/NUL",
        "AUX/file",
        "conout$/x",
        "file:stream",
        "folder./SKILL.md",
        "folder /SKILL.md",
        "a\0b",
        ".git/config",
        "a?b",
        "a*b",
    ] {
        assert!(validate_path(path).is_err(), "accepted {path:?}");
    }
    validate_path("技能/参考资料/说明.md").unwrap();
    validate_path("scripts/helper.sh").unwrap();
}

#[test]
fn rejects_incomplete_or_conflicting_trees() {
    let mut truncated = tree(vec![]);
    truncated.truncated = true;
    assert!(validate_tree(&truncated, TREE, &CANCEL).is_err());
    assert!(validate_tree(&tree(vec![]), COMMIT, &CANCEL).is_err());
    for entries in [
        vec![blob("SKILL.md", b"a"), blob("skill.md", b"b")],
        vec![blob("SKILL.md", b"a"), blob("SKILL.md", b"a")],
        vec![blob("a", b"a"), blob("a/SKILL.md", b"b")],
        vec![blob("missing/SKILL.md", b"a")],
        vec![dir("folder"), blob("FOLDER/SKILL.md", b"a")],
    ] {
        assert!(validate_tree(&tree(entries), TREE, &CANCEL).is_err());
    }
}

#[test]
fn rejects_symlinks_submodules_and_unknown_modes() {
    for (kind, mode) in [
        ("blob", "120000"),
        ("commit", "160000"),
        ("blob", "100664"),
        ("unknown", "100644"),
    ] {
        let mut entry = blob("unsafe", b"target");
        entry.kind = kind.into();
        entry.mode = mode.into();
        assert!(validate_tree(&tree(vec![entry]), TREE, &CANCEL).is_err());
    }
}

#[test]
fn resolves_multiple_candidates_using_immutable_tree_and_no_private_serialized_state() {
    let entries = vec![
        dir("skills"),
        dir("skills/a"),
        blob("skills/a/SKILL.md", b"a"),
        dir("skills/b"),
        blob("skills/b/SKILL.md", b"bb"),
        blob("skill.md", b"not a candidate"),
    ];
    let fixture = resolve_fixture(&entries, "feature/one");
    let catalog = resolve_with(&fixture, "owner/skills", "", &CANCEL).unwrap();
    assert_eq!(catalog.reference, "feature/one");
    assert_eq!(catalog.commit, COMMIT);
    assert_eq!(catalog.candidates.len(), 2);
    assert_eq!(catalog.candidates[0].path, "skills/a");
    assert_eq!(catalog.candidates[1].total_bytes, 2);
    let json = serde_json::to_value(&catalog).unwrap();
    assert!(json.get("tree").is_none());
    assert!(json.get("repo").is_none());
    fixture.assert_finished();
}

#[test]
fn refuses_private_repository_before_fetching_commit() {
    let fixture = FixtureTransport::default();
    fixture.add(
        &["repos", "owner", "skills"],
        &[],
        json!({"private":true,"default_branch":"main"}),
    );
    assert!(resolve_with(&fixture, "owner/skills", "main", &CANCEL).is_err());
    fixture.assert_finished();
}

#[test]
fn downloads_complete_skill_preserves_distinct_licenses_and_provenance() {
    let document = b"---\nname: a\ndescription: Example\n---\nSee [helper](scripts/helper.sh).\n";
    let helper = b"#!/bin/sh\necho ok\n";
    let entries = vec![
        blob("LICENSE", b"root MIT"),
        dir("skills"),
        blob("skills/NOTICE", b"parent notice"),
        dir("skills/a"),
        blob("skills/a/SKILL.md", document),
        blob("skills/a/LICENSE", b"skill MIT"),
        dir("skills/a/scripts"),
        blob("skills/a/scripts/helper.sh", helper),
        dir("skills/ab"),
        blob("skills/ab/SKILL.md", b"not selected"),
    ];
    let fixture = resolve_fixture(&entries, "main");
    let catalog = resolve_with(&fixture, "owner/skills", "main", &CANCEL).unwrap();
    for bytes in [
        b"root MIT".as_slice(),
        b"parent notice",
        b"skill MIT",
        document,
        helper,
    ] {
        add_blob(&fixture, bytes);
    }
    let downloaded = download_with(&fixture, &catalog, "skills/a", &CANCEL).unwrap();
    assert_eq!(
        fs::read(downloaded.skill_path.join("scripts/helper.sh")).unwrap(),
        helper
    );
    assert_eq!(
        fs::read(downloaded.skill_path.join("LICENSE")).unwrap(),
        b"skill MIT"
    );
    assert_eq!(
        fs::read(
            downloaded
                .skill_path
                .join(LICENSE_DIRECTORY)
                .join("LICENSE")
        )
        .unwrap(),
        b"root MIT"
    );
    assert_eq!(
        fs::read(
            downloaded
                .skill_path
                .join(LICENSE_DIRECTORY)
                .join("skills/NOTICE")
        )
        .unwrap(),
        b"parent notice"
    );
    assert!(!downloaded.skill_path.join("skills/ab").exists());
    assert_eq!(
        downloaded.source.url.as_deref(),
        Some("https://github.com/owner/skills")
    );
    assert_eq!(downloaded.source.commit.as_deref(), Some(COMMIT));
    assert_eq!(downloaded.source.subpath.as_deref(), Some("skills/a"));
    assert!(downloaded.source.local_path.is_none());
    let temp_path = downloaded.directory.path().to_owned();
    drop(downloaded);
    assert!(
        !temp_path.exists(),
        "staging must disappear when preview/import is abandoned"
    );
    fixture.assert_finished();
}

#[test]
fn download_progress_counts_staged_files_licenses_shared_blobs_and_empty_files() {
    let document = b"skill document";
    let license = b"root license";
    let entries = vec![
        blob("LICENSE", license),
        dir("skills"),
        dir("skills/a"),
        blob("skills/a/SKILL.md", document),
        blob("skills/a/copy.md", document),
        blob("skills/a/empty.txt", b""),
    ];
    let fixture = resolve_fixture(&entries, "main");
    let catalog = resolve_with(&fixture, "owner/skills", "main", &CANCEL).unwrap();
    // Shared blobs are fetched once but count once per file written to the stage.
    for content in [license.as_slice(), document.as_slice(), b""] {
        add_blob(&fixture, content);
    }
    let events = RefCell::new(Vec::new());
    let downloaded = download_using_transport(&fixture, &catalog, "skills/a", &CANCEL, &|event| {
        events.borrow_mut().push(event)
    })
    .unwrap();
    let events = events.into_inner();
    let total = (license.len() + document.len() * 2) as u64;
    assert_eq!(events[0].completed_files, 0);
    assert_eq!(events[0].completed_bytes, 0);
    assert!(events[0].current_file.is_empty());
    for event in &events {
        assert_eq!(event.total_files, 4);
        assert_eq!(event.total_bytes, total);
        assert!(event.completed_files <= 4);
        assert!(event.completed_bytes <= total);
    }
    for pair in events.windows(2) {
        assert!(pair[0].completed_files <= pair[1].completed_files);
        assert!(pair[0].completed_bytes <= pair[1].completed_bytes);
    }
    let finished = events.last().unwrap();
    assert_eq!(finished.completed_files, 4);
    assert_eq!(finished.completed_bytes, total);
    assert_eq!(finished.current_file, "empty.txt");
    assert_eq!(
        fs::read(downloaded.skill_path.join("copy.md")).unwrap(),
        document
    );
    assert!(downloaded.skill_path.join("empty.txt").is_file());
    assert!(
        events
            .iter()
            .any(|event| event.current_file == format!("{LICENSE_DIRECTORY}/LICENSE"))
    );
    let json = serde_json::to_value(finished).unwrap();
    assert_eq!(json["completedFiles"], 4);
    assert_eq!(json["totalBytes"], total);
    fixture.assert_finished();
}

#[test]
fn failed_blob_never_reports_completed_download_progress() {
    let fixture = resolve_fixture(
        &[blob("LICENSE", b"license"), blob("SKILL.md", b"good")],
        "main",
    );
    let catalog = resolve_with(&fixture, "owner/skills", "main", &CANCEL).unwrap();
    add_blob(&fixture, b"license");
    let sha = blob_sha(b"good");
    fixture.add(
        &["repos", "owner", "skills", "git", "blobs", &sha],
        &[],
        json!({"sha":sha,"size":4,"encoding":"base64","content":STANDARD.encode(b"evil")}),
    );
    let events = RefCell::new(Vec::new());
    let error = download_using_transport(&fixture, &catalog, "", &CANCEL, &|event| {
        events.borrow_mut().push(event);
    })
    .unwrap_err();
    assert_eq!(error.code, "github_blob_integrity");
    let events = events.into_inner();
    assert_eq!(events.last().unwrap().completed_files, 1);
    assert_eq!(events.last().unwrap().completed_bytes, 7);
    assert!(
        events
            .iter()
            .all(|event| event.completed_files < event.total_files)
    );
    fixture.assert_finished();
}

#[test]
fn progress_cancellation_stops_before_next_file_without_reporting_completion() {
    let fixture = resolve_fixture(
        &[blob("LICENSE", b"license"), blob("SKILL.md", b"skill")],
        "main",
    );
    let catalog = resolve_with(&fixture, "owner/skills", "main", &CANCEL).unwrap();
    add_blob(&fixture, b"license");
    let cancel = AtomicBool::new(false);
    let events = RefCell::new(Vec::new());
    let error = download_using_transport(&fixture, &catalog, "", &cancel, &|event| {
        if event.completed_files == 1 {
            cancel.store(true, Ordering::Relaxed);
        }
        events.borrow_mut().push(event);
    })
    .unwrap_err();
    assert_eq!(error.code, "cancelled");
    let events = events.into_inner();
    assert_eq!(events.last().unwrap().completed_files, 1);
    assert!(
        events
            .iter()
            .all(|event| event.completed_files < event.total_files)
    );
    fixture.assert_finished();
    let events = RefCell::new(Vec::new());
    assert!(
        download_using_transport(&fixture, &catalog, "", &cancel, &|event| {
            events.borrow_mut().push(event);
        })
        .is_err()
    );
    assert!(events.borrow().is_empty());
}

#[test]
fn root_candidate_does_not_duplicate_repository_license() {
    let entries = vec![blob("SKILL.md", b"skill"), blob("LICENSE", b"license")];
    let fixture = resolve_fixture(&entries, "main");
    let catalog = resolve_with(&fixture, "owner/skills", "main", &CANCEL).unwrap();
    let plan = plan_download(&catalog, "").unwrap();
    assert_eq!(plan.len(), 2);
    assert!(
        plan.iter()
            .all(|file| !file.destination.starts_with(LICENSE_DIRECTORY))
    );
}

#[test]
fn does_not_download_unselected_or_overlarge_candidates() {
    let mut oversized = blob("SKILL.md", b"skill");
    oversized.size = Some(MAX_FILE_BYTES + 1);
    let fixture = resolve_fixture(&[oversized], "main");
    let catalog = resolve_with(&fixture, "owner/skills", "main", &CANCEL).unwrap();
    assert!(download_with(&fixture, &catalog, "../../elsewhere", &CANCEL).is_err());
    assert!(download_with(&fixture, &catalog, "", &CANCEL).is_err());
    fixture.assert_finished();
}

#[test]
fn source_license_directory_cannot_replace_user_files() {
    let entries = vec![
        blob("SKILL.md", b"skill"),
        dir(LICENSE_DIRECTORY),
        blob(&format!("{LICENSE_DIRECTORY}/LICENSE"), b"user"),
    ];
    let fixture = resolve_fixture(&entries, "main");
    let catalog = resolve_with(&fixture, "owner/skills", "main", &CANCEL).unwrap();
    assert!(download_with(&fixture, &catalog, "", &CANCEL).is_err());
    fixture.assert_finished();
}

#[test]
fn verifies_git_blob_identity_not_only_size_or_claimed_sha() {
    let expected = blob("SKILL.md", b"good");
    let mut response = BlobResponse {
        sha: expected.sha.clone(),
        encoding: "base64".into(),
        size: 4,
        content: STANDARD.encode(b"evil"),
    };
    assert!(decode_blob(&response, &expected).is_err());
    response.content = format!("{}\n", STANDARD.encode(b"good"));
    assert_eq!(decode_blob(&response, &expected).unwrap(), b"good");
    response.size += 1;
    assert!(decode_blob(&response, &expected).is_err());
}

#[test]
fn bounded_reads_and_cancellation_fail_before_any_download() {
    assert!(read_limited(&mut Cursor::new(b"12345"), 4, &CANCEL).is_err());
    assert_eq!(
        read_limited(&mut Cursor::new(b"1234"), 4, &CANCEL).unwrap(),
        b"1234"
    );
    let cancel = AtomicBool::new(true);
    assert!(read_limited(&mut Cursor::new(b"1234"), 4, &cancel).is_err());
    assert!(
        resolve_with(
            &FixtureTransport::default(),
            "owner/skills",
            "main",
            &cancel
        )
        .is_err()
    );
}

#[test]
fn surfaces_rate_limits_redirects_and_missing_public_resources() {
    let rate = http_error(StatusCode::FORBIDDEN, Some("0"), None);
    assert_eq!(rate.code, "github_rate_limit");
    assert_eq!(
        http_error(StatusCode::TOO_MANY_REQUESTS, None, Some("60")).code,
        "github_rate_limit"
    );
    assert_eq!(
        http_error(StatusCode::MOVED_PERMANENTLY, None, None).code,
        "github_redirect"
    );
    assert_eq!(
        http_error(StatusCode::NOT_FOUND, None, None).code,
        "github_not_found"
    );
}

#[test]
fn selected_skill_total_size_and_file_count_are_bounded() {
    let mut entries = vec![blob("SKILL.md", b"skill")];
    for index in 0..17 {
        let mut entry = blob(&format!("asset-{index}"), b"asset");
        entry.size = Some(MAX_FILE_BYTES);
        entries.push(entry);
    }
    let fixture = resolve_fixture(&entries, "main");
    let catalog = resolve_with(&fixture, "owner/skills", "main", &CANCEL).unwrap();
    assert!(plan_download(&catalog, "").is_err());
    let entries: Vec<_> = std::iter::once(blob("SKILL.md", b"skill"))
        .chain((0..MAX_SKILL_FILES).map(|index| blob(&format!("asset-{index}"), b"asset")))
        .collect();
    let fixture = resolve_fixture(&entries, "main");
    let catalog = resolve_with(&fixture, "owner/skills", "main", &CANCEL).unwrap();
    assert!(plan_download(&catalog, "").is_err());
}

/// Explicit opt-in smoke check; regular CI and `cargo test` remain offline.
#[test]
#[ignore = "requires GitHub public API network access and request quota"]
fn public_github_smoke() {
    let catalog = resolve("https://github.com/Candquarzy/Askills", "main", &CANCEL).unwrap();
    assert_eq!(catalog.commit.len(), 40);
    let downloaded = download(&catalog, ".agents/skills/tauri-setup", &CANCEL).unwrap();
    let document = fs::read_to_string(downloaded.skill_path.join("SKILL.md")).unwrap();
    assert!(document.contains("name: tauri-setup"));
    assert_eq!(
        downloaded.source.commit.as_deref(),
        Some(catalog.commit.as_str())
    );
    assert!(
        downloaded
            .skill_path
            .join(LICENSE_DIRECTORY)
            .join("LICENSE")
            .is_file()
    );
}
