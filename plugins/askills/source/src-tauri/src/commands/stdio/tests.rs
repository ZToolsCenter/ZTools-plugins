use super::*;
use std::io::Cursor;

fn request(command: &str, args: Value) -> Request {
    Request {
        id: json!("request-1"),
        command: command.into(),
        args,
    }
}

#[cfg(windows)]
#[test]
fn installed_fonts_are_names_only_and_reject_extra_arguments() {
    let root = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(root.path().join("data"));
    let response = tauri::async_runtime::block_on(dispatch(
        runtime.clone(),
        request("list_system_fonts", json!({})),
    ))
    .unwrap();
    let names: Vec<String> = serde_json::from_value(response).unwrap();
    assert!(!names.is_empty());
    assert!(
        names
            .iter()
            .all(|name| crate::platform::fonts::valid_family(name) && !name.starts_with('@'))
    );
    let unique: std::collections::BTreeSet<_> =
        names.iter().map(|name| name.to_lowercase()).collect();
    assert_eq!(unique.len(), names.len());
    let error = tauri::async_runtime::block_on(dispatch(
        runtime,
        request("list_system_fonts", json!({"path":"arbitrary"})),
    ))
    .unwrap_err();
    assert_eq!(error.code, "InvalidRequest");
}

#[test]
fn envelopes_require_bounded_ids_and_object_arguments() {
    for value in [
        json!({"id": null, "command": "get_snapshot"}),
        json!({"id": -1, "command": "get_snapshot"}),
        json!({"id": "a".repeat(129), "command": "get_snapshot"}),
        json!({"id": 1, "command": "get_snapshot", "args": []}),
        json!({"id": 1, "command": "get_snapshot", "path": "secret"}),
    ] {
        assert_eq!(
            decode(&serde_json::to_vec(&value).unwrap())
                .err()
                .unwrap()
                .code,
            "InvalidRequest"
        );
    }
    let valid = decode(br#"{"id":1,"command":"get_app_info"}"#).unwrap();
    assert_eq!(valid.args, json!({}));
}

#[test]
fn oversized_frames_are_drained_without_losing_the_next_request() {
    let mut bytes = vec![b'x'; MAX_REQUEST_BYTES + 10];
    bytes.extend_from_slice(b"\n{\"id\":1,\"command\":\"get_app_info\"}\n");
    let mut input = Cursor::new(bytes);
    let error = read_frame(&mut input).unwrap().unwrap().unwrap_err();
    assert_eq!(error.code, "InvalidRequest");
    let second = read_frame(&mut input).unwrap().unwrap().unwrap();
    assert_eq!(decode(&second).unwrap().command, "get_app_info");
    assert!(read_frame(&mut input).unwrap().is_none());
}

#[test]
fn whitelist_and_argument_schemas_reject_unapproved_operations() {
    let root = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(root.path().join("data"));
    let error = tauri::async_runtime::block_on(dispatch(
        runtime.clone(),
        request("execute_shell", json!({"command": "ignored"})),
    ))
    .unwrap_err();
    assert_eq!(error.code, "UnknownCommand");
    let error = tauri::async_runtime::block_on(dispatch(
        runtime.clone(),
        request("set_locale", json!({"locale": "en", "path": "arbitrary"})),
    ))
    .unwrap_err();
    assert_eq!(error.code, "InvalidRequest");
    let error = tauri::async_runtime::block_on(dispatch(
        runtime,
        request("get_snapshot", json!({"dataDir": "arbitrary"})),
    ))
    .unwrap_err();
    assert_eq!(error.code, "InvalidRequest");
}

#[test]
fn native_directory_grants_are_absolute_and_purpose_bound() {
    let root = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(root.path().join("data"));
    for args in [
        json!({"path": "relative", "purpose": "project"}),
        json!({"path": root.path(), "purpose": "shell"}),
    ] {
        assert!(
            tauri::async_runtime::block_on(dispatch(
                runtime.clone(),
                request("register_directory_selection", args),
            ))
            .is_err()
        );
    }
    let selection = tauri::async_runtime::block_on(dispatch(
        runtime.clone(),
        request(
            "register_directory_selection",
            json!({"path": root.path(), "purpose": "project"}),
        ),
    ))
    .unwrap();
    let error = tauri::async_runtime::block_on(dispatch(
        runtime,
        request("prepare_import", json!({"selectionId": selection["id"]})),
    ))
    .unwrap_err();
    assert_eq!(error.code, "InvalidSelection");
}

#[test]
fn cancellation_and_progress_do_not_acquire_the_busy_workspace() {
    let root = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(root.path().join("data"));
    runtime.busy.store(true, Ordering::Release);
    let _workspace = runtime.workspace.lock().unwrap();
    let progress = tauri::async_runtime::block_on(dispatch(
        runtime.clone(),
        request("get_download_progress", json!({"requestId": "none"})),
    ))
    .unwrap();
    assert_eq!(progress, Value::Null);
    tauri::async_runtime::block_on(dispatch(
        runtime.clone(),
        request("cancel_operation", json!({})),
    ))
    .unwrap();
    assert!(runtime.cancel.load(Ordering::Acquire));
}

#[test]
fn eof_cancellation_is_not_reset_by_a_late_command_worker() {
    let root = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(root.path().join("data"));
    runtime.shutting_down.store(true, Ordering::Release);
    runtime.cancel.store(true, Ordering::Release);
    let result = tauri::async_runtime::block_on(work(runtime, |_, cancel| {
        crate::platform::fs::check_cancel(cancel)
    }));
    assert_eq!(result.unwrap_err().code, "Cancelled");
}

#[test]
fn host_cancellation_is_not_reset_by_a_late_command_worker() {
    let root = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(root.path().join("data"));
    runtime
        .host_manages_cancellation
        .store(true, Ordering::Release);
    runtime.cancel.store(true, Ordering::Release);
    let result = tauri::async_runtime::block_on(work(runtime, |_, cancel| {
        crate::platform::fs::check_cancel(cancel)
    }));
    assert_eq!(result.unwrap_err().code, "Cancelled");
}

#[test]
fn stream_responses_are_json_lines_and_eof_releases_the_store() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    let runtime = Runtime::new(data.clone());
    let output = Arc::new(Mutex::new(Vec::new()));
    let input = Cursor::new(b"invalid json\n{\"id\":7,\"command\":\"get_app_info\"}\n");
    serve(runtime, input, output.clone()).unwrap();
    let bytes = output.lock().unwrap().clone();
    let lines: Vec<Value> = String::from_utf8(bytes)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["error"]["code"], "InvalidRequest");
    assert_eq!(lines[1]["id"], 7);
    assert_eq!(lines[1]["result"]["protocolVersion"], 1);
    assert_eq!(lines[1]["result"]["version"], env!("CARGO_PKG_VERSION"));
    Store::open(&data).unwrap();
}

#[test]
fn command_line_accepts_only_the_explicit_data_directory_switch() {
    assert!(parse_arguments(["--shell".into()]).is_err());
    assert!(parse_arguments(["--data-dir".into()]).is_err());
    assert!(parse_arguments(["--data-dir".into(), "data".into(), "extra".into()]).is_err());
    assert_eq!(
        parse_arguments(Vec::<std::ffi::OsString>::new()).unwrap(),
        None
    );
    assert!(bootstrap::initialize_helper(Some(PathBuf::from("relative"))).is_err());
}
