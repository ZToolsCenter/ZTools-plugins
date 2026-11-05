//! Tauri-specific command adapters. The shared commands also serve the ZTools host.
use super::*;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

fn native_theme(mode: ThemeMode) -> Option<tauri::Theme> {
    match mode {
        ThemeMode::System => None,
        ThemeMode::Light => Some(tauri::Theme::Light),
        ThemeMode::Dark => Some(tauri::Theme::Dark),
    }
}

impl Runtime {
    pub fn apply_initial_preferences(&self, app: &AppHandle) {
        if let Ok(locked) = self.workspace.lock()
            && let Ok(workspace) = locked.as_ref()
            && let Ok(appearance) = workspace.store.appearance()
            && let Some(window) = app.get_webview_window("main")
        {
            let _ = window.set_theme(native_theme(appearance.mode));
            if let Ok(locale) = workspace.store.locale() {
                let _ = window.set_title(locale.window_title());
            }
        }
    }
}

macro_rules! command {
    ($name:ident($($arg:ident: $kind:ty),* $(,)?) -> $result:ty) => {
        #[tauri::command]
        pub async fn $name(state: State<'_, Arc<Runtime>>, $($arg: $kind),*) -> Result<$result> {
            super::$name(state.inner().clone(), $($arg),*).await
        }
    };
}

command!(get_snapshot() -> Snapshot);

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>> {
    super::list_system_fonts().await
}
command!(remove_library_skills(skill_ids: Vec<String>) -> ());
command!(remove_projects(project_ids: Vec<String>) -> ());
command!(set_project_display_name(project_id: String, display_name: String) -> Project);
command!(set_skill_display_name(skill_id: String, display_name: String) -> Skill);
command!(remember_repository(repository: String) -> Vec<String>);
command!(prepare_import(selection_id: String) -> PreparedImport);
command!(finish_import(import_id: String) -> Skill);
command!(discard_import(import_id: String) -> ());
command!(register_project(selection_id: String) -> Project);
command!(discover_projects(selection_id: String) -> Vec<DiscoveredProject>);
command!(scan_project(project_id: String) -> Vec<DetectedSkill>);
command!(get_document(revision_id: String) -> SkillDocument);
command!(get_revisions(skill_id: String) -> Vec<Revision>);
command!(
    preview_deployment(
        project_id: String,
        revision_id: String,
        agent: String,
        mode: String,
    ) -> deployments::Plan
);
command!(apply_deployment(plan_id: String) -> deployments::Deployment);
command!(remove_deployment(deployment_id: String) -> ());
command!(rollback_deployment(deployment_id: String) -> deployments::Deployment);
command!(resolve_github(repository: String, reference: String) -> CatalogView);
command!(resolve_git(repository: String, reference: String) -> CatalogView);
command!(get_git_version() -> String);
command!(
    prepare_github(
        catalog_id: String,
        skill_path: String,
        request_id: Option<String>,
    ) -> PreparedImport
);
command!(preview_library_migration(selection_id: String) -> LibraryMigrationPlan);
command!(discard_selections(selection_ids: Vec<String>) -> ());
command!(set_library_root(selection_id: String) -> LibraryMigrationResult);
command!(get_revision_diff(before_id: String, after_id: String) -> RevisionDiff);

#[tauri::command]
pub async fn set_locale(
    app: AppHandle,
    state: State<'_, Arc<Runtime>>,
    locale: Locale,
) -> Result<Locale> {
    let saved = super::set_locale(state.inner().clone(), locale).await?;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(saved.window_title());
    }
    Ok(saved)
}

#[tauri::command]
pub async fn set_appearance(
    app: AppHandle,
    state: State<'_, Arc<Runtime>>,
    appearance: Appearance,
) -> Result<Appearance> {
    let saved = super::set_appearance(state.inner().clone(), appearance).await?;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_theme(native_theme(saved.mode));
    }
    Ok(saved)
}

#[tauri::command]
pub async fn pick_directory(
    app: AppHandle,
    state: State<'_, Arc<Runtime>>,
    purpose: String,
) -> Result<Option<DirectorySelection>> {
    let titles = directory_titles(&purpose)?;
    work(state.inner().clone(), move |w, _| {
        let title = if w.store.locale()? == Locale::English {
            titles.1
        } else {
            titles.0
        };
        let Some(selected) = app.dialog().file().set_title(title).blocking_pick_folder() else {
            return Ok(None);
        };
        let path = selected
            .into_path()
            .map_err(|e| AppError::new("InvalidPath", e.to_string()))?;
        w.selections.clear();
        w.add_selection(path, &purpose).map(Some)
    })
    .await
}

#[tauri::command]
pub fn get_download_progress(
    state: State<'_, Arc<Runtime>>,
    request_id: String,
) -> Option<DownloadStatus> {
    super::get_download_progress(state.inner().clone(), request_id)
}

#[tauri::command]
pub fn cancel_operation(state: State<'_, Arc<Runtime>>) {
    super::cancel_operation(state.inner().clone());
}
