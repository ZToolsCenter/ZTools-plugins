use super::*;
use crate::domain::Project;

struct Fixture {
    store: Store,
    _root: tempfile::TempDir,
    input: PathBuf,
    project: Project,
    revision: String,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(&root.path().join("data")).unwrap();
        let input = root.path().join("来源 技能");
        fs::create_dir(&input).unwrap();
        fs::create_dir(input.join("references")).unwrap();
        fs::create_dir(input.join("empty-directory")).unwrap();
        fs::write(input.join("references/guide.md"), "first").unwrap();
        fs::write(
            input.join("SKILL.md"),
            "---\nname: sample\ndescription: test\n---\n[guide](references/guide.md)\n",
        )
        .unwrap();
        let skill = store
            .import_local(&input, None, None, &AtomicBool::new(false))
            .unwrap();
        let project_path = root.path().join("项目 with spaces");
        fs::create_dir(&project_path).unwrap();
        let project = store.add_project(&project_path).unwrap();
        Self {
            store,
            _root: root,
            input,
            project,
            revision: skill.latest_revision_id,
        }
    }

    fn install(&mut self, mode: &str) -> Deployment {
        let preview = plan(&self.store, &self.project.id, &self.revision, "codex", mode).unwrap();
        assert!(preview.conflict.is_none());
        apply(&mut self.store, &preview.id, &AtomicBool::new(false)).unwrap()
    }

    fn next_revision(&mut self) -> String {
        fs::write(self.input.join("references/guide.md"), "second").unwrap();
        self.store
            .import_local(&self.input, None, None, &AtomicBool::new(false))
            .unwrap()
            .latest_revision_id
    }
}

