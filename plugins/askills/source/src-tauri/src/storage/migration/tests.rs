use super::*;

#[test]
fn an_upgraded_default_library_migration_recovers_after_the_ready_boundary() {
    let mut fixture = Fixture::new();
    let legacy = fixture.store.data_dir.clone();
    let data = fixture.root.path().join("asklils");
    drop(fixture.store);
    crate::storage::inherit_legacy_data(&data, &legacy).unwrap();
    fixture.store = Store::open(&data).unwrap();
    deployments::initialize(&fixture.store).unwrap();
    let (target, target_id, target_lock) =
        initialize_library(&fixture.store.data_dir.join("library")).unwrap();
    let migration = Migration {
        schema_version: 1,
        id: Uuid::new_v4().to_string(),
        source: fixture.store.library_root.clone(),
        target: target.clone(),
        source_id: fixture.store.library_id.clone(),
        target_id,
        phase: Phase::Ready,
        inventory: inventory(&fixture.store.library_root, &AtomicBool::new(false)).unwrap(),
    };
    copy_library(&migration, &AtomicBool::new(false)).unwrap();
    fixture.store.save_migration(&migration).unwrap();
    drop(target_lock);
    drop(fixture.store);
    let reopened = Store::open(&data).unwrap();
    assert_eq!(reopened.library_root, target);
    assert_eq!(reopened.list_skills().unwrap()[0].id, fixture.skill.id);
    assert!(
        reopened
            .read_revision(&fixture.skill.latest_revision_id)
            .unwrap()
            .markdown
            .contains("first version")
    );
    assert!(migration.source.join("library.json").is_file());
    assert!(!reopened.data_dir.join(JOURNAL).exists());
}

struct Fixture {
    store: Store,
    root: tempfile::TempDir,
    input: PathBuf,
    skill: Skill,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(&root.path().join("app")).unwrap();
        let input = root.path().join("中文 skill source");
        fs::create_dir(&input).unwrap();
        fs::write(
            input.join("SKILL.md"),
            "---\nname: migration-sample\ndescription: test\n---\nfirst version\n",
        )
        .unwrap();
        let skill = store
            .import_local(&input, None, None, &AtomicBool::new(false))
            .unwrap();
        fs::write(store.library_root.join("local/notes.txt"), "自己的笔记").unwrap();
        fs::create_dir(store.library_root.join("local/empty folder")).unwrap();
        Self {
            store,
            root,
            input,
            skill,
        }
    }

    /// Arrange a durable crash boundary without introducing timing-dependent
    /// process kills or test hooks into the migration implementation.
    fn journal(&self, phase: Phase, complete_copy: bool) -> (Migration, File) {
        let (target, target_id, lock) =
            initialize_library(&self.root.path().join("迁移后的 library")).unwrap();
        let migration = Migration {
            schema_version: 1,
            id: Uuid::new_v4().to_string(),
            source: self.store.library_root.clone(),
            target,
            source_id: self.store.library_id.clone(),
            target_id,
            phase,
            inventory: inventory(&self.store.library_root, &AtomicBool::new(false)).unwrap(),
        };
        if complete_copy {
            copy_library(&migration, &AtomicBool::new(false)).unwrap();
        } else {
            fs::copy(
                migration.source.join("local/notes.txt"),
                migration.target.join("local/notes.txt"),
            )
            .unwrap();
        }
        self.store.save_migration(&migration).unwrap();
        (migration, lock)
    }

    #[cfg(any(unix, windows))]
    fn upgrade_projects(&mut self) -> Vec<deployments::Deployment> {
        let cancel = AtomicBool::new(false);
        let linked_mode = if cfg!(windows) { "junction" } else { "symlink" };
        let mut projects = Vec::new();
        for mode in ["copy", linked_mode] {
            let path = self.root.path().join(format!("{mode} 项目"));
            fs::create_dir(&path).unwrap();
            let project = self.store.add_project(&path).unwrap();
            let plan = deployments::plan(
                &self.store,
                &project.id,
                &self.skill.latest_revision_id,
                "codex",
                mode,
            )
            .unwrap();
            deployments::apply(&mut self.store, &plan.id, &cancel).unwrap();
            projects.push((project, mode));
        }
        fs::write(
            self.input.join("SKILL.md"),
            "---\nname: migration-sample\ndescription: test\n---\nsecond version\n",
        )
        .unwrap();
        let second = self
            .store
            .import_local(&self.input, None, None, &cancel)
            .unwrap();
        projects
            .into_iter()
            .map(|(project, mode)| {
                let plan = deployments::plan(
                    &self.store,
                    &project.id,
                    &second.latest_revision_id,
                    "codex",
                    mode,
                )
                .unwrap();
                let installed = deployments::apply(&mut self.store, &plan.id, &cancel).unwrap();
                assert_eq!(
                    installed.previous_revision_id.as_deref(),
                    Some(self.skill.latest_revision_id.as_str())
                );
                installed
            })
            .collect()
    }
}

