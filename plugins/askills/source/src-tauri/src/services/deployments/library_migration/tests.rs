use super::*;
use crate::domain::Project;

struct Fixture {
    store: Store,
    root: tempfile::TempDir,
    input: PathBuf,
    project: Project,
    first: String,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(&root.path().join("data")).unwrap();
        let input = root.path().join("来源 with spaces");
        fs::create_dir(&input).unwrap();
        fs::write(
            input.join("SKILL.md"),
            "---\nname: migration-test\ndescription: test\n---\nfirst\n",
        )
        .unwrap();
        let first = store
            .import_local(&input, None, None, &AtomicBool::new(false))
            .unwrap()
            .latest_revision_id;
        let project_path = root.path().join("项目 with spaces");
        fs::create_dir(&project_path).unwrap();
        let project = store.add_project(&project_path).unwrap();
        Self {
            store,
            root,
            input,
            project,
            first,
        }
    }

    fn install(&mut self, mode: &str, revision: &str) -> Deployment {
        let plan = plan(&self.store, &self.project.id, revision, "codex", mode).unwrap();
        apply(&mut self.store, &plan.id, &AtomicBool::new(false)).unwrap()
    }

    fn upgrade(&mut self, mode: &str) -> Deployment {
        self.install(mode, &self.first.clone());
        fs::write(
            self.input.join("SKILL.md"),
            "---\nname: migration-test\ndescription: test\n---\nsecond\n",
        )
        .unwrap();
        let second = self
            .store
            .import_local(&self.input, None, None, &AtomicBool::new(false))
            .unwrap()
            .latest_revision_id;
        self.install(mode, &second)
    }

    fn copy_library(&self) -> PathBuf {
        let destination = self.root.path().join("迁移后的 library");
        fs::create_dir(&destination).unwrap();
        safe_fs::copy_tree(
            &self.store.library_root.join("skills"),
            &destination.join("skills"),
            &AtomicBool::new(false),
        )
        .unwrap();
        fs::copy(
            self.store.library_root.join("library.json"),
            destination.join("library.json"),
        )
        .unwrap();
        safe_fs::canonical_directory(&destination).unwrap()
    }

    fn activate_copied_library(&mut self, destination: &Path) {
        let revisions: Vec<(String, String)> = self
            .store
            .conn
            .prepare("SELECT id,json FROM revisions")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        for (id, json) in revisions {
            let mut revision: Revision = serde_json::from_str(&json).unwrap();
            revision.path = safe_fs::display_path(&path_at(destination, &revision));
            self.store
                .conn
                .execute(
                    "UPDATE revisions SET json=?2 WHERE id=?1",
                    params![id, serialize(&revision).unwrap()],
                )
                .unwrap();
        }
        self.store.library_root = destination.to_path_buf();
    }
}

#[test]
fn copy_migration_keeps_files_and_rollback_history_and_expires_plans() {
    let mut fixture = Fixture::new();
    let installed = fixture.upgrade("copy");
    let before = get_saved(&fixture.store, &installed.id).unwrap();
    let lock_before = fs::read(Path::new(&fixture.project.path).join("askills.lock.json")).unwrap();
    let old_root = fixture.store.library_root.clone();
    let new_root = fixture.copy_library();
    let stale = plan(
        &fixture.store,
        &fixture.project.id,
        &installed.revision_id,
        "codex",
        "copy",
    )
    .unwrap();
    assert_eq!(
        preflight_library_migration(&fixture.store, &AtomicBool::new(false)).unwrap(),
        1
    );
    relocate_library(
        &mut fixture.store,
        &old_root,
        &new_root,
        &AtomicBool::new(false),
    )
    .unwrap();
    let after = get_saved(&fixture.store, &installed.id).unwrap();
    assert_eq!(
        serialize(&after.view).unwrap(),
        serialize(&before.view).unwrap()
    );
    assert_eq!(after.identity, before.identity);
    assert_eq!(
        fs::read(Path::new(&fixture.project.path).join("askills.lock.json")).unwrap(),
        lock_before
    );
    assert_eq!(
        apply(&mut fixture.store, &stale.id, &AtomicBool::new(false))
            .unwrap_err()
            .code,
        "PlanExpired"
    );
    // Simulate restarting after settings changed but before absolute SQLite paths
    // were rewritten. Relocation must not require Store::revision to succeed yet.
    fixture.store.library_root = new_root.clone();
    assert_eq!(
        fixture
            .store
            .revision(&installed.revision_id)
            .unwrap_err()
            .code,
        "InvalidRevisionPath"
    );
    relocate_library(
        &mut fixture.store,
        &old_root,
        &new_root,
        &AtomicBool::new(false),
    )
    .unwrap();
    fixture.activate_copied_library(&new_root);
    let restored = rollback(&mut fixture.store, &installed.id, &AtomicBool::new(false)).unwrap();
    assert_eq!(restored.revision_id, fixture.first);
    assert!(
        fs::read_to_string(Path::new(&restored.target_path).join("SKILL.md"))
            .unwrap()
            .ends_with("first\n")
    );
}

