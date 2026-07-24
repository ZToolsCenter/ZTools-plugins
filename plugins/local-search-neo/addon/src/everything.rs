use std::sync::LazyLock;

use everything_ipc::IpcWindow;
use everything_ipc::wm::{EverythingClient, QueryList, RequestFlags, SearchFlags, Sort};
use neon::prelude::*;

use crate::js_args::{
    optional_bool_arg, optional_string_arg, optional_u32_arg, required_string_arg,
};

use windows::Win32::{
    Foundation::{LPARAM, WPARAM},
    UI::WindowsAndMessaging::{SendMessageW, WM_USER},
};

const EVERYTHING_IPC_EXIT: usize = 4;

static EVERYTHING: LazyLock<Result<EverythingClient, String>> =
    LazyLock::new(|| EverythingClient::new().map_err(|error| error.to_string()));

trait EverythingClientExt {
    fn exit(&self) -> bool;
}

impl EverythingClientExt for EverythingClient {
    fn exit(&self) -> bool {
        unsafe {
            SendMessageW(
                self.hwnd(),
                WM_USER,
                Some(WPARAM(EVERYTHING_IPC_EXIT as usize)),
                Some(LPARAM(0)),
            )
            .0 != 0
        }
    }
}

fn with_everything<T>(f: impl FnOnce(&EverythingClient) -> Result<T, String>) -> Result<T, String> {
    match &*EVERYTHING {
        Ok(client) => f(client),
        Err(error) => Err(error.clone()),
    }
}

fn is_running(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let running = IpcWindow::new()
        .map(|window| window.is_ipc_available())
        .unwrap_or(false);

    Ok(cx.boolean(running))
}

fn is_db_loaded(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let loaded = IpcWindow::new()
        .map(|window| window.is_db_loaded())
        .unwrap_or(false);

    Ok(cx.boolean(loaded))
}

fn exit(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let exited = with_everything(|client| Ok(client.exit())).unwrap_or(false);

    Ok(cx.boolean(exited))
}

fn get_version(mut cx: FunctionContext) -> JsResult<JsObject> {
    let Some(window) = IpcWindow::new() else {
        return cx.throw_error("Everything is not running");
    };

    let version = window.get_version();
    let object = cx.empty_object();

    let major = cx.number(version.major);
    object.set(&mut cx, "major", major)?;

    let minor = cx.number(version.minor);
    object.set(&mut cx, "minor", minor)?;

    let revision = cx.number(version.revision);
    object.set(&mut cx, "revision", revision)?;

    let build = cx.number(version.build);
    object.set(&mut cx, "build", build)?;

    let text = cx.string(format!(
        "{}.{}.{}.{}",
        version.major, version.minor, version.revision, version.build
    ));
    object.set(&mut cx, "text", text)?;

    Ok(object)
}

fn sort_from_mode(mode: &str) -> Sort {
    match mode {
        "name-asc" => Sort::NameAscending,
        "name-desc" => Sort::NameDescending,
        "path-asc" => Sort::PathAscending,
        "path-desc" => Sort::PathDescending,
        "size-asc" => Sort::SizeAscending,
        "size-desc" => Sort::SizeDescending,
        "modified-asc" => Sort::DateModifiedAscending,
        "modified-desc" => Sort::DateModifiedDescending,
        _ => Sort::DateModifiedDescending,
    }
}

fn filetime_to_unix_ms(low_date_time: u32, high_date_time: u32) -> f64 {
    const WINDOWS_TO_UNIX_EPOCH_TICKS: u64 = 116_444_736_000_000_000;
    const TICKS_PER_MILLISECOND: u64 = 10_000;

    let ticks = ((high_date_time as u64) << 32) | low_date_time as u64;
    if ticks < WINDOWS_TO_UNIX_EPOCH_TICKS {
        return 0.0;
    }

    ((ticks - WINDOWS_TO_UNIX_EPOCH_TICKS) / TICKS_PER_MILLISECOND) as f64
}