#[cfg(any(unix, windows))]
fn assert_relocated_projects(store: &Store, original: &[deployments::Deployment]) {
    let installed = deployments::list(store).unwrap();
    assert_eq!(installed.len(), original.len());
    for before in original {
        let after = installed.iter().find(|item| item.id == before.id).unwrap();
        assert_eq!(after.status, "installed");
        assert_eq!(
            serde_json::to_value(after).unwrap(),
            serde_json::to_value(before).unwrap()
        );
        let target = Path::new(&after.target_path);
        assert!(
            fs::read_to_string(target.join("SKILL.md"))
                .unwrap()
                .ends_with("second version\n")
        );
        if after.mode == "copy" {
            assert!(!is_link(&fs::symlink_metadata(target).unwrap()));
            assert!(
                !fs::canonicalize(target)
                    .unwrap()
                    .starts_with(&store.library_root)
            );
        } else {
            assert!(is_link(&fs::symlink_metadata(target).unwrap()));
            let revision = store.revision(&after.revision_id).unwrap();
            assert_eq!(
                fs::canonicalize(target).unwrap(),
                fs::canonicalize(&revision.path).unwrap()
            );
            assert!(
                fs::canonicalize(target)
                    .unwrap()
                    .starts_with(&store.library_root)
            );
        }
    }
}

#[cfg(any(unix, windows))]
#[test]
fn full_migration_reopens_copy_and_link_projects_and_rolls_back_without_old_library() {
    let mut fixture = Fixture::new();
    let upgraded = fixture.upgrade_projects();
    let cancel = AtomicBool::new(false);
    let old_root = fixture.store.library_root.clone();
    let target = fixture.root.path().join("新 skills 库");
    let lock_contents: Vec<_> = upgraded
        .iter()
        .map(|item| {
            let project = fixture.store.project(&item.project_id).unwrap();
            let path = Path::new(&project.path).join("askills.lock.json");
            let contents = fs::read(&path).unwrap();
            (path, contents)
        })
        .collect();
    let plan = fixture
        .store
        .preview_library_migration(&target, &cancel)
        .unwrap();
    assert_eq!(plan.deployment_count, 2);
    assert_eq!(plan.revision_count, 2);
    fixture.store.migrate_library(&target, &cancel).unwrap();
    assert_relocated_projects(&fixture.store, &upgraded);
    assert!(old_root.join("library.json").is_file());
    for (path, before) in &lock_contents {
        assert_eq!(&fs::read(path).unwrap(), before);
    }

    let data = fixture.store.data_dir.clone();
    drop(fixture.store);
    let mut reopened = Store::open(&data).unwrap();
    assert_eq!(reopened.library_root, canonical_directory(&target).unwrap());
    assert_relocated_projects(&reopened, &upgraded);
    // This is a disposable fixture backup, checked against its exact expected
    // temporary location before deletion. Subsequent operations must use the new
    // library, including the previous revision needed for rollback.
    assert_eq!(
        old_root,
        canonical_directory(&fixture.root.path().join("app/library")).unwrap()
    );
    remove_tree(&old_root).unwrap();
    assert!(!old_root.exists());
    assert_relocated_projects(&reopened, &upgraded);
    for before in &upgraded {
        let restored = deployments::rollback(&mut reopened, &before.id, &cancel).unwrap();
        assert_eq!(restored.revision_id, fixture.skill.latest_revision_id);
        assert_eq!(
            restored.previous_revision_id.as_deref(),
            Some(before.revision_id.as_str())
        );
        assert_eq!(restored.mode, before.mode);
        assert!(
            fs::read_to_string(Path::new(&restored.target_path).join("SKILL.md"))
                .unwrap()
                .ends_with("first version\n")
        );
        if restored.mode != "copy" {
            let revision = reopened.revision(&restored.revision_id).unwrap();
            assert_eq!(
                fs::canonicalize(&restored.target_path).unwrap(),
                fs::canonicalize(&revision.path).unwrap()
            );
        }
        assert!(
            deployments::list(&reopened)
                .unwrap()
                .iter()
                .all(|item| item.status == "installed")
        );
        deployments::uninstall(&mut reopened, &restored.id, &cancel).unwrap();
        assert!(!Path::new(&restored.target_path).exists());
    }
    assert!(deployments::list(&reopened).unwrap().is_empty());
    reopened
        .read_revision(&fixture.skill.latest_revision_id)
        .unwrap();
    drop(reopened);
    let reopened = Store::open(&data).unwrap();
    assert!(deployments::list(&reopened).unwrap().is_empty());
    reopened
        .read_revision(&fixture.skill.latest_revision_id)
        .unwrap();
}