#[test]
fn removing_library_and_project_entries_preserves_live_deployments() {
    let mut fixture = Fixture::new();
    let installed = fixture.install("auto");
    let skill = fixture.store.revision(&fixture.revision).unwrap().skill_id;
    fixture
        .store
        .remove_library_skills(&[skill], &AtomicBool::new(false))
        .unwrap();
    fixture
        .store
        .remove_projects(
            std::slice::from_ref(&fixture.project.id),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert!(fixture.store.list_skills().unwrap().is_empty());
    assert!(fixture.store.list_projects().unwrap().is_empty());
    assert_eq!(list(&fixture.store).unwrap()[0].status, "installed");
    assert!(Path::new(&installed.target_path).join("SKILL.md").is_file());
    let restored = fixture
        .store
        .add_project(Path::new(&fixture.project.path))
        .unwrap();
    assert_eq!(restored.id, fixture.project.id);
    uninstall(&mut fixture.store, &installed.id, &AtomicBool::new(false)).unwrap();
    assert!(fixture.input.join("SKILL.md").is_file());
}

#[test]
fn copy_install_upgrade_rollback_and_uninstall_preserve_originals() {
    let mut fixture = Fixture::new();
    let first = fixture.install("copy");
    assert_eq!(first.mode, "copy");
    assert!(
        Path::new(&first.target_path)
            .join("empty-directory")
            .is_dir()
    );
    let second_revision = fixture.next_revision();
    let preview = plan(
        &fixture.store,
        &fixture.project.id,
        &second_revision,
        "codex",
        "copy",
    )
    .unwrap();
    assert_eq!(
        preview.previous_revision_id.as_deref(),
        Some(fixture.revision.as_str())
    );
    let second = apply(&mut fixture.store, &preview.id, &AtomicBool::new(false)).unwrap();
    assert_eq!(second.id, first.id);
    assert_eq!(
        fs::read_to_string(Path::new(&first.target_path).join("references/guide.md")).unwrap(),
        "second"
    );
    let restored = rollback(&mut fixture.store, &first.id, &AtomicBool::new(false)).unwrap();
    assert_eq!(restored.revision_id, fixture.revision);
    assert_eq!(
        fs::read_to_string(Path::new(&first.target_path).join("references/guide.md")).unwrap(),
        "first"
    );
    uninstall(&mut fixture.store, &first.id, &AtomicBool::new(false)).unwrap();
    assert!(!Path::new(&first.target_path).exists());
    assert!(fixture.input.join("SKILL.md").is_file());
    assert!(
        Path::new(&fixture.store.revision(&fixture.revision).unwrap().path)
            .join("SKILL.md")
            .is_file()
    );
    assert!(list(&fixture.store).unwrap().is_empty());
}

#[test]
fn auto_install_unlinks_entry_without_removing_library() {
    let mut fixture = Fixture::new();
    let installed = fixture.install("auto");
    assert!(["symlink", "junction", "copy"].contains(&installed.mode.as_str()));
    let source = fixture.store.revision(&fixture.revision).unwrap();
    uninstall(&mut fixture.store, &installed.id, &AtomicBool::new(false)).unwrap();
    assert!(Path::new(&source.path).join("SKILL.md").is_file());
    assert!(!Path::new(&installed.target_path).exists());
}

#[cfg(windows)]
#[test]
fn explicit_junction_keeps_fixed_revision_and_safe_uninstall() {
    let mut fixture = Fixture::new();
    let installed = fixture.install("junction");
    assert_eq!(installed.mode, "junction");
    fixture.next_revision();
    assert_eq!(
        fs::read_to_string(Path::new(&installed.target_path).join("references/guide.md")).unwrap(),
        "first"
    );
    uninstall(&mut fixture.store, &installed.id, &AtomicBool::new(false)).unwrap();
    assert!(Path::new(&fixture.store.revision(&fixture.revision).unwrap().path).is_dir());
}

#[cfg(unix)]
#[test]
fn explicit_symlink_keeps_fixed_revision_and_safe_uninstall() {
    let mut fixture = Fixture::new();
    let installed = fixture.install("symlink");
    assert_eq!(installed.mode, "symlink");
    fixture.next_revision();
    assert_eq!(
        fs::read_to_string(Path::new(&installed.target_path).join("references/guide.md")).unwrap(),
        "first"
    );
    uninstall(&mut fixture.store, &installed.id, &AtomicBool::new(false)).unwrap();
    assert!(Path::new(&fixture.store.revision(&fixture.revision).unwrap().path).is_dir());
}

#[test]
fn unknown_target_is_reported_and_never_overwritten() {
    let mut fixture = Fixture::new();
    let target = Path::new(&fixture.project.path).join(".agents/skills/sample");
    fs::create_dir_all(&target).unwrap();
    fs::write(target.join("user.txt"), "mine").unwrap();
    let preview = plan(
        &fixture.store,
        &fixture.project.id,
        &fixture.revision,
        "codex",
        "copy",
    )
    .unwrap();
    assert!(preview.conflict.is_some());
    assert_eq!(
        apply(&mut fixture.store, &preview.id, &AtomicBool::new(false))
            .unwrap_err()
            .code,
        "PathConflict"
    );
    assert_eq!(fs::read_to_string(target.join("user.txt")).unwrap(), "mine");
}

#[test]
fn copied_edits_block_upgrade_and_uninstall() {
    let mut fixture = Fixture::new();
    let installed = fixture.install("copy");
    let path = Path::new(&installed.target_path).join("references/guide.md");
    fs::write(&path, "user edit").unwrap();
    let newer = fixture.next_revision();
    let preview = plan(&fixture.store, &fixture.project.id, &newer, "codex", "copy").unwrap();
    assert!(preview.conflict.is_some());
    assert_eq!(
        uninstall(&mut fixture.store, &installed.id, &AtomicBool::new(false))
            .unwrap_err()
            .code,
        "LocalChangesDetected"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), "user edit");
    assert_eq!(
        list(&fixture.store).unwrap()[0].status,
        "LocalChangesDetected"
    );
}

