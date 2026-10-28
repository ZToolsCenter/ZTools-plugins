//! Removal is logical: snapshots and deployment identities remain valid. A single
//! atomic library-side tombstone file also survives rebuilding the SQLite index.
use super::*;
use std::collections::BTreeSet;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemovedSkills {
    schema_version: u32,
    skill_ids: BTreeSet<String>,
}

fn validate_batch(ids: &[String]) -> Result<()> {
    if ids.is_empty() || ids.len() > 10_000 {
        return Err(AppError::new("InvalidSelection", "请选择 1–10,000 个条目"));
    }
    for id in ids {
        validate_uuid(id)?;
    }
    Ok(())
}

impl Store {
    pub(super) fn removed_skills(&self) -> Result<BTreeSet<String>> {
        self.verify_library()?;
        let path = self.library_root.join("removed-skills.json");
        assert_safe_path(&path)?;
        if !path.exists() {
            return Ok(BTreeSet::new());
        }
        let removed: RemovedSkills = serde_json::from_str(&read_text(&path)?)?;
        if removed.schema_version != 1 {
            return Err(AppError::new("UnsupportedVersion", "删除记录版本不受支持"));
        }
        for id in &removed.skill_ids {
            validate_uuid(id)?;
        }
        Ok(removed.skill_ids)
    }

    fn save_removed_skills(&self, skill_ids: BTreeSet<String>) -> Result<()> {
        self.verify_library()?;
        atomic_write(
            &self.library_root.join("removed-skills.json"),
            &serde_json::to_vec_pretty(&RemovedSkills {
                schema_version: 1,
                skill_ids,
            })?,
        )
    }

    pub(super) fn restore_skill(&self, id: &str) -> Result<()> {
        let mut removed = self.removed_skills()?;
        if removed.remove(id) {
            self.save_removed_skills(removed)?;
        }
        Ok(())
    }

    pub fn remove_library_skills(&self, ids: &[String], cancel: &AtomicBool) -> Result<()> {
        validate_batch(ids)?;
        let mut removed = self.removed_skills()?;
        for id in ids {
            check_cancel(cancel)?;
            self.skill(id)?;
            removed.insert(id.clone());
        }
        check_cancel(cancel)?;
        self.save_removed_skills(removed)
    }

    pub fn remove_projects(&self, ids: &[String], cancel: &AtomicBool) -> Result<()> {
        validate_batch(ids)?;
        let transaction = self.conn.unchecked_transaction()?;
        for id in ids {
            check_cancel(cancel)?;
            self.project(id)?;
            transaction.execute(
                "INSERT OR IGNORE INTO removed_projects(id) VALUES(?1)",
                [id],
            )?;
        }
        check_cancel(cancel)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn set_project_display_name(&self, id: &str, name: &str) -> Result<Project> {
        let name = name.trim();
        if name.chars().count() > 80 || name.chars().any(char::is_control) {
            return Err(AppError::new(
                "InvalidDisplayName",
                "备注名称最多 80 个字符，且不能包含换行或控制字符",
            ));
        }
        let mut project = self.project(id)?;
        project.display_name = (!name.is_empty()).then(|| name.to_owned());
        self.conn.execute(
            "UPDATE projects SET json=?2 WHERE id=?1",
            params![id, serde_json::to_string(&project)?],
        )?;
        Ok(project)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_removal_is_atomic_and_survives_index_recovery_then_reimport_restores_it() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        let store = Store::open(&data).unwrap();
        let input = super::super::tests::fixture(root.path());
        let cancel = AtomicBool::new(false);
        let skill = store.import_local(&input, None, None, &cancel).unwrap();
        for ids in [
            vec![],
            vec![skill.id.clone(), "../bad".into()],
            vec![skill.id.clone(), Uuid::new_v4().to_string()],
        ] {
            assert!(store.remove_library_skills(&ids, &cancel).is_err());
            assert_eq!(store.list_skills().unwrap().len(), 1);
        }
        assert!(
            store
                .remove_library_skills(std::slice::from_ref(&skill.id), &AtomicBool::new(true))
                .is_err()
        );
        store
            .remove_library_skills(&[skill.id.clone(), skill.id.clone()], &cancel)
            .unwrap();
        assert!(store.list_skills().unwrap().is_empty());
        assert!(store.read_revision(&skill.latest_revision_id).is_ok());
        store.conn.execute("DELETE FROM revisions", []).unwrap();
        store.conn.execute("DELETE FROM skills", []).unwrap();
        drop(store);
        let store = Store::open(&data).unwrap();
        assert!(store.list_skills().unwrap().is_empty());
        let restored = store.import_local(&input, None, None, &cancel).unwrap();
        assert_eq!(restored.id, skill.id);
        assert_eq!(restored.latest_revision_id, skill.latest_revision_id);
        assert_eq!(store.list_skills().unwrap().len(), 1);
    }

    #[test]
    fn project_names_and_atomic_removal_preserve_paths_and_restore_identity() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        let store = Store::open(&data).unwrap();
        let path = root.path().join("workspace");
        fs::create_dir(&path).unwrap();
        fs::write(path.join("keep.txt"), "original").unwrap();
        let project = store.add_project(&path).unwrap();
        let renamed = store
            .set_project_display_name(&project.id, "  中文备注  ")
            .unwrap();
        assert_eq!(renamed.display_name.as_deref(), Some("中文备注"));
        assert_eq!(renamed.name, project.name);
        assert_eq!(renamed.path, project.path);
        for name in ["x\ny".to_owned(), "x".repeat(81)] {
            assert!(store.set_project_display_name(&project.id, &name).is_err());
        }
        let cancel = AtomicBool::new(false);
        assert!(
            store
                .remove_projects(&[project.id.clone(), Uuid::new_v4().to_string()], &cancel)
                .is_err()
        );
        assert!(
            store
                .remove_projects(std::slice::from_ref(&project.id), &AtomicBool::new(true))
                .is_err()
        );
        assert_eq!(store.list_projects().unwrap().len(), 1);
        store
            .remove_projects(std::slice::from_ref(&project.id), &cancel)
            .unwrap();
        drop(store);
        let store = Store::open(&data).unwrap();
        assert!(store.list_projects().unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(path.join("keep.txt")).unwrap(),
            "original"
        );
        let restored = store.add_project(&path).unwrap();
        assert_eq!(restored.id, project.id);
        assert_eq!(restored.display_name.as_deref(), Some("中文备注"));
        assert!(
            store
                .set_project_display_name(&project.id, " ")
                .unwrap()
                .display_name
                .is_none()
        );
        let legacy: Project = serde_json::from_value(
            serde_json::json!({"id":project.id,"name":project.name,"path":project.path}),
        )
        .unwrap();
        assert!(legacy.display_name.is_none());
    }
}
