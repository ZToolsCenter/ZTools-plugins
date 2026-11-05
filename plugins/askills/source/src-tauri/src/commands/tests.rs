use super::*;
use std::fs;
use std::path::Path;
use std::sync::mpsc;

fn write_skill(path: &Path, body: &str) {
    fs::create_dir_all(path).unwrap();
    fs::write(
        path.join("SKILL.md"),
        format!("---\nname: sample\ndescription: IPC 边界测试\n---\n{body}\n"),
    )
    .unwrap();
}

#[test]
fn directory_grants_are_purpose_bound_and_expire_at_the_next_command() {
    let temporary = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(temporary.path().join("app"));
    let project = temporary.path().join("项目");
    fs::create_dir(&project).unwrap();

    let selection = tauri::async_runtime::block_on(work(runtime.clone(), move |workspace, _| {
        workspace.add_selection(project, "project")
    }))
    .unwrap();
    let id = selection.id;
    let wrong_purpose_id = id.clone();
    let mismatch = tauri::async_runtime::block_on(work(runtime.clone(), move |workspace, _| {
        workspace.selection(&wrong_purpose_id, "import")
    }))
    .unwrap_err();
    assert_eq!(mismatch.code, "InvalidSelection");

    let expired_id = id.clone();
    tauri::async_runtime::block_on(work(runtime.clone(), move |workspace, _| {
        workspace.selections.get_mut(&expired_id).unwrap().created =
            Instant::now() - TOKEN_TTL - Duration::from_secs(1);
        Ok(())
    }))
    .unwrap();
    // The work boundary expires grants even when the next command would otherwise
    // accept its purpose. No user-supplied path can replace the expired grant.
    let expired = tauri::async_runtime::block_on(work(runtime.clone(), move |workspace, _| {
        workspace.selection(&id, "project")
    }))
    .unwrap_err();
    assert_eq!(expired.code, "SelectionExpired");
    let registered = tauri::async_runtime::block_on(work(runtime, |workspace, _| {
        workspace.store.list_projects()
    }))
    .unwrap();
    assert!(registered.is_empty());
}

#[test]
fn import_preview_cannot_authorize_changed_source_content() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("sample");
    write_skill(&source, "reviewed version");
    let mut workspace = Workspace::open(temporary.path().join("app")).unwrap();
    let cancel = AtomicBool::new(false);
    let prepared = workspace
        .prepare(source.clone(), None, None, &cancel)
        .unwrap();
    write_skill(&source, "changed after the user reviewed it");

    let pending = workspace.imports.get(&prepared.id).unwrap();
    let error = workspace
        .store
        .import_local(
            &pending.path,
            pending.source.clone(),
            Some(&pending.preview.hash),
            &cancel,
        )
        .unwrap_err();
    assert_eq!(error.code, "PreviewExpired");
    assert!(workspace.store.list_skills().unwrap().is_empty());
    assert!(workspace.imports.contains_key(&prepared.id));
    assert!(
        fs::read_to_string(source.join("SKILL.md"))
            .unwrap()
            .contains("changed after")
    );
}

#[test]
fn discarded_and_expired_download_previews_release_their_temp_directories() {
    let temporary = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(temporary.path().join("app"));
    let download = tempfile::tempdir_in(temporary.path()).unwrap();
    let discarded_path = download.path().to_path_buf();
    write_skill(&discarded_path, "downloaded skill");
    let source_path = discarded_path.clone();
    let prepared =
        tauri::async_runtime::block_on(work(runtime.clone(), move |workspace, cancel| {
            workspace.prepare(source_path, None, Some(download), cancel)
        }))
        .unwrap();
    assert!(discarded_path.join("SKILL.md").exists());
    tauri::async_runtime::block_on(work(runtime.clone(), move |workspace, _| {
        workspace.imports.remove(&prepared.id);
        Ok(())
    }))
    .unwrap();
    assert!(!discarded_path.exists());

    let download = tempfile::tempdir_in(temporary.path()).unwrap();
    let expired_path = download.path().to_path_buf();
    write_skill(&expired_path, "another download");
    let source_path = expired_path.clone();
    tauri::async_runtime::block_on(work(runtime.clone(), move |workspace, cancel| {
        let prepared = workspace.prepare(source_path, None, Some(download), cancel)?;
        workspace.imports.get_mut(&prepared.id).unwrap().created =
            Instant::now() - TOKEN_TTL - Duration::from_secs(1);
        Ok(())
    }))
    .unwrap();
    assert!(expired_path.exists());
    // An unrelated command triggers expiry; abandoned downloads do not require a
    // dedicated discard action, a network request, or a restart to free disk space.
    tauri::async_runtime::block_on(work(runtime, |workspace, _| {
        assert!(workspace.imports.is_empty());
        workspace.store.list_skills()
    }))
    .unwrap();
    assert!(!expired_path.exists());
}

