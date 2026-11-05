use super::*;
use std::cell::RefCell;

static CANCEL: AtomicBool = AtomicBool::new(false);

fn fixture() -> (TempDir, Checkout) {
    let work = tempfile::tempdir().unwrap();
    let template = work.path().join("template");
    fs::create_dir(&template).unwrap();
    let mut init = git_command(Some(work.path()));
    init.args([
        "init",
        "--initial-branch=main",
        &format!("--template={}", template.display()),
    ]);
    run(init, 65536, &CANCEL, COMMAND_TIMEOUT, None).unwrap();
    fs::create_dir_all(work.path().join("skills/example/references")).unwrap();
    fs::write(
        work.path().join("skills/example/SKILL.md"),
        "---\nname: example\ndescription: Git fixture\n---\n[guide](references/guide.md)\n",
    )
    .unwrap();
    fs::write(
        work.path().join("skills/example/references/guide.md"),
        "raw\r\nbytes\n",
    )
    .unwrap();
    fs::write(
        work.path().join("skills/example/references/copy.md"),
        "raw\r\nbytes\n",
    )
    .unwrap();
    fs::write(work.path().join("LICENSE"), "Fixture license notice").unwrap();
    commit(work.path());
    let checkout = Checkout::new(&CANCEL).unwrap();
    checkout
        .run(
            &[
                "-c",
                "protocol.file.allow=always",
                "fetch",
                "--depth=1",
                "--",
                work.path().to_str().unwrap(),
                "main",
            ],
            65536,
            &CANCEL,
        )
        .unwrap();
    (work, checkout)
}

fn commit(work: &Path) {
    let mut add = git_command(Some(work));
    add.args(["-c", "core.autocrlf=false", "add", "--all"]);
    run(add, 65536, &CANCEL, COMMAND_TIMEOUT, None).unwrap();
    let mut commit = git_command(Some(work));
    commit.args([
        "-c",
        "user.name=Askills fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        &format!("core.hooksPath={}", work.join("template").display()),
        "commit",
        "-m",
        "fixture",
    ]);
    run(commit, 65536, &CANCEL, COMMAND_TIMEOUT, None).unwrap();
}

#[test]
fn local_git_preserves_raw_files_license_and_pinned_commit_without_worktree_checkout() {
    let (work, checkout) = fixture();
    let resolved = from_checkout(
        checkout,
        parse_repository("owner/repo").unwrap(),
        "main".into(),
        &CANCEL,
    )
    .unwrap();
    assert_eq!(resolved.catalog.candidates[0].path, "skills/example");
    assert!(!resolved.checkout.repository().join("skills").exists());
    let pinned = resolved.catalog.commit.clone();
    // The remote moves after preview; reading the saved catalog still uses old blobs.
    fs::write(
        work.path().join("skills/example/references/guide.md"),
        "new",
    )
    .unwrap();
    commit(work.path());
    let events = RefCell::new(Vec::new());
    let download = download_with_progress(&resolved, "skills/example", &CANCEL, &|event| {
        events.borrow_mut().push(event);
    })
    .unwrap();
    assert_eq!(
        fs::read(download.skill_path.join("references/guide.md")).unwrap(),
        b"raw\r\nbytes\n"
    );
    assert_eq!(
        fs::read_to_string(download.skill_path.join(LICENSE_DIRECTORY).join("LICENSE")).unwrap(),
        "Fixture license notice"
    );
    assert_eq!(download.source.commit, Some(pinned));
    crate::services::library::inspect_skill(&download.skill_path, &CANCEL).unwrap();
    let events = events.into_inner();
    assert_eq!(events[0].completed_files, 0);
    assert_eq!(events[0].completed_bytes, 0);
    let finished = events.last().unwrap();
    assert_eq!(finished.completed_files, 4);
    assert_eq!(finished.total_files, 4);
    let expected_bytes: u64 = [
        "SKILL.md",
        "references/guide.md",
        "references/copy.md",
        ".askills-source-licenses/LICENSE",
    ]
    .iter()
    .map(|file| fs::metadata(download.skill_path.join(file)).unwrap().len())
    .sum();
    assert_eq!(finished.completed_bytes, expected_bytes);
    assert_eq!(finished.total_bytes, expected_bytes);
    assert!(
        events
            .windows(2)
            .all(|pair| pair[0].completed_files <= pair[1].completed_files
                && pair[0].completed_bytes <= pair[1].completed_bytes)
    );
}