#[test]
fn replacing_entry_with_equal_content_invalidates_plan() {
    let mut fixture = Fixture::new();
    let installed = fixture.install("copy");
    let newer = fixture.next_revision();
    let preview = plan(&fixture.store, &fixture.project.id, &newer, "codex", "copy").unwrap();
    let destination = Path::new(&installed.target_path);
    let retained = destination.with_file_name("saved-original");
    fs::rename(destination, &retained).unwrap();
    safe_fs::copy_tree(&retained, destination, &AtomicBool::new(false)).unwrap();
    assert_eq!(
        apply(&mut fixture.store, &preview.id, &AtomicBool::new(false))
            .unwrap_err()
            .code,
        "EntryReplaced"
    );
    assert!(retained.join("SKILL.md").is_file());
    assert_eq!(
        fs::read_to_string(destination.join("references/guide.md")).unwrap(),
        "first"
    );
}

#[test]
fn stale_plan_and_reused_tokens_do_not_write_again() {
    let mut fixture = Fixture::new();
    let first = plan(
        &fixture.store,
        &fixture.project.id,
        &fixture.revision,
        "codex",
        "copy",
    )
    .unwrap();
    let stale = plan(
        &fixture.store,
        &fixture.project.id,
        &fixture.revision,
        "codex",
        "copy",
    )
    .unwrap();
    apply(&mut fixture.store, &first.id, &AtomicBool::new(false)).unwrap();
    assert_eq!(
        apply(&mut fixture.store, &first.id, &AtomicBool::new(false))
            .unwrap_err()
            .code,
        "PlanExpired"
    );
    assert_eq!(
        apply(&mut fixture.store, &stale.id, &AtomicBool::new(false))
            .unwrap_err()
            .code,
        "PlanExpired"
    );
    assert_eq!(list(&fixture.store).unwrap().len(), 1);
}

#[test]
fn unknown_lock_and_modified_lock_are_preserved() {
    let mut fixture = Fixture::new();
    let lock = Path::new(&fixture.project.path).join("askills.lock.json");
    fs::write(&lock, "{\"foreign\":true}").unwrap();
    assert_eq!(
        plan(
            &fixture.store,
            &fixture.project.id,
            &fixture.revision,
            "codex",
            "copy"
        )
        .unwrap_err()
        .code,
        "LockConflict"
    );
    assert_eq!(fs::read_to_string(&lock).unwrap(), "{\"foreign\":true}");
    fs::remove_file(&lock).unwrap();
    let preview = plan(
        &fixture.store,
        &fixture.project.id,
        &fixture.revision,
        "codex",
        "copy",
    )
    .unwrap();
    fs::write(&lock, "changed after preview").unwrap();
    assert_eq!(
        apply(&mut fixture.store, &preview.id, &AtomicBool::new(false))
            .unwrap_err()
            .code,
        "PlanExpired"
    );
    assert_eq!(fs::read_to_string(&lock).unwrap(), "changed after preview");
}

#[test]
fn lock_file_contains_no_machine_paths() {
    let mut fixture = Fixture::new();
    fixture.install("copy");
    let text =
        fs::read_to_string(Path::new(&fixture.project.path).join("askills.lock.json")).unwrap();
    let document: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(document["skills"][0]["target"], ".agents/skills/sample");
    assert!(document["skills"][0].get("localPath").is_none());
    assert!(
        !text.contains(
            &fixture
                .store
                .data_dir
                .to_string_lossy()
                .replace('\\', "\\\\")
        )
    );
    assert!(!text.contains(&fixture.input.to_string_lossy().replace('\\', "\\\\")));
}

#[test]
fn cancelled_plan_does_not_create_installation() {
    let mut fixture = Fixture::new();
    let preview = plan(
        &fixture.store,
        &fixture.project.id,
        &fixture.revision,
        "codex",
        "copy",
    )
    .unwrap();
    assert_eq!(
        apply(&mut fixture.store, &preview.id, &AtomicBool::new(true))
            .unwrap_err()
            .code,
        "Cancelled"
    );
    assert!(!Path::new(&preview.target_path).exists());
    assert!(list(&fixture.store).unwrap().is_empty());
}

