use super::*;
use crate::services::deployments;

#[test]
fn fresh_install_uses_the_new_default_library_without_creating_legacy_data() {
    let temporary = tempfile::tempdir().unwrap();
    let legacy = temporary.path().join("io.github.candquarzy.askills");
    let destination = temporary.path().join("asklils");
    inherit_legacy_data(&destination, &legacy).unwrap();
    let store = Store::open(&destination).unwrap();
    assert_eq!(
        store.library_root,
        canonical_directory(&destination.join("library")).unwrap()
    );
    assert!(!legacy.exists());
}

#[test]
fn upgrade_preserves_wal_preferences_skills_projects_and_live_deployments() {
    for custom_library in [false, true] {
        let temporary = tempfile::tempdir().unwrap();
        let legacy = temporary.path().join("old-identifier");
        let destination = temporary.path().join("asklils");
        let mut old = Store::open(&legacy).unwrap();
        if custom_library {
            old.set_library_root(&temporary.path().join("custom-skills"))
                .unwrap();
        }
        let library = old.library_root.clone();
        deployments::initialize(&old).unwrap();
        let source = super::super::tests::fixture(temporary.path());
        let cancel = AtomicBool::new(false);
        let skill = old.import_local(&source, None, None, &cancel).unwrap();
        old.set_display_name(&skill.id, "My skill").unwrap();
        let project_path = temporary.path().join("project");
        fs::create_dir(&project_path).unwrap();
        let project = old.add_project(&project_path).unwrap();
        let plan = deployments::plan(
            &old,
            &project.id,
            &skill.latest_revision_id,
            "codex",
            "auto",
        )
        .unwrap();
        let deployment = deployments::apply(&mut old, &plan.id, &cancel).unwrap();
        let appearance = Appearance {
            mode: ThemeMode::Dark,
            accent_color: "#123456".into(),
            font_family: "SimSun".into(),
        };
        old.set_appearance(appearance.clone()).unwrap();
        old.set_locale(Locale::English).unwrap();
        old.remember_repository("owner/repo").unwrap();
        // Keep a connection open so the source WAL cannot disappear merely
        // because Store is dropped. The snapshot must include its committed data.
        let wal_connection = Connection::open(legacy.join("askills.db")).unwrap();
        wal_connection
            .execute_batch("PRAGMA journal_mode=WAL;")
            .unwrap();
        drop(old);
        assert!(legacy.join("askills.db-wal").exists());
        inherit_legacy_data(&destination, &legacy).unwrap();
        drop(wal_connection);
        let new = Store::open(&destination).unwrap();
        deployments::initialize(&new).unwrap();
        assert_eq!(new.library_root, library);
        assert_eq!(new.appearance().unwrap(), appearance);
        assert_eq!(new.locale().unwrap(), Locale::English);
        assert_eq!(
            new.repository_history().unwrap(),
            vec!["https://github.com/owner/repo"]
        );
        assert_eq!(
            new.list_skills().unwrap()[0].display_name.as_deref(),
            Some("My skill")
        );
        assert_eq!(new.list_projects().unwrap()[0].id, project.id);
        assert!(
            new.read_revision(&skill.latest_revision_id)
                .unwrap()
                .markdown
                .contains("original")
        );
        assert_eq!(deployments::list(&new).unwrap()[0].id, deployment.id);
        assert!(
            Path::new(&deployment.target_path)
                .join("SKILL.md")
                .is_file()
        );
        // Repeated startup never recopies stale preferences from the old index.
        new.set_locale(Locale::Chinese).unwrap();
        drop(new);
        inherit_legacy_data(&destination, &legacy).unwrap();
        let mut reopened = Store::open(&destination).unwrap();
        assert_eq!(reopened.locale().unwrap(), Locale::Chinese);
        // Upgraded users can opt in to moving their preserved library into the
        // new default location through the normal migration command.
        let new_default = reopened.data_dir.join("library");
        reopened.migrate_library(&new_default, &cancel).unwrap();
        assert_eq!(
            reopened.library_root,
            canonical_directory(&new_default).unwrap()
        );
        assert!(
            Path::new(&deployment.target_path)
                .join("SKILL.md")
                .is_file()
        );
        deployments::uninstall(&mut reopened, &deployment.id, &cancel).unwrap();
        assert!(library.join("library.json").is_file());
        assert!(legacy.join("askills.db").is_file());
    }
}

#[test]
fn an_existing_new_index_wins_even_while_the_legacy_version_is_running() {
    let temporary = tempfile::tempdir().unwrap();
    let legacy = temporary.path().join("old");
    let destination = temporary.path().join("asklils");
    let old = Store::open(&legacy).unwrap();
    old.set_locale(Locale::English).unwrap();
    let new = Store::open(&destination).unwrap();
    new.set_locale(Locale::Chinese).unwrap();
    drop(new);
    inherit_legacy_data(&destination, &legacy).unwrap();
    assert_eq!(
        Store::open(&destination).unwrap().locale().unwrap(),
        Locale::Chinese
    );
}

#[test]
fn a_running_old_instance_does_not_publish_partial_new_data() {
    let temporary = tempfile::tempdir().unwrap();
    let legacy = temporary.path().join("old");
    let destination = temporary.path().join("asklils");
    let old = Store::open(&legacy).unwrap();
    assert_eq!(
        inherit_legacy_data(&destination, &legacy).unwrap_err().code,
        "LibraryBusy"
    );
    assert!(!destination.exists());
    drop(old);
    inherit_legacy_data(&destination, &legacy).unwrap();
    assert!(destination.join("askills.db").is_file());
}

#[test]
fn foreign_destination_and_corrupt_legacy_data_are_preserved() {
    let temporary = tempfile::tempdir().unwrap();
    let legacy = temporary.path().join("old");
    let destination = temporary.path().join("asklils");
    drop(Store::open(&legacy).unwrap());
    fs::create_dir(&destination).unwrap();
    fs::write(destination.join("keep.txt"), "foreign").unwrap();
    assert_eq!(
        inherit_legacy_data(&destination, &legacy).unwrap_err().code,
        "DataDirectoryConflict"
    );
    assert_eq!(
        fs::read_to_string(destination.join("keep.txt")).unwrap(),
        "foreign"
    );
    assert!(!destination.join("askills.db").exists());
    fs::remove_file(destination.join("keep.txt")).unwrap();
    fs::write(legacy.join("askills.db"), b"corrupt database").unwrap();
    assert!(inherit_legacy_data(&destination, &legacy).is_err());
    assert_eq!(
        fs::read(legacy.join("askills.db")).unwrap(),
        b"corrupt database"
    );
    assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
}

#[test]
#[cfg(windows)]
fn linked_destination_is_rejected_without_touching_its_target() {
    let temporary = tempfile::tempdir().unwrap();
    let legacy = temporary.path().join("old");
    let destination = temporary.path().join("asklils");
    let unrelated = temporary.path().join("unrelated");
    drop(Store::open(&legacy).unwrap());
    fs::create_dir(&unrelated).unwrap();
    fs::write(unrelated.join("keep.txt"), "untouched").unwrap();
    junction::create(&unrelated, &destination).unwrap();
    assert_eq!(
        inherit_legacy_data(&destination, &legacy).unwrap_err().code,
        "UnsafeLink"
    );
    assert_eq!(
        fs::read_to_string(unrelated.join("keep.txt")).unwrap(),
        "untouched"
    );
    junction::delete(&destination).unwrap();
}