#[test]
fn git_rejects_options_local_paths_links_and_truncated_tree() {
    assert!(
        resolve(
            "https://github.com/owner/repo",
            "--upload-pack=evil",
            &CANCEL
        )
        .is_err()
    );
    for url in [
        "file:///tmp/repo",
        "ext::command",
        "https://user:secret@github.com/owner/repo",
        "git@evil.test:owner/repo",
    ] {
        assert!(resolve(url, "main", &CANCEL).is_err());
    }
    assert!(parse_tree(b"100644 blob deadbeef 1\tfile", "a".repeat(40)).is_err());
    let bytes = format!("120000 blob {} 4\tSKILL.md\0", "b".repeat(40));
    let tree = parse_tree(bytes.as_bytes(), "a".repeat(40)).unwrap();
    assert_eq!(
        catalog_from_tree(
            parse_repository("owner/repo").unwrap(),
            "main".into(),
            "c".repeat(40),
            tree,
            &CANCEL
        )
        .unwrap_err()
        .code,
        "github_unsafe_entry"
    );
}

#[test]
fn git_preview_rejects_changed_blob_data_and_releases_private_checkout() {
    let (_work, checkout) = fixture();
    let root = checkout.root.path().to_path_buf();
    let mut resolved = from_checkout(
        checkout,
        parse_repository("owner/repo").unwrap(),
        "main".into(),
        &CANCEL,
    )
    .unwrap();
    let file = resolved
        .catalog
        .tree
        .iter_mut()
        .find(|e| e.path.ends_with("guide.md"))
        .unwrap();
    file.sha = "0".repeat(40);
    let events = RefCell::new(Vec::new());
    assert!(
        download_with_progress(&resolved, "skills/example", &CANCEL, &|event| {
            events.borrow_mut().push(event);
        })
        .is_err()
    );
    assert!(
        events
            .borrow()
            .iter()
            .all(|event| event.completed_files < event.total_files)
    );
    drop(resolved);
    assert!(!root.exists());
}

#[test]
fn local_git_download_progress_cancels_before_the_next_file() {
    let (_work, checkout) = fixture();
    let resolved = from_checkout(
        checkout,
        parse_repository("owner/repo").unwrap(),
        "main".into(),
        &CANCEL,
    )
    .unwrap();
    let cancel = AtomicBool::new(false);
    let events = RefCell::new(Vec::new());
    let error = download_with_progress(&resolved, "skills/example", &cancel, &|event| {
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
}

#[test]
fn git_command_bounds_output_and_handles_cancel_timeout_and_missing_install() {
    let mut command = git_command(None);
    command.arg("--version");
    assert_eq!(
        run(command, 1, &CANCEL, COMMAND_TIMEOUT, None)
            .unwrap_err()
            .code,
        "GitLimit"
    );
    assert_eq!(
        version(&AtomicBool::new(true)).unwrap_err().code,
        "cancelled"
    );
    assert_eq!(
        run(
            Command::new("askills-nonexistent-git-executable"),
            1024,
            &CANCEL,
            COMMAND_TIMEOUT,
            None
        )
        .unwrap_err()
        .code,
        "GitNotInstalled"
    );
    #[cfg(windows)]
    let mut command = Command::new("powershell.exe");
    #[cfg(windows)]
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Sleep -Seconds 30",
    ]);
    #[cfg(unix)]
    let mut command = Command::new("sleep");
    #[cfg(unix)]
    command.arg("30");
    let before = Instant::now();
    assert_eq!(
        run(command, 1024, &CANCEL, Duration::from_millis(100), None)
            .unwrap_err()
            .code,
        "GitTimeout"
    );
    assert!(before.elapsed() < Duration::from_secs(10));
}

#[test]
#[ignore = "requires public GitHub network access and installed Git"]
fn native_git_public_smoke() {
    let resolved = resolve("Candquarzy/Askills", "main", &CANCEL).unwrap();
    let imported = download(&resolved, ".agents/skills/tauri-setup", &CANCEL).unwrap();
    crate::services::library::inspect_skill(&imported.skill_path, &CANCEL).unwrap();
    assert_eq!(imported.source.commit, Some(resolved.catalog.commit));
}

#[test]
fn running_command_can_be_cancelled_and_repository_storage_is_bounded() {
    let cancelled = AtomicBool::new(false);
    #[cfg(windows)]
    let mut command = Command::new("powershell.exe");
    #[cfg(windows)]
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Sleep -Seconds 30",
    ]);
    #[cfg(unix)]
    let mut command = Command::new("sleep");
    #[cfg(unix)]
    command.arg("30");
    let before = Instant::now();
    thread::scope(|scope| {
        scope.spawn(|| {
            thread::sleep(Duration::from_millis(200));
            cancelled.store(true, Ordering::Release);
        });
        assert_eq!(
            run(command, 1024, &cancelled, COMMAND_TIMEOUT, None)
                .unwrap_err()
                .code,
            "cancelled"
        );
    });
    assert!(before.elapsed() < Duration::from_secs(10));
    let root = tempfile::tempdir().unwrap();
    let file = fs::File::create(root.path().join("large-pack")).unwrap();
    file.set_len(MAX_REPOSITORY_BYTES + 1).unwrap();
    assert_eq!(within_budget(root.path()).unwrap_err().code, "GitLimit");
}