#[test]
fn cancelled_listing_returns_cancellation_instead_of_a_drift_status() {
    let mut fixture = Fixture::new();
    let installed = fixture.install("copy");
    fs::write(
        Path::new(&installed.target_path).join("references/guide.md"),
        "external edit",
    )
    .unwrap();
    let cancel = AtomicBool::new(true);
    assert_eq!(
        list_cancellable(&fixture.store, &cancel).unwrap_err().code,
        "Cancelled"
    );
    let saved = get_saved(&fixture.store, &installed.id).unwrap();
    assert_eq!(saved.view.status, "installed");
    assert_eq!(
        filesystem::verify_entry_cancellable(Path::new(&installed.target_path), &saved, &cancel)
            .unwrap_err()
            .code,
        "Cancelled"
    );
    assert_eq!(
        list(&fixture.store).unwrap()[0].status,
        "LocalChangesDetected"
    );
}

#[test]
fn cancelled_preview_does_not_save_a_plan_or_report_a_conflict() {
    let mut fixture = Fixture::new();
    let installed = fixture.install("copy");
    let next = fixture.next_revision();
    fs::write(
        Path::new(&installed.target_path).join("references/guide.md"),
        "external edit",
    )
    .unwrap();
    let count_before: i64 = fixture
        .store
        .conn
        .query_row("SELECT COUNT(*) FROM askills_deployment_plans", [], |row| {
            row.get(0)
        })
        .unwrap();
    let issue = plan_cancellable(
        &fixture.store,
        &fixture.project.id,
        &next,
        "codex",
        "copy",
        &AtomicBool::new(true),
    )
    .unwrap_err();
    assert_eq!(issue.code, "Cancelled");
    let count_after: i64 = fixture
        .store
        .conn
        .query_row("SELECT COUNT(*) FROM askills_deployment_plans", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count_after, count_before);
    assert_eq!(
        fs::read_to_string(Path::new(&installed.target_path).join("references/guide.md")).unwrap(),
        "external edit"
    );
}

#[test]
fn library_revision_drift_is_rejected_before_planning() {
    let fixture = Fixture::new();
    let revision = fixture.store.revision(&fixture.revision).unwrap();
    fs::write(
        Path::new(&revision.path).join("references/guide.md"),
        "tampered",
    )
    .unwrap();
    assert_eq!(
        plan(
            &fixture.store,
            &fixture.project.id,
            &fixture.revision,
            "codex",
            "copy"
        )
        .unwrap_err()
        .code,
        "RevisionModified"
    );
}

#[test]
fn project_process_lock_serializes_mutations() {
    let fixture = Fixture::new();
    let guard = project_guard(&fixture.store, &fixture.project.id).unwrap();
    assert_eq!(
        plan(
            &fixture.store,
            &fixture.project.id,
            &fixture.revision,
            "codex",
            "copy"
        )
        .unwrap_err()
        .code,
        "ProjectBusy"
    );
    drop(guard);
    assert!(
        plan(
            &fixture.store,
            &fixture.project.id,
            &fixture.revision,
            "codex",
            "copy"
        )
        .is_ok()
    );
}

#[cfg(any(unix, windows))]
#[test]
fn linked_parent_cannot_redirect_installation_outside_project() {
    let fixture = Fixture::new();
    let outside = fixture._root.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let redirect = Path::new(&fixture.project.path).join(".agents");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, &redirect).unwrap();
    #[cfg(windows)]
    junction::create(&outside, &redirect).unwrap();
    assert!(
        plan(
            &fixture.store,
            &fixture.project.id,
            &fixture.revision,
            "codex",
            "copy"
        )
        .is_err()
    );
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    #[cfg(unix)]
    fs::remove_file(&redirect).unwrap();
    #[cfg(windows)]
    junction::delete(&redirect).unwrap();
}

