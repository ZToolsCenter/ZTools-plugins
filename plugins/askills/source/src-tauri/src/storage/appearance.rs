use super::Store;
use crate::domain::{AppError, Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Appearance {
    pub mode: ThemeMode,
    pub accent_color: String,
    pub font_family: String,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            mode: ThemeMode::System,
            accent_color: "#005fb8".into(),
            font_family: crate::platform::fonts::DEFAULT_FONT_FAMILY.into(),
        }
    }
}

impl Appearance {
    fn validate(mut self) -> Result<Self> {
        if !crate::platform::fonts::valid_family(&self.font_family) {
            return Err(AppError::new(
                "InvalidFontFamily",
                "字体名称不能为空、超过 128 个字符或包含控制字符",
            ));
        }
        self.font_family = self.font_family.trim().into();
        if self.accent_color.len() != 7
            || !self.accent_color.starts_with('#')
            || !self.accent_color[1..]
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(AppError::new(
                "InvalidAccentColor",
                "主题色须为 #RRGGBB 格式的六位十六进制颜色",
            ));
        }
        self.accent_color.make_ascii_lowercase();
        Ok(self)
    }
}

impl Store {
    pub fn appearance(&self) -> Result<Appearance> {
        let json: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM app_preferences WHERE key='appearance'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        // Appearance is optional metadata: invalid old/manual data should not
        // prevent access to the skill library. A subsequent save replaces it.
        Ok(json
            .and_then(|value| serde_json::from_str::<Appearance>(&value).ok())
            .and_then(|value| value.validate().ok())
            .unwrap_or_default())
    }

    pub fn set_appearance(&self, appearance: Appearance) -> Result<Appearance> {
        let validated = appearance.validate()?;
        self.conn.execute("INSERT INTO app_preferences(key,value) VALUES('appearance',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(&validated)?])?;
        Ok(validated)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_preferences_add_default_font_without_resetting_theme() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(&root.path().join("app")).unwrap();
        store
            .conn
            .execute(
                "INSERT INTO app_preferences(key,value) VALUES('appearance',?1)",
                [r##"{"mode":"dark","accentColor":"#fd81ac"}"##],
            )
            .unwrap();
        let saved = store.appearance().unwrap();
        assert_eq!(saved.mode, ThemeMode::Dark);
        assert_eq!(saved.accent_color, "#fd81ac");
        assert_eq!(saved.font_family, "Microsoft YaHei");
    }

    #[test]
    fn invalid_font_names_do_not_overwrite_saved_preferences() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(&root.path().join("app")).unwrap();
        let saved = store
            .set_appearance(Appearance {
                font_family: "  宋体  ".into(),
                ..Appearance::default()
            })
            .unwrap();
        assert_eq!(saved.font_family, "宋体");
        for font in [
            "".into(),
            " ".into(),
            "Arial\n".into(),
            "A\0B".into(),
            "a".repeat(129),
        ] {
            let error = store
                .set_appearance(Appearance {
                    font_family: font,
                    ..saved.clone()
                })
                .unwrap_err();
            assert_eq!(error.code, "InvalidFontFamily");
            assert_eq!(store.appearance().unwrap(), saved);
        }
    }

    #[test]
    fn defaults_and_custom_appearance_survive_reopen_without_affecting_history() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("app");
        let store = Store::open(&data).unwrap();
        assert_eq!(store.appearance().unwrap(), Appearance::default());
        store.remember_repository("owner/repo").unwrap();
        let expected = Appearance {
            mode: ThemeMode::Dark,
            accent_color: "#aabbcc".into(),
            font_family: "SimSun".into(),
        };
        assert_eq!(
            store
                .set_appearance(Appearance {
                    accent_color: "#AABBCC".into(),
                    ..expected.clone()
                })
                .unwrap(),
            expected
        );
        drop(store);
        let reopened = Store::open(&data).unwrap();
        assert_eq!(reopened.appearance().unwrap(), expected);
        assert_eq!(
            reopened.repository_history().unwrap(),
            vec!["https://github.com/owner/repo"]
        );
        reopened.set_appearance(Appearance::default()).unwrap();
        assert_eq!(reopened.appearance().unwrap(), Appearance::default());
    }

    #[test]
    fn invalid_colors_and_modes_are_rejected_without_losing_preferences() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(&root.path().join("app")).unwrap();
        let saved = store
            .set_appearance(Appearance {
                mode: ThemeMode::Light,
                accent_color: "#123456".into(),
                ..Appearance::default()
            })
            .unwrap();
        for color in [
            "red",
            "#fff",
            "#ffffff00",
            "#ggffff",
            "#12;345",
            "#12345\n",
            "#中文字体",
        ] {
            assert!(
                store
                    .set_appearance(Appearance {
                        accent_color: color.into(),
                        ..saved.clone()
                    })
                    .is_err()
            );
            assert_eq!(store.appearance().unwrap(), saved);
        }
        assert!(
            serde_json::from_str::<Appearance>(r##"{"mode":"unknown","accentColor":"#123456"}"##)
                .is_err()
        );
    }

    #[test]
    fn optional_preferences_recover_from_invalid_data_and_old_databases() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("app");
        let store = Store::open(&data).unwrap();
        for value in [
            "{broken",
            r##"{"mode":"dark","accentColor":"url(invalid)"}"##,
            r##"{"mode":"unknown"}"##,
        ] {
            store
                .conn
                .execute(
                    "INSERT OR REPLACE INTO app_preferences(key,value) VALUES('appearance',?1)",
                    [value],
                )
                .unwrap();
            assert_eq!(store.appearance().unwrap(), Appearance::default());
        }
        store
            .conn
            .execute_batch("DROP TABLE app_preferences")
            .unwrap();
        drop(store);
        let reopened = Store::open(&data).unwrap();
        assert_eq!(reopened.appearance().unwrap(), Appearance::default());
        reopened
            .set_appearance(Appearance {
                mode: ThemeMode::Dark,
                ..Appearance::default()
            })
            .unwrap();
    }
}