#[cfg(any(unix, windows))]
#[test]
fn link_migration_rebinds_hidden_project_and_preserves_previous_revision() {
    let mut fixture = Fixture::new();
    let mode = if cfg!(windows) { "junction" } else { "symlink" };
    let installed = fixture.upgrade(mode);
    fixture
        .store
        .remove_projects(&[fixture.project.id.clone()], &AtomicBool::new(false))
        .unwrap();
    assert!(fixture.store.list_projects().unwrap().is_empty());
    assert_eq!(
        preflight_library_migration(&fixture.store, &AtomicBool::new(false)).unwrap(),
        1
    );
    let old_root = fixture.store.library_root.clone();
    let new_root = fixture.copy_library();
    let before = get_saved(&fixture.store, &installed.id).unwrap();
    fixture.activate_copied_library(&new_root);
    relocate_library(
        &mut fixture.store,
        &old_root,
        &new_root,
        &AtomicBool::new(false),
    )
    .unwrap();
    let after = get_saved(&fixture.store, &installed.id).unwrap();
    assert_eq!(
        serialize(&before.view).unwrap(),
        serialize(&after.view).unwrap()
    );
    assert_ne!(before.identity, after.identity);
    assert_eq!(
        fs::canonicalize(&installed.target_path).unwrap(),
        fs::canonicalize(&after.revision_path).unwrap()
    );
    assert!(
        fs::canonicalize(&installed.target_path)
            .unwrap()
            .starts_with(&new_root)
    );
    assert!(
        fs::read_dir(Path::new(&installed.target_path).parent().unwrap())
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".askills-"))
    );
    assert_eq!(list(&fixture.store).unwrap()[0].status, "installed");
    relocate_library(
        &mut fixture.store,
        &old_root,
        &new_root,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(
        get_saved(&fixture.store, &installed.id).unwrap().identity,
        after.identity
    );
    let restored = rollback(&mut fixture.store, &installed.id, &AtomicBool::new(false)).unwrap();
    assert_eq!(restored.revision_id, fixture.first);
    assert!(
        fs::canonicalize(&restored.target_path)
            .unwrap()
            .starts_with(new_root)
    );
}

#[test]
fn changed_copy_or_lock_blocks_preflight_without_overwriting_content() {
    let mut fixture = Fixture::new();
    let installed = fixture.install("copy", &fixture.first.clone());
    let path = Path::new(&installed.target_path).join("SKILL.md");
    let original = fs::read(&path).unwrap();
    fs::write(&path, "my changes").unwrap();
    assert_eq!(
        preflight_library_migration(&fixture.store, &AtomicBool::new(false))
            .unwrap_err()
            .code,
        "LocalChangesDetected"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), "my changes");
    fs::write(&path, original).unwrap();
    let lock = Path::new(&fixture.project.path).join("askills.lock.json");
    fs::write(&lock, "user lock content").unwrap();
    assert_eq!(
        preflight_library_migration(&fixture.store, &AtomicBool::new(false))
            .unwrap_err()
            .code,
        "LockConflict"
    );
    assert_eq!(fs::read_to_string(&lock).unwrap(), "user lock content");
}