fn staged_upgrade(fixture: &mut Fixture, installed: &Deployment) -> Journal {
    let next = fixture.next_revision();
    let before = get_saved(&fixture.store, &installed.id).unwrap();
    let revision = fixture.store.revision(&next).unwrap();
    let mut after = before.clone();
    after.view.revision_id = next;
    after.view.previous_revision_id = Some(before.view.revision_id.clone());
    after.revision_path = revision.path;
    after.hash = revision.hash;
    after.identity = String::new();
    let mut journal = Journal {
        id: Uuid::new_v4().to_string(),
        project_id: fixture.project.id.clone(),
        project_path: fixture.project.path.clone(),
        target: installed.target_path.clone(),
        before: Some(before),
        after: Some(after),
        lock_before: validate_lock(
            &fixture.store,
            &fixture.project.id,
            Path::new(&fixture.project.path),
        )
        .unwrap(),
        lock_after: String::new(),
        lock_old_identity: None,
        lock_new_identity: None,
    };
    let paths = filesystem::Paths::new(&journal).unwrap();
    let source = PathBuf::from(&journal.after.as_ref().unwrap().revision_path);
    filesystem::prepare_entry(
        &paths.temp,
        &source,
        "copy",
        &AtomicBool::new(false),
        |mode, identity| {
            let after = journal.after.as_mut().unwrap();
            after.view.mode = mode.into();
            after.identity = identity;
            Ok(())
        },
    )
    .unwrap();
    journal.lock_after = serde_json::to_string_pretty(
        &lock_document(
            &fixture.store,
            &fixture.project.id,
            journal.after.as_ref(),
            Some(&installed.id),
        )
        .unwrap(),
    )
    .unwrap()
        + "\n";
    journal.lock_old_identity = Some(filesystem::identity(&paths.lock).unwrap());
    let text = journal.lock_after.clone();
    filesystem::prepare_lock(&paths.lock_temp, text.as_bytes(), |identity| {
        journal.lock_new_identity = Some(identity);
        Ok(())
    })
    .unwrap();
    journal_save(&fixture.store, &journal, "applying", None).unwrap();
    journal
}

#[test]
fn recovery_restores_old_binding_at_each_filesystem_cutpoint() {
    for cutpoint in 0..=4 {
        let mut fixture = Fixture::new();
        let installed = fixture.install("copy");
        let journal = staged_upgrade(&mut fixture, &installed);
        let paths = filesystem::Paths::new(&journal).unwrap();
        if cutpoint >= 1 {
            fs::rename(&paths.target, &paths.backup).unwrap();
        }
        if cutpoint >= 2 {
            fs::rename(&paths.temp, &paths.target).unwrap();
        }
        if cutpoint >= 3 {
            fs::rename(&paths.lock, &paths.lock_backup).unwrap();
        }
        if cutpoint >= 4 {
            fs::rename(&paths.lock_temp, &paths.lock).unwrap();
        }
        let data_dir = fixture.store.data_dir.clone();
        // Open a fresh connection, matching startup recovery after a process exit.
        drop(fixture.store);
        let mut reopened = Store::open(&data_dir).unwrap();
        let notices = recover(&mut reopened).unwrap();
        assert_eq!(notices.len(), 1);
        assert!(
            notices[0].starts_with("已恢复"),
            "cutpoint {cutpoint}: {notices:?}"
        );
        assert_eq!(
            fs::read_to_string(paths.target.join("references/guide.md")).unwrap(),
            "first"
        );
        assert_eq!(
            get_saved(&reopened, &installed.id)
                .unwrap()
                .view
                .revision_id,
            fixture.revision
        );
        assert!(!paths.backup.exists());
        assert!(!paths.temp.exists());
        assert!(!paths.lock_backup.exists());
        validate_lock(
            &reopened,
            &fixture.project.id,
            Path::new(&fixture.project.path),
        )
        .unwrap();
    }
}

