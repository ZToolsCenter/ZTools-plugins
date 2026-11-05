pub mod adapters;
mod commands;
pub use commands::stdio::run as run_ztools_helper;
pub mod domain;
pub mod platform;
pub mod services;
pub mod sources;
pub mod storage;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    version: &'static str,
}

// Retain the read-only bootstrap API while desktop features are connected.
#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Askills",
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[tauri::command]
fn open_repository(app: tauri::AppHandle) -> domain::Result<()> {
    app.opener()
        .open_url(env!("CARGO_PKG_REPOSITORY"), None::<&str>)
        .map_err(|error| domain::AppError::new("OpenRepositoryFailed", error.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            let runtime = commands::initialize_runtime(app.handle())?;
            runtime.apply_initial_preferences(app.handle());
            app.manage(runtime);
            // Always start at the configured logical size. Apply this before
            // showing the window so an old maximized/restore rectangle cannot
            // briefly appear or influence the next launch.
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    window.set_icon(icon.clone())?;
                }
                #[cfg(windows)]
                platform::window::set_taskbar_icon(&window)?;
                let config = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|window| window.label == "main")
                    .ok_or("main window configuration is missing")?;
                window.set_fullscreen(false)?;
                window.unmaximize()?;
                window.set_size(tauri::LogicalSize::new(config.width, config.height))?;
                window.center()?;
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            open_repository,
            commands::desktop::get_snapshot,
            commands::desktop::set_locale,
            commands::desktop::set_appearance,
            commands::desktop::list_system_fonts,
            commands::desktop::remember_repository,
            commands::desktop::set_skill_display_name,
            commands::desktop::set_project_display_name,
            commands::desktop::remove_library_skills,
            commands::desktop::remove_projects,
            commands::desktop::pick_directory,
            commands::desktop::prepare_import,
            commands::desktop::finish_import,
            commands::desktop::discard_import,
            commands::desktop::register_project,
            commands::desktop::discover_projects,
            commands::desktop::scan_project,
            commands::desktop::get_document,
            commands::desktop::get_revisions,
            commands::desktop::preview_deployment,
            commands::desktop::apply_deployment,
            commands::desktop::remove_deployment,
            commands::desktop::rollback_deployment,
            commands::desktop::resolve_github,
            commands::desktop::resolve_git,
            commands::desktop::get_git_version,
            commands::desktop::prepare_github,
            commands::desktop::get_download_progress,
            commands::desktop::set_library_root,
            commands::desktop::preview_library_migration,
            commands::desktop::discard_selections,
            commands::desktop::cancel_operation,
            commands::desktop::get_revision_diff,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Askills");
}