fn query_flags(
    search: &str,
    max_results: u32,
    sort: Sort,
    request_flags: RequestFlags,
    search_flags: SearchFlags,
) -> Result<QueryList, String> {
    with_everything(|client| {
        client
            .query_wait(search)
            .request_flags(request_flags)
            .search_flags(search_flags)
            .sort(sort)
            .max_results(max_results)
            .call()
            .map_err(|error| error.to_string())
    })
}

fn default_request_flags() -> RequestFlags {
    RequestFlags::FileName
        | RequestFlags::Path
        | RequestFlags::FullPathAndFileName
        | RequestFlags::Extension
        | RequestFlags::Size
        | RequestFlags::DateModified
        | RequestFlags::HighlightedFileName
        | RequestFlags::HighlightedPath
}

fn query(mut cx: FunctionContext) -> JsResult<JsObject> {
    let search = required_string_arg(&mut cx, 0, "search")?;
    let max_results = optional_u32_arg(&mut cx, 1, "maxResults", 100)?;
    let sort_mode = optional_string_arg(&mut cx, 2, "sortMode", "modified-desc")?;
    let match_path = optional_bool_arg(&mut cx, 3, "matchPath", false)?;
    let sort = sort_from_mode(&sort_mode);
    let search_flags = if match_path {
        SearchFlags::MatchPath
    } else {
        SearchFlags::empty()
    };

    let list = query_flags(
        &search,
        max_results,
        sort,
        default_request_flags(),
        search_flags,
    )
    .or_else(|error| cx.throw_error(error))?;

    let result = cx.empty_object();

    let total = cx.number(list.total_len() as f64);
    result.set(&mut cx, "total", total)?;

    let items = JsArray::new(&mut cx, list.len());

    for (index, item) in list.iter().enumerate() {
        let object = cx.empty_object();

        if let Some(name) = item.get_string(RequestFlags::FileName) {
            let value = cx.string(name);
            object.set(&mut cx, "name", value)?;
        }

        if let Some(path) = item.get_string(RequestFlags::Path) {
            let value = cx.string(path);
            object.set(&mut cx, "path", value)?;
        }

        if let Some(highlighted_name) = item.get_string(RequestFlags::HighlightedFileName) {
            let value = cx.string(highlighted_name);
            object.set(&mut cx, "highlightedName", value)?;
        }

        if let Some(highlighted_path) = item.get_string(RequestFlags::HighlightedPath) {
            let value = cx.string(highlighted_path);
            object.set(&mut cx, "highlightedPath", value)?;
        }

        let full_path = item.get_string(RequestFlags::FullPathAndFileName);
        if let Some(full_path) = &full_path {
            let value = cx.string(full_path);
            object.set(&mut cx, "fullPath", value)?;
        }

        if let Some(extension) = item.get_string(RequestFlags::Extension) {
            let value = cx.string(extension);
            object.set(&mut cx, "extension", value)?;
        }

        if let Some(size) = item.get_size(RequestFlags::Size) {
            let value = cx.number(size as f64);
            object.set(&mut cx, "size", value)?;
        }

        if let Some(modified_at) = item.get_time(RequestFlags::DateModified) {
            let value = cx.number(filetime_to_unix_ms(
                modified_at.dwLowDateTime,
                modified_at.dwHighDateTime,
            ));
            object.set(&mut cx, "modifiedAt", value)?;
        }

        items.set(&mut cx, index as u32, object)?;
    }

    result.set(&mut cx, "items", items)?;

    Ok(result)
}

pub fn export(cx: &mut ModuleContext) -> NeonResult<()> {
    let everything = cx.empty_object();

    let is_running = JsFunction::new(cx, is_running)?;
    everything.set(cx, "isRunning", is_running)?;

    let is_db_loaded = JsFunction::new(cx, is_db_loaded)?;
    everything.set(cx, "isDbLoaded", is_db_loaded)?;

    let exit = JsFunction::new(cx, exit)?;
    everything.set(cx, "exit", exit)?;

    let query = JsFunction::new(cx, query)?;
    everything.set(cx, "query", query)?;

    let get_version = JsFunction::new(cx, get_version)?;
    everything.set(cx, "getVersion", get_version)?;

    cx.export_value("everything", everything)?;

    Ok(())
}
