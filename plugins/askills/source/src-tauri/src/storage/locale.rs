use super::Store;
use crate::domain::Result;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Locale {
    #[default]
    #[serde(rename = "zh-CN")]
    Chinese,
    #[serde(rename = "en")]
    English,
}

impl Locale {
    pub fn window_title(self) -> &'static str {
        match self {
            Self::Chinese => "Askills · skills 管理",
            Self::English => "Askills · Skill Manager",
        }
    }
}

impl Store {
    pub fn locale(&self) -> Result<Locale> {
        let value: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM app_preferences WHERE key='locale'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default())
    }

    pub fn set_locale(&self, locale: Locale) -> Result<Locale> {
        self.conn.execute("INSERT INTO app_preferences(key,value) VALUES('locale',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(&locale)?])?;
        Ok(locale)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{Appearance, ThemeMode};

    #[test]
    fn language_survives_reopen_and_preserves_appearance_and_history() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("app");
        let store = Store::open(&path).unwrap();
        assert_eq!(store.locale().unwrap(), Locale::Chinese);
        let appearance = Appearance {
            mode: ThemeMode::Dark,
            accent_color: "#123456".into(),
            ..Appearance::default()
        };
        store.set_appearance(appearance.clone()).unwrap();
        store.remember_repository("owner/repo").unwrap();
        store.set_locale(Locale::English).unwrap();
        drop(store);
        let reopened = Store::open(&path).unwrap();
        assert_eq!(reopened.locale().unwrap(), Locale::English);
        assert_eq!(reopened.appearance().unwrap(), appearance);
        assert_eq!(
            reopened.repository_history().unwrap(),
            vec!["https://github.com/owner/repo"]
        );
        reopened.set_locale(Locale::Chinese).unwrap();
        assert_eq!(reopened.locale().unwrap(), Locale::Chinese);
    }

    #[test]
    fn unknown_languages_are_rejected_and_invalid_optional_data_falls_back() {
        assert!(serde_json::from_str::<Locale>("\"fr\"").is_err());
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(&root.path().join("app")).unwrap();
        for value in ["broken", "\"unknown\"", "null"] {
            store
                .conn
                .execute(
                    "INSERT OR REPLACE INTO app_preferences(key,value) VALUES('locale',?1)",
                    [value],
                )
                .unwrap();
            assert_eq!(store.locale().unwrap(), Locale::Chinese);
        }
    }
}
