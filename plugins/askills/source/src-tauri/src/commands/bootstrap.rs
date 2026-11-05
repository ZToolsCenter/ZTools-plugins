use super::*;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
const DATA_DIRECTORY_NAME: &str = "asklils";

fn resolve_directory(
    local: &std::path::Path,
    legacy: PathBuf,
    isolated: Option<PathBuf>,
) -> PathBuf {
    if let Some(isolated) = isolated {
        return isolated;
    }
    #[cfg(windows)]
    {
        let _ = legacy;
        local.join(DATA_DIRECTORY_NAME)
    }
    #[cfg(not(windows))]
    {
        let _ = local;
        legacy
    }
}

pub fn initialize_runtime(app: &AppHandle) -> Result<Arc<Runtime>> {
    let legacy = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::new("DataDirectory", e.to_string()))?;
    let local = app
        .path()
        .local_data_dir()
        .map_err(|e| AppError::new("DataDirectory", e.to_string()))?;
    // Development/native tests never inherit the real user's legacy data.
    #[cfg(debug_assertions)]
    let isolated = std::env::var_os("ASKILLS_TEST_DATA_DIR").map(PathBuf::from);
    #[cfg(not(debug_assertions))]
    let isolated = None;
    let testing = isolated.is_some();
    let data = resolve_directory(&local, legacy.clone(), isolated);
    if testing {
        return Ok(Runtime::new(data));
    }
    let workspace =
        crate::storage::inherit_legacy_data(&data, &legacy).and_then(|()| Workspace::open(data));
    Ok(Runtime::from_workspace(workspace))
}

pub(super) fn initialize_helper(isolated: Option<PathBuf>) -> Result<Arc<Runtime>> {
    if let Some(data) = isolated {
        if !data.is_absolute() {
            return Err(AppError::new("InvalidPath", "测试数据目录必须为绝对路径"));
        }
        return Ok(Runtime::new(data));
    }
    #[cfg(windows)]
    {
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| AppError::new("DataDirectory", "无法确定本地应用数据目录"))?;
        let legacy = local.join("io.github.candquarzy.askills");
        let data = resolve_directory(&local, legacy.clone(), None);
        let workspace = crate::storage::inherit_legacy_data(&data, &legacy)
            .and_then(|()| Workspace::open(data));
        Ok(Runtime::from_workspace(workspace))
    }
    #[cfg(not(windows))]
    {
        Err(AppError::new(
            "UnsupportedPlatform",
            "当前 ZTools 插件仅支持 Windows，请使用 --data-dir 运行跨平台测试",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolated_data_takes_precedence_without_using_the_personal_directory() {
        let root = PathBuf::from("local");
        let isolated = PathBuf::from("isolated-test-data");
        assert_eq!(
            resolve_directory(&root, root.join("old-identifier"), Some(isolated.clone())),
            isolated
        );
    }

    #[test]
    #[cfg(windows)]
    fn windows_uses_the_requested_short_directory_name() {
        let root = PathBuf::from(r"C:\Users\example\AppData\Local");
        assert_eq!(
            resolve_directory(&root, root.join("io.github.candquarzy.askills"), None),
            root.join("asklils")
        );
    }
}