#[test]
fn committed_recovery_keeps_new_binding_and_only_cleans_backups() {
    let mut fixture = Fixture::new();
    let installed = fixture.install("copy");
    let journal = staged_upgrade(&mut fixture, &installed);
    let paths = filesystem::Paths::new(&journal).unwrap();
    fs::rename(&paths.target, &paths.backup).unwrap();
    fs::rename(&paths.temp, &paths.target).unwrap();
    fs::rename(&paths.lock, &paths.lock_backup).unwrap();
    fs::rename(&paths.lock_temp, &paths.lock).unwrap();
    let after = journal.after.as_ref().unwrap();
    fixture
        .store
        .conn
        .execute(
            "UPDATE askills_deployments SET payload=?2 WHERE id=?1",
            params![installed.id, serialize(after).unwrap()],
        )
        .unwrap();
    journal_save(&fixture.store, &journal, "committed", None).unwrap();
    let notices = recover(&mut fixture.store).unwrap();
    assert!(notices[0].starts_with("已恢复"));
    assert_eq!(
        fs::read_to_string(paths.target.join("references/guide.md")).unwrap(),
        "second"
    );
    assert_eq!(
        get_saved(&fixture.store, &installed.id)
            .unwrap()
            .view
            .revision_id,
        after.view.revision_id
    );
    assert!(!paths.backup.exists());
    assert!(!paths.lock_backup.exists());
}

#[test]
fn recovery_preserves_unknown_replacement_and_leaves_actionable_journal() {
    let mut fixture = Fixture::new();
    let installed = fixture.install("copy");
    let journal = staged_upgrade(&mut fixture, &installed);
    let paths = filesystem::Paths::new(&journal).unwrap();
    fs::rename(&paths.target, &paths.backup).unwrap();
    fs::create_dir(&paths.target).unwrap();
    fs::write(paths.target.join("user.txt"), "do not delete").unwrap();
    let notices = recover(&mut fixture.store).unwrap();
    assert!(notices[0].contains("需要处理"));
    assert_eq!(
        fs::read_to_string(paths.target.join("user.txt")).unwrap(),
        "do not delete"
    );
    assert!(paths.backup.join("SKILL.md").is_file());
    assert_eq!(
        no_pending(&fixture.store, &fixture.project.id)
            .unwrap_err()
            .code,
        "RecoveryRequired"
    );
}

#[test]
fn cancelling_partial_copy_can_be_recovered_from_journal() {
    let mut fixture = Fixture::new();
    let preview = plan(
        &fixture.store,
        &fixture.project.id,
        &fixture.revision,
        "codex",
        "copy",
    )
    .unwrap();
    let revision = fixture.store.revision(&fixture.revision).unwrap();
    let view = Deployment {
        id: Uuid::new_v4().to_string(),
        project_id: fixture.project.id.clone(),
        skill_id: revision.skill_id,
        revision_id: revision.id,
        name: "sample".into(),
        agent: "codex".into(),
        mode: "copy".into(),
        target_path: preview.target_path.clone(),
        previous_revision_id: None,
        status: "installed".into(),
    };
    let mut journal = Journal {
        id: Uuid::new_v4().to_string(),
        project_id: fixture.project.id.clone(),
        project_path: fixture.project.path.clone(),
        target: preview.target_path,
        before: None,
        after: Some(SavedDeployment {
            view,
            revision_path: revision.path.clone(),
            hash: revision.hash,
            identity: String::new(),
        }),
        lock_before: None,
        lock_after: String::new(),
        lock_old_identity: None,
        lock_new_identity: None,
    };
    let paths = filesystem::Paths::new(&journal).unwrap();
    fs::create_dir_all(&paths.parent).unwrap();
    let cancel = AtomicBool::new(false);
    let issue = filesystem::prepare_entry(
        &paths.temp,
        Path::new(&revision.path),
        "copy",
        &cancel,
        |_, identity| {
            journal.after.as_mut().unwrap().identity = identity;
            journal_save(&fixture.store, &journal, "preparing", None)?;
            cancel.store(true, Ordering::Relaxed);
            Ok(())
        },
    )
    .unwrap_err();
    assert_eq!(issue.code, "Cancelled");
    let notices = recover(&mut fixture.store).unwrap();
    assert!(notices[0].starts_with("已恢复"));
    assert!(!paths.temp.exists());
    assert!(!paths.target.exists());
}
