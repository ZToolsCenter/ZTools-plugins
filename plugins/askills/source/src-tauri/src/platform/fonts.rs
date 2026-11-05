//! Enumerate installed font family names, without exposing font files or paths.
use crate::domain::{AppError, Result};

pub const DEFAULT_FONT_FAMILY: &str = "Microsoft YaHei";

pub fn valid_family(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 128 && !name.chars().any(char::is_control)
}

#[cfg(windows)]
pub fn list_system_fonts() -> Result<Vec<String>> {
    use std::collections::BTreeMap;
    use windows_sys::Win32::Graphics::Gdi::{
        DEFAULT_CHARSET, EnumFontFamiliesExW, GetDC, LOGFONTW, ReleaseDC, TEXTMETRICW,
    };

    unsafe extern "system" fn collect(
        font: *const LOGFONTW,
        _: *const TEXTMETRICW,
        _: u32,
        context: isize,
    ) -> i32 {
        // SAFETY: GDI calls synchronously with a valid LOGFONTW. context points
        // to the exclusively borrowed map that lives until enumeration returns.
        let (face, names) = unsafe {
            (
                &(*font).lfFaceName,
                &mut *(context as *mut BTreeMap<String, String>),
            )
        };
        let end = face
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(face.len());
        if let Ok(name) = String::from_utf16(&face[..end]) {
            let name = name.trim();
            // @ names are vertical aliases, unsuitable for the horizontal UI.
            if valid_family(name) && !name.starts_with('@') {
                let name = if name == "微软雅黑" || name.eq_ignore_ascii_case(DEFAULT_FONT_FAMILY)
                {
                    DEFAULT_FONT_FAMILY
                } else {
                    name
                };
                names
                    .entry(name.to_lowercase())
                    .or_insert_with(|| name.into());
            }
        }
        1
    }

    let mut names = BTreeMap::<String, String>::new();
    let query = LOGFONTW {
        lfCharSet: DEFAULT_CHARSET,
        ..Default::default()
    };
    // SAFETY: a null window requests the screen DC. All pointers are valid for
    // this synchronous call; release the DC on the same thread immediately.
    unsafe {
        let dc = GetDC(std::ptr::null_mut());
        if dc.is_null() {
            return Err(AppError::new(
                "FontEnumerationFailed",
                "无法读取本机字体，请重试",
            ));
        }
        EnumFontFamiliesExW(dc, &query, Some(collect), &mut names as *mut _ as isize, 0);
        ReleaseDC(std::ptr::null_mut(), dc);
    }
    if names.is_empty() {
        return Err(AppError::new(
            "FontEnumerationFailed",
            "无法读取本机字体，请重试",
        ));
    }
    Ok(names.into_values().collect())
}

#[cfg(not(windows))]
pub fn list_system_fonts() -> Result<Vec<String>> {
    Err(AppError::new(
        "FontEnumerationUnsupported",
        "当前系统暂不支持读取本机字体",
    ))
}
