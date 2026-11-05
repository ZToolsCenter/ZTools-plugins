use super::Store;
use crate::domain::Result;
use crate::sources::github::canonical_repository;

const HISTORY_LIMIT: usize = 10;

impl Store {
    pub fn repository_history(&self) -> Result<Vec<String>> {
        Ok(self
            .conn
            .prepare("SELECT repository FROM repository_history ORDER BY position DESC LIMIT ?1")?
            .query_map([HISTORY_LIMIT], |row| row.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn remember_repository(&self, input: &str) -> Result<Vec<String>> {
        let repository = canonical_repository(input)?;
        // Moving a duplicate to the front and trimming must either both commit
        // or leave the previous history intact if a database write fails.
        let transaction = self.conn.unchecked_transaction()?;
        transaction.execute(
            "DELETE FROM repository_history WHERE repository=?1",
            [&repository],
        )?;
        transaction.execute(
            "INSERT INTO repository_history(repository) VALUES(?1)",
            [&repository],
        )?;
        transaction.execute(
            "DELETE FROM repository_history WHERE position NOT IN (SELECT position FROM repository_history ORDER BY position DESC LIMIT ?1)",
            [HISTORY_LIMIT],
        )?;
        transaction.commit()?;
        self.repository_history()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn recent_repositories_are_bounded_deduplicated_validated_and_persisted() {
        let temporary = tempfile::tempdir().unwrap();
        let data = temporary.path().join("app");
        let store = Store::open(&data).unwrap();
        assert!(store.repository_history().unwrap().is_empty());
        for number in 0..12 {
            store
                .remember_repository(&format!("owner/repo-{number}"))
                .unwrap();
        }
        let history = store.repository_history().unwrap();
        assert_eq!(history.len(), 10);
        assert_eq!(history.first().unwrap(), "https://github.com/owner/repo-11");
        assert_eq!(history.last().unwrap(), "https://github.com/owner/repo-2");
        let promoted = store
            .remember_repository("  https://github.com/OWNER/REPO-4.git/  ")
            .unwrap();
        assert_eq!(promoted.len(), 10);
        assert_eq!(promoted[0], "https://github.com/owner/repo-4");
        assert_eq!(promoted[1], history[0]);
        assert_eq!(
            promoted
                .iter()
                .filter(|value| value.ends_with("repo-4"))
                .count(),
            1
        );
        for invalid in [
            "",
            "https://user:secret@github.com/owner/repo",
            "https://github.com/owner/repo?token=secret",
            "https://example.com/owner/repo",
            "owner/repo/tree/main",
        ] {
            assert!(store.remember_repository(invalid).is_err());
            assert_eq!(store.repository_history().unwrap(), promoted);
        }
        drop(store);
        let reopened = Store::open(&data).unwrap();
        assert_eq!(reopened.repository_history().unwrap(), promoted);
    }

    #[test]
    fn history_table_is_added_to_existing_databases_without_changing_skills() {
        let temporary = tempfile::tempdir().unwrap();
        let data = temporary.path().join("app");
        let source = temporary.path().join("sample");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(
            source.join("SKILL.md"),
            "---\nname: sample\ndescription: history migration fixture\n---\nOriginal content\n",
        )
        .unwrap();
        let store = Store::open(&data).unwrap();
        let skill = store
            .import_local(&source, None, None, &AtomicBool::new(false))
            .unwrap();
        store
            .conn
            .execute_batch("DROP TABLE repository_history;")
            .unwrap();
        drop(store);
        let reopened = Store::open(&data).unwrap();
        assert!(reopened.repository_history().unwrap().is_empty());
        assert_eq!(reopened.list_skills().unwrap()[0].id, skill.id);
        reopened.remember_repository("owner/repo").unwrap();
    }

    #[test]
    fn failed_history_write_does_not_lose_the_previous_recent_entry() {
        let temporary = tempfile::tempdir().unwrap();
        let store = Store::open(&temporary.path().join("app")).unwrap();
        let original = store.remember_repository("owner/repo").unwrap();
        store.conn.execute_batch("CREATE TRIGGER fail_history_insert BEFORE INSERT ON repository_history BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;").unwrap();
        assert!(store.remember_repository("owner/repo").is_err());
        assert_eq!(store.repository_history().unwrap(), original);
    }
}