#[test]
fn cancelled_relocation_and_modified_destination_leave_installation_unchanged() {
    let mut fixture = Fixture::new();
    let installed = fixture.install("copy", &fixture.first.clone());
    let before = serialize(&get_saved(&fixture.store, &installed.id).unwrap()).unwrap();
    let old_root = fixture.store.library_root.clone();
    let new_root = fixture.copy_library();
    assert_eq!(
        relocate_library(
            &mut fixture.store,
            &old_root,
            &new_root,
            &AtomicBool::new(true)
        )
        .unwrap_err()
        .code,
        "Cancelled"
    );
    let revision = fixture.store.revision(&fixture.first).unwrap();
    fs::write(path_at(&new_root, &revision).join("SKILL.md"), "modified").unwrap();
    assert_eq!(
        relocate_library(
            &mut fixture.store,
            &old_root,
            &new_root,
            &AtomicBool::new(false)
        )
        .unwrap_err()
        .code,
        "RevisionModified"
    );
    assert_eq!(
        serialize(&get_saved(&fixture.store, &installed.id).unwrap()).unwrap(),
        before
    );
    assert_eq!(list(&fixture.store).unwrap()[0].status, "installed");
}

#[cfg(any(unix, windows))]
#[test]
fn interrupted_link_rebinding_recovers_then_can_be_retried() {
    let mut fixture = Fixture::new();
    let mode = if cfg!(windows) { "junction" } else { "symlink" };
    let installed = fixture.install(mode, &fixture.first.clone());
    let old_root = fixture.store.library_root.clone();
    let new_root = fixture.copy_library();
    let before = get_saved(&fixture.store, &installed.id).unwrap();
    let mut after = before.clone();
    after.revision_path = safe_fs::display_path(&path_at(
        &new_root,
        &fixture.store.revision(&fixture.first).unwrap(),
    ));
    after.identity.clear();
    let mut journal = Journal {
        id: Uuid::new_v4().to_string(),
        project_id: fixture.project.id.clone(),
        project_path: fixture.project.path.clone(),
        target: installed.target_path.clone(),
        before: Some(before.clone()),
        after: Some(after.clone()),
        lock_before: read_lock(&Path::new(&fixture.project.path).join("askills.lock.json"))
            .unwrap(),
        lock_after: String::new(),
        lock_old_identity: None,
        lock_new_identity: None,
    };
    journal_save(&fixture.store, &journal, "prepared", None).unwrap();
    let paths = filesystem::Paths::new(&journal).unwrap();
    filesystem::prepare_entry(
        &paths.temp,
        Path::new(&after.revision_path),
        mode,
        &AtomicBool::new(false),
        |_, identity| {
            journal.after.as_mut().unwrap().identity = identity;
            journal_save(&fixture.store, &journal, "applying", None)
        },
    )
    .unwrap();
    fs::rename(&paths.target, &paths.backup).unwrap();
    fs::rename(&paths.temp, &paths.target).unwrap();
    assert_eq!(
        preflight_library_migration(&fixture.store, &AtomicBool::new(false))
            .unwrap_err()
            .code,
        "RecoveryRequired"
    );
    let notices = recover(&mut fixture.store).unwrap();
    assert_eq!(notices.len(), 1);
    assert!(notices[0].starts_with("已恢复操作"), "{notices:?}");
    assert_eq!(
        filesystem::identity(&paths.target).unwrap(),
        before.identity
    );
    assert!(!paths.backup.exists());
    relocate_library(
        &mut fixture.store,
        &old_root,
        &new_root,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert!(
        fs::canonicalize(&paths.target)
            .unwrap()
            .starts_with(new_root)
    );
    assert_eq!(list(&fixture.store).unwrap()[0].status, "installed");
}