#[cfg(any(unix, windows))]
#[test]
fn ready_recovery_accepts_already_relocated_projects_before_settings_switch() {
    let mut fixture = Fixture::new();
    let upgraded = fixture.upgrade_projects();
    let (migration, target_lock) = fixture.journal(Phase::Ready, true);
    deployments::relocate_library(
        &mut fixture.store,
        &migration.source,
        &migration.target,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(fixture.store.library_root, migration.source);
    assert!(!fixture.store.data_dir.join("settings.json").exists());
    let linked = upgraded.iter().find(|item| item.mode != "copy").unwrap();
    assert!(
        fs::canonicalize(&linked.target_path)
            .unwrap()
            .starts_with(&migration.target)
    );
    let saved_before_restart: String = fixture
        .store
        .conn
        .query_row(
            "SELECT payload FROM askills_deployments WHERE id=?1",
            [&linked.id],
            |row| row.get(0),
        )
        .unwrap();
    let old_revision = fixture.store.revision(&linked.revision_id).unwrap();
    assert!(Path::new(&old_revision.path).starts_with(display_path(&migration.source)));
    let data = fixture.store.data_dir.clone();
    drop(target_lock);
    drop(fixture.store);

    let reopened = Store::open(&data).unwrap();
    assert_eq!(reopened.library_root, migration.target);
    assert_relocated_projects(&reopened, &upgraded);
    let saved_after_restart: String = reopened
        .conn
        .query_row(
            "SELECT payload FROM askills_deployments WHERE id=?1",
            [&linked.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(saved_after_restart, saved_before_restart);
    assert!(!data.join(JOURNAL).exists());
    assert!(Path::new(&old_revision.path).join("SKILL.md").is_file());
}

#[test]
fn populated_library_larger_than_one_skill_limit_preserves_versions_names_and_removed_items() {
    let mut fixture = Fixture::new();
    let cancel = AtomicBool::new(false);
    let first = fixture.skill.latest_revision_id.clone();
    fs::write(
        fixture.input.join("SKILL.md"),
        "---\nname: migration-sample\ndescription: test\n---\nsecond version\n",
    )
    .unwrap();
    let second = fixture
        .store
        .import_local(&fixture.input, None, None, &cancel)
        .unwrap();
    fixture
        .store
        .set_display_name(&fixture.skill.id, "我的常用 skill")
        .unwrap();
    let retired_input = fixture.root.path().join("retired source");
    fs::create_dir(&retired_input).unwrap();
    fs::write(
        retired_input.join("SKILL.md"),
        "---\nname: retired\ndescription: test\n---\nretired version\n",
    )
    .unwrap();
    let retired = fixture
        .store
        .import_local(&retired_input, None, None, &cancel)
        .unwrap();
    fixture
        .store
        .remove_library_skills(std::slice::from_ref(&retired.id), &cancel)
        .unwrap();

    // The 128 MiB limit is per skill, not a limit on an entire library. Each
    // local file remains below the independent 16 MiB single-file limit.
    const FILE_BYTES: usize = 15 * 1024 * 1024;
    for index in 0..9u8 {
        fs::write(
            fixture
                .store
                .library_root
                .join(format!("local/{index}.bin")),
            vec![index; FILE_BYTES],
        )
        .unwrap();
    }
    let old_root = fixture.store.library_root.clone();
    let target = fixture.root.path().join("新 skills 库");
    let plan = fixture
        .store
        .preview_library_migration(&target, &cancel)
        .unwrap();
    assert_eq!(plan.skill_count, 2);
    assert_eq!(plan.revision_count, 3);
    assert_eq!(plan.deployment_count, 0);
    assert!(plan.total_bytes > crate::platform::fs::MAX_TOTAL_BYTES);
    assert!(
        !target.exists(),
        "preview must not initialize the destination"
    );

    let migrated = fixture.store.migrate_library(&target, &cancel).unwrap();
    let target = canonical_directory(&target).unwrap();
    assert_eq!(migrated.library_root, display_path(&target));
    assert_eq!(migrated.previous_root, display_path(&old_root));
    assert_eq!(fixture.store.library_root, target);
    assert_eq!(fixture.store.list_skills().unwrap().len(), 1);
    assert_eq!(
        fixture
            .store
            .skill(&fixture.skill.id)
            .unwrap()
            .display_name
            .as_deref(),
        Some("我的常用 skill")
    );
    for (id, text) in [
        (&first, "first version"),
        (&second.latest_revision_id, "second version"),
        (&retired.latest_revision_id, "retired version"),
    ] {
        let document = fixture.store.read_revision(id).unwrap();
        assert!(document.markdown.contains(text));
        let new_revision = Path::new(&document.revision.path);
        let relative = new_revision
            .strip_prefix(Path::new(&display_path(&target)))
            .unwrap();
        assert_eq!(
            fs::read(new_revision.join("SKILL.md")).unwrap(),
            fs::read(old_root.join(relative).join("SKILL.md")).unwrap()
        );
    }
    for index in 0..9u8 {
        let relative = format!("local/{index}.bin");
        let copied = fs::read(target.join(&relative)).unwrap();
        assert_eq!(copied.len(), FILE_BYTES);
        assert!(copied.iter().all(|byte| *byte == index));
        assert_eq!(
            fs::metadata(old_root.join(relative)).unwrap().len(),
            FILE_BYTES as u64
        );
    }
    for relative in ["removed-skills.json", "local/notes.txt"] {
        assert_eq!(
            fs::read(target.join(relative)).unwrap(),
            fs::read(old_root.join(relative)).unwrap()
        );
    }
    assert!(target.join("local/empty folder").is_dir());
    assert!(old_root.join("library.json").is_file());
    assert!(!fixture.store.data_dir.join(JOURNAL).exists());

    let data = fixture.store.data_dir.clone();
    drop(fixture.store);
    let reopened = Store::open(&data).unwrap();
    assert_eq!(reopened.library_root, target);
    assert_eq!(reopened.list_skills().unwrap().len(), 1);
    assert_eq!(
        reopened
            .skill(&fixture.skill.id)
            .unwrap()
            .display_name
            .as_deref(),
        Some("我的常用 skill")
    );
    assert_eq!(reopened.list_revisions(&fixture.skill.id).unwrap().len(), 2);
    for revision in [first, second.latest_revision_id, retired.latest_revision_id] {
        reopened.read_revision(&revision).unwrap();
    }
    assert!(old_root.join("local/notes.txt").is_file());
}

#[test]
fn foreign_nested_data_and_project_destinations_are_rejected_without_writes() {
    let fixture = Fixture::new();
    let cancel = AtomicBool::new(false);
    let foreign = fixture.root.path().join("foreign");
    fs::create_dir(&foreign).unwrap();
    fs::write(foreign.join("keep.txt"), "untouched").unwrap();
    assert_eq!(
        fixture
            .store
            .preview_library_migration(&foreign, &cancel)
            .unwrap_err()
            .code,
        "DirectoryNotEmpty"
    );
    assert!(!foreign.join("library.json").exists());
    assert_eq!(
        fs::read_to_string(foreign.join("keep.txt")).unwrap(),
        "untouched"
    );

    let projects = fixture.root.path().join("projects");
    let project = projects.join("registered");
    fs::create_dir_all(&project).unwrap();
    let registered = fixture.store.add_project(&project).unwrap();
    fixture
        .store
        .remove_projects(&[registered.id], &cancel)
        .unwrap();
    for target in [
        fixture.store.library_root.join("nested"),
        fixture.store.library_root.parent().unwrap().to_path_buf(),
        fixture.store.data_dir.join("another library"),
        project.clone(),
        project.join("nested library"),
        projects,
    ] {
        assert_eq!(
            fixture
                .store
                .preview_library_migration(&target, &cancel)
                .unwrap_err()
                .code,
            "UnsafeLibraryRoot",
            "{}",
            target.display()
        );
    }
    assert!(!fixture.store.data_dir.join(JOURNAL).exists());
    fixture
        .store
        .read_revision(&fixture.skill.latest_revision_id)
        .unwrap();
}

#[test]
fn links_in_source_and_destination_are_rejected_without_following_them() {
    let fixture = Fixture::new();
    let outside = fixture.root.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("keep.txt"), "untouched").unwrap();
    let target = fixture.root.path().join("target");
    for link in [
        fixture.store.library_root.join("local/escape"),
        target.clone(),
    ] {
        #[cfg(windows)]
        junction::create(&outside, &link).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert_eq!(
            fixture
                .store
                .preview_library_migration(&target, &AtomicBool::new(false))
                .unwrap_err()
                .code,
            "UnsafeLink"
        );
        #[cfg(windows)]
        junction::delete(&link).unwrap();
        #[cfg(unix)]
        fs::remove_file(&link).unwrap();
    }
    assert_eq!(
        fs::read_to_string(outside.join("keep.txt")).unwrap(),
        "untouched"
    );
    assert!(!fixture.store.data_dir.join(JOURNAL).exists());
}

#[test]
fn cancelled_copy_cleans_only_its_partial_files_and_keeps_original_readable() {
    let mut fixture = Fixture::new();
    let target = fixture.root.path().join("not initialized");
    assert_eq!(
        fixture
            .store
            .migrate_library(&target, &AtomicBool::new(true))
            .unwrap_err()
            .code,
        "Cancelled"
    );
    assert!(!target.exists());

    let (migration, _target_lock) = fixture.journal(Phase::Copying, false);
    let original = inventory(&migration.source, &AtomicBool::new(false)).unwrap();
    assert_eq!(
        copy_library(&migration, &AtomicBool::new(true))
            .unwrap_err()
            .code,
        "Cancelled"
    );
    cleanup_copy(&migration).unwrap();
    fixture.store.clear_migration().unwrap();
    assert!(
        inventory(&migration.target, &AtomicBool::new(false))
            .unwrap()
            .files
            .is_empty()
    );
    assert_eq!(
        inventory(&migration.source, &AtomicBool::new(false)).unwrap(),
        original
    );
    assert_eq!(fixture.store.library_root, migration.source);
    fixture
        .store
        .read_revision(&fixture.skill.latest_revision_id)
        .unwrap();
}

#[test]
fn startup_rolls_back_copying_journal_and_recovers_abandoned_temporary_file() {
    let fixture = Fixture::new();
    let (migration, lock) = fixture.journal(Phase::Copying, false);
    let temporary = migration
        .target
        .join(format!(".askills-migration-{}-partial", migration.id));
    fs::write(&temporary, "interrupted atomic copy").unwrap();
    let data = fixture.store.data_dir.clone();
    drop(lock);
    drop(fixture.store);
    let reopened = Store::open(&data).unwrap();
    assert_eq!(reopened.library_root, migration.source);
    assert!(!temporary.exists());
    assert!(!migration.target.join("local/notes.txt").exists());
    assert!(!data.join(JOURNAL).exists());
    assert_eq!(
        inventory(&migration.source, &AtomicBool::new(false)).unwrap(),
        migration.inventory
    );
    reopened
        .read_revision(&fixture.skill.latest_revision_id)
        .unwrap();
}

#[test]
fn ready_journal_rolls_forward_with_either_old_or_already_updated_settings() {
    for settings_already_updated in [false, true] {
        let fixture = Fixture::new();
        let old_revision = fixture
            .store
            .revision(&fixture.skill.latest_revision_id)
            .unwrap();
        let (migration, lock) = fixture.journal(Phase::Ready, true);
        let data = fixture.store.data_dir.clone();
        if settings_already_updated {
            atomic_write(
                &data.join("settings.json"),
                &serde_json::to_vec_pretty(&Settings {
                    schema_version: 1,
                    library_root: display_path(&migration.target),
                })
                .unwrap(),
            )
            .unwrap();
        }
        let raw: String = fixture
            .store
            .conn
            .query_row(
                "SELECT json FROM revisions WHERE id=?1",
                [&old_revision.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Revision>(&raw).unwrap().path,
            old_revision.path
        );
        drop(lock);
        drop(fixture.store);

        let reopened = Store::open(&data).unwrap();
        assert_eq!(reopened.library_root, migration.target);
        let document = reopened.read_revision(&old_revision.id).unwrap();
        assert!(document.markdown.contains("first version"));
        assert_ne!(document.revision.path, old_revision.path);
        let raw: String = reopened
            .conn
            .query_row(
                "SELECT json FROM revisions WHERE id=?1",
                [&old_revision.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Revision>(&raw).unwrap().path,
            document.revision.path
        );
        assert!(Path::new(&old_revision.path).join("SKILL.md").is_file());
        assert!(!data.join(JOURNAL).exists());
        drop(reopened);
        assert_eq!(Store::open(&data).unwrap().library_root, migration.target);
    }
}

#[test]
fn copying_recovery_preserves_target_with_unfamiliar_or_modified_content() {
    for replace_known_file in [false, true] {
        let fixture = Fixture::new();
        let (migration, lock) = fixture.journal(Phase::Copying, false);
        let changed = migration.target.join(if replace_known_file {
            "local/notes.txt"
        } else {
            "local/user-added.txt"
        });
        fs::write(&changed, "external edit must survive").unwrap();
        let data = fixture.store.data_dir.clone();
        drop(lock);
        drop(fixture.store);

        let reopened = Store::open(&data).unwrap();
        assert_eq!(reopened.library_root, migration.source);
        assert_eq!(
            fs::read_to_string(&changed).unwrap(),
            "external edit must survive"
        );
        assert!(!data.join(JOURNAL).exists());
        assert_eq!(
            inventory(&migration.source, &AtomicBool::new(false)).unwrap(),
            migration.inventory
        );
        reopened
            .read_revision(&fixture.skill.latest_revision_id)
            .unwrap();
    }
}

#[test]
fn ready_recovery_retains_bad_target_and_journal_until_content_is_restored() {
    let fixture = Fixture::new();
    let (migration, lock) = fixture.journal(Phase::Ready, true);
    let changed = migration.target.join("local/notes.txt");
    fs::write(&changed, "external edit must survive").unwrap();
    let data = fixture.store.data_dir.clone();
    drop(lock);
    drop(fixture.store);

    assert!(matches!(Store::open(&data), Err(error) if error.code == "MigrationRecoveryRequired"));
    assert_eq!(
        fs::read_to_string(&changed).unwrap(),
        "external edit must survive"
    );
    assert!(data.join(JOURNAL).is_file());
    assert_eq!(
        inventory(&migration.source, &AtomicBool::new(false)).unwrap(),
        migration.inventory
    );
    fs::copy(migration.source.join("local/notes.txt"), changed).unwrap();
    let reopened = Store::open(&data).unwrap();
    assert_eq!(reopened.library_root, migration.target);
    reopened
        .read_revision(&fixture.skill.latest_revision_id)
        .unwrap();
    assert!(!data.join(JOURNAL).exists());
}

#[test]
fn empty_parent_of_registered_project_remains_rejected_when_project_is_offline() {
    let mut fixture = Fixture::new();
    let parent = fixture.root.path().join("projects");
    let project_path = parent.join("registered project");
    fs::create_dir_all(&project_path).unwrap();
    fs::write(project_path.join("keep.txt"), "original project").unwrap();
    let registered = fixture.store.add_project(&project_path).unwrap();
    let moved = fixture.root.path().join("moved project");
    let temporary_root = canonical_directory(fixture.root.path()).unwrap();
    let canonical_project = canonical_directory(&project_path).unwrap();
    assert!(canonical_project.starts_with(&temporary_root));
    assert!(
        canonical_directory(moved.parent().unwrap())
            .unwrap()
            .starts_with(&temporary_root)
    );
    fs::rename(&canonical_project, &moved).unwrap();
    assert!(!Path::new(&registered.path).exists());
    assert!(fs::read_dir(&parent).unwrap().next().is_none());
    // Stored project paths intentionally use display paths. On Windows the
    // existing parent's canonical path has a verbatim prefix, but that must not
    // bypass the overlap check when the registered project is now unavailable.
    assert_eq!(registered.path, display_path(&canonical_project));
    let original = fixture.store.library_root.clone();
    let cancel = AtomicBool::new(false);
    assert_eq!(
        fixture
            .store
            .preview_library_migration(&parent, &cancel)
            .unwrap_err()
            .code,
        "UnsafeLibraryRoot"
    );
    assert_eq!(
        fixture
            .store
            .migrate_library(&parent, &cancel)
            .unwrap_err()
            .code,
        "UnsafeLibraryRoot"
    );
    assert_eq!(fixture.store.library_root, original);
    assert!(fs::read_dir(&parent).unwrap().next().is_none());
    assert_eq!(
        fs::read_to_string(moved.join("keep.txt")).unwrap(),
        "original project"
    );
    assert!(!fixture.store.data_dir.join(JOURNAL).exists());
    fixture
        .store
        .read_revision(&fixture.skill.latest_revision_id)
        .unwrap();
}

#[test]
fn copied_library_rechecks_index_after_inventory_accepts_external_changes() {
    for changed_part in ["snapshot", "skill metadata", "revision metadata"] {
        let fixture = Fixture::new();
        let cancel = AtomicBool::new(false);
        let original = fixture.store.library_root.clone();
        fixture
            .store
            .preview_library_migration(&fixture.root.path().join("迁移后的 library"), &cancel)
            .unwrap();
        let revision = fixture
            .store
            .revision(&fixture.skill.latest_revision_id)
            .unwrap();
        let changed = if changed_part == "snapshot" {
            let path = Path::new(&revision.path).join("SKILL.md");
            fs::write(
                &path,
                "---\nname: migration-sample\ndescription: test\n---\nexternal edit\n",
            )
            .unwrap();
            path
        } else {
            let path = original
                .join("skills")
                .join(&fixture.skill.id)
                .join("manifest.json");
            let mut manifest: SkillManifest =
                serde_json::from_str(&read_text(&path).unwrap()).unwrap();
            if changed_part == "skill metadata" {
                manifest.skill.display_name = Some("external name change".into());
            } else {
                manifest.revisions[0].created_at = "external timestamp change".into();
            }
            fs::write(&path, serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
            path
        };
        let changed_bytes = fs::read(&changed).unwrap();
        // Simulate an external write after preflight's version check but before
        // inventory. The newly created copy and inventory agree with each other,
        // while neither is allowed to override the trusted SQLite metadata/hash.
        let (migration, _target_lock) = fixture.journal(Phase::Copying, true);
        assert_eq!(
            inventory(&migration.target, &cancel).unwrap(),
            migration.inventory
        );
        let error = fixture
            .store
            .verify_copied_library(&migration.target, &cancel)
            .unwrap_err();
        assert_eq!(
            error.code,
            if changed_part == "snapshot" {
                "RevisionModified"
            } else {
                "SourceChanged"
            },
            "{changed_part}"
        );
        assert_eq!(fixture.store.library_root, original);
        assert!(matches!(
            fixture.store.load_migration().unwrap().unwrap().phase,
            Phase::Copying
        ));
        assert!(!fixture.store.data_dir.join("settings.json").exists());
        assert_eq!(
            fixture.store.revision(&revision.id).unwrap().hash,
            revision.hash
        );
        assert_eq!(
            fixture.store.skill(&fixture.skill.id).unwrap().display_name,
            None
        );
        cleanup_copy(&migration).unwrap();
        fixture.store.clear_migration().unwrap();
        assert_eq!(fs::read(&changed).unwrap(), changed_bytes);
        assert!(
            inventory(&migration.target, &cancel)
                .unwrap()
                .files
                .is_empty()
        );
    }
}
