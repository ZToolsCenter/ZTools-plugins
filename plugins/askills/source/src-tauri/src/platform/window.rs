use std::{io, ptr};
use windows_sys::Win32::{
    System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::{
        ICON_BIG, IMAGE_ICON, LR_DEFAULTSIZE, LR_SHARED, LoadImageW, SendMessageW, WM_SETICON,
    },
};

/// Tauri's set_icon sets ICON_SMALL; Windows uses ICON_BIG for the taskbar.
pub fn set_taskbar_icon(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0;
    // SAFETY: called during setup on the UI thread with a live main window.
    // A null module name selects this executable; the resource ID is generated
    // by tauri-build. LR_SHARED lets Windows own the icon for the process lifetime,
    // so the handle remains valid while the taskbar uses it and must not be freed.
    unsafe {
        let module = GetModuleHandleW(ptr::null());
        if module.is_null() {
            return Err(io::Error::last_os_error().into());
        }
        let icon = LoadImageW(
            module,
            tauri::utils::platform::WINDOWS_APP_ICON_RESOURCE_ID as usize as *const u16,
            IMAGE_ICON,
            0,
            0,
            LR_DEFAULTSIZE | LR_SHARED,
        );
        if icon.is_null() {
            return Err(io::Error::last_os_error().into());
        }
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, icon as isize);
    }
    Ok(())
}