#[test]
fn running_work_rejects_concurrency_observes_cancel_and_releases_after_errors() {
    let temporary = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(temporary.path().join("app"));
    let first_runtime = runtime.clone();
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let first = std::thread::spawn(move || {
        tauri::async_runtime::block_on(work(first_runtime, move |_, cancel| {
            started_tx.send(()).unwrap();
            release_rx
                .recv_timeout(Duration::from_secs(10))
                .map_err(|_| AppError::new("TestTimeout", "测试同步超时"))?;
            crate::platform::fs::check_cancel(cancel)
        }))
    });
    started_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let conflict =
        tauri::async_runtime::block_on(work(runtime.clone(), |_, _| Ok(()))).unwrap_err();
    assert_eq!(conflict.code, "Busy");

    // Cancellation uses its independent atomic flag and is reachable while the
    // worker owns the Workspace mutex. Synchronization makes this deterministic.
    runtime.cancel.store(true, Ordering::Release);
    release_tx.send(()).unwrap();
    let cancelled = first.join().unwrap().unwrap_err();
    assert_eq!(cancelled.code, "Cancelled");
    assert!(!runtime.busy.load(Ordering::Acquire));

    let failure = tauri::async_runtime::block_on(work(runtime.clone(), |_, cancel| {
        assert!(!cancel.load(Ordering::Acquire));
        Err::<(), _>(AppError::new("ExpectedFailure", "业务失败"))
    }))
    .unwrap_err();
    assert_eq!(failure.code, "ExpectedFailure");
    assert!(!runtime.busy.load(Ordering::Acquire));
    assert_eq!(
        tauri::async_runtime::block_on(work(runtime, |_, _| Ok(42))).unwrap(),
        42
    );
}

#[test]
fn library_migration_requires_a_library_grant_and_consumes_it_only_after_success() {
    let temporary = tempfile::tempdir().unwrap();
    let mut workspace = Workspace::open(temporary.path().join("app")).unwrap();
    let source = temporary.path().join("sample");
    write_skill(&source, "existing library content");
    let cancel = AtomicBool::new(false);
    workspace
        .store
        .import_local(&source, None, None, &cancel)
        .unwrap();
    let pending = workspace.prepare(source, None, None, &cancel).unwrap();
    let target = temporary.path().join("new library");
    fs::create_dir(&target).unwrap();
    let wrong = workspace.add_selection(target.clone(), "project").unwrap();
    assert_eq!(
        workspace
            .migrate_selection(&wrong.id, &cancel)
            .unwrap_err()
            .code,
        "InvalidSelection"
    );
    assert_eq!(
        workspace
            .migrate_selection("D:/ungranted", &cancel)
            .unwrap_err()
            .code,
        "SelectionExpired"
    );
    let grant = workspace.add_selection(target.clone(), "library").unwrap();
    fs::write(target.join("keep.txt"), "do not overwrite").unwrap();
    assert_eq!(
        workspace
            .migrate_selection(&grant.id, &cancel)
            .unwrap_err()
            .code,
        "DirectoryNotEmpty"
    );
    assert!(workspace.selections.contains_key(&grant.id));
    assert!(workspace.imports.contains_key(&pending.id));
    assert_eq!(
        fs::read_to_string(target.join("keep.txt")).unwrap(),
        "do not overwrite"
    );
    fs::remove_file(target.join("keep.txt")).unwrap();
    let result = workspace.migrate_selection(&grant.id, &cancel).unwrap();
    // Windows runners can use an 8.3 alias in TEMP while the migration returns
    // the expanded path. Compare directory identity after canonicalization.
    assert_eq!(
        fs::canonicalize(result.library_root).unwrap(),
        fs::canonicalize(target).unwrap()
    );
    assert!(!workspace.selections.contains_key(&grant.id));
    assert!(workspace.imports.is_empty());
    assert_eq!(
        workspace
            .migrate_selection(&grant.id, &cancel)
            .unwrap_err()
            .code,
        "SelectionExpired"
    );
    assert_eq!(workspace.store.list_skills().unwrap().len(), 1);
}
