//! Private, inherited stdio transport for the ZTools preload process.
//! There is no listening socket and no general filesystem or shell command.
use super::*;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
use std::thread::JoinHandle;

const MAX_REQUEST_BYTES: usize = 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    id: Value,
    command: String,
    #[serde(default = "empty_args")]
    args: Value,
}

fn empty_args() -> Value {
    json!({})
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new("InvalidRequest", message)
}

fn decode(bytes: &[u8]) -> Result<Request> {
    let request: Request = serde_json::from_slice(bytes).map_err(|e| invalid(e.to_string()))?;
    let valid_id = request.id.as_u64().is_some()
        || request
            .id
            .as_str()
            .is_some_and(|id| !id.is_empty() && id.len() <= 128);
    if !valid_id || !request.args.is_object() || request.command.len() > 80 {
        return Err(invalid("无效的请求编号、命令或参数"));
    }
    Ok(request)
}

fn encode<T: Serialize>(value: T) -> Result<Value> {
    serde_json::to_value(value).map_err(|e| AppError::new("Serialization", e.to_string()))
}

// Every command decodes an explicit schema, including rejection of extra keys.
// register_directory_selection is host-only; preload must not expose it to UI.
async fn dispatch(runtime: Arc<Runtime>, request: Request) -> Result<Value> {
    let args = request.args;
    macro_rules! arguments {
        ($($name:ident: $kind:ty),* $(,)?) => {{
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct Arguments { $($name: $kind),* }
            serde_json::from_value::<Arguments>(args).map_err(|e| invalid(e.to_string()))?
        }};
    }
    macro_rules! invoke {
        ($command:ident($($name:ident: $kind:ty),* $(,)?)) => {{
            let arguments = arguments!($($name: $kind),*);
            let _ = &arguments;
            encode(super::$command(runtime, $(arguments.$name),*).await?)
        }};
    }
    match request.command.as_str() {
        "get_app_info" => {
            arguments!();
            Ok(json!({
                "name": "Askills",
                "version": env!("CARGO_PKG_VERSION"),
                "protocolVersion": 1,
            }))
        }
        "get_snapshot" => invoke!(get_snapshot()),
        "list_system_fonts" => {
            arguments!();
            encode(super::list_system_fonts().await?)
        }
        "set_locale" => invoke!(set_locale(locale: Locale)),
        "set_appearance" => invoke!(set_appearance(appearance: Appearance)),
        "remember_repository" => invoke!(remember_repository(repository: String)),
        "set_skill_display_name" => {
            invoke!(set_skill_display_name(skill_id: String, display_name: String))
        }
        "set_project_display_name" => {
            invoke!(set_project_display_name(project_id: String, display_name: String))
        }
        "remove_library_skills" => invoke!(remove_library_skills(skill_ids: Vec<String>)),
        "remove_projects" => invoke!(remove_projects(project_ids: Vec<String>)),
        "register_directory_selection" => {
            invoke!(register_directory_selection(path: PathBuf, purpose: String))
        }
        "prepare_import" => invoke!(prepare_import(selection_id: String)),
        "finish_import" => invoke!(finish_import(import_id: String)),
        "discard_import" => invoke!(discard_import(import_id: String)),
        "register_project" => invoke!(register_project(selection_id: String)),
        "discover_projects" => invoke!(discover_projects(selection_id: String)),
        "scan_project" => invoke!(scan_project(project_id: String)),
        "get_document" => invoke!(get_document(revision_id: String)),
        "get_revisions" => invoke!(get_revisions(skill_id: String)),
        "preview_deployment" => invoke!(
            preview_deployment(
                project_id: String,
                revision_id: String,
                agent: String,
                mode: String,
            )
        ),
        "apply_deployment" => invoke!(apply_deployment(plan_id: String)),
        "remove_deployment" => invoke!(remove_deployment(deployment_id: String)),
        "rollback_deployment" => invoke!(rollback_deployment(deployment_id: String)),
        "resolve_github" => invoke!(resolve_github(repository: String, reference: String)),
        "resolve_git" => invoke!(resolve_git(repository: String, reference: String)),
        "get_git_version" => invoke!(get_git_version()),
        "prepare_github" => invoke!(
            prepare_github(catalog_id: String, skill_path: String, request_id: Option<String>)
        ),
        "preview_library_migration" => invoke!(preview_library_migration(selection_id: String)),
        "discard_selections" => invoke!(discard_selections(selection_ids: Vec<String>)),
        "set_library_root" => invoke!(set_library_root(selection_id: String)),
        "get_revision_diff" => invoke!(get_revision_diff(before_id: String, after_id: String)),
        "get_download_progress" => {
            let arguments = arguments!(request_id: String);
            encode(super::get_download_progress(runtime, arguments.request_id))
        }
        "cancel_operation" => {
            arguments!();
            super::cancel_operation(runtime);
            Ok(Value::Null)
        }
        _ => Err(AppError::new("UnknownCommand", "不支持的插件命令")),
    }
}

fn response(id: Value, result: Result<Value>) -> Value {
    match result {
        Ok(result) => json!({"id": id, "result": result}),
        Err(error) => json!({"id": id, "error": error}),
    }
}

fn write_response(output: &Mutex<impl Write>, value: Value) -> io::Result<()> {
    let mut output = output
        .lock()
        .map_err(|_| io::Error::other("response writer unavailable"))?;
    serde_json::to_writer(&mut *output, &value)?;
    output.write_all(b"\n")?;
    output.flush()
}

// Bound allocation even when an untrusted/malformed caller omits the newline.
fn read_frame(input: &mut impl BufRead) -> io::Result<Option<Result<Vec<u8>>>> {
    let mut data = Vec::new();
    let mut oversized = false;
    loop {
        let available = input.fill_buf()?;
        if available.is_empty() {
            return Ok(if oversized {
                Some(Err(invalid("插件请求超过大小限制")))
            } else if data.is_empty() {
                None
            } else {
                Some(Ok(data))
            });
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let used = newline.map_or(available.len(), |position| position + 1);
        if !oversized && data.len() + used <= MAX_REQUEST_BYTES {
            data.extend_from_slice(&available[..used]);
        } else {
            oversized = true;
            data.clear();
        }
        input.consume(used);
        if newline.is_some() {
            return Ok(Some(if oversized {
                Err(invalid("插件请求超过大小限制"))
            } else {
                Ok(data)
            }));
        }
    }
}

fn finish(worker: &mut Option<JoinHandle<io::Result<()>>>) -> io::Result<()> {
    if let Some(worker) = worker.take() {
        worker
            .join()
            .map_err(|_| io::Error::other("command worker failed"))??;
    }
    Ok(())
}

fn serve<R: BufRead, W: Write + Send + 'static>(
    runtime: Arc<Runtime>,
    mut input: R,
    output: Arc<Mutex<W>>,
) -> io::Result<()> {
    runtime
        .host_manages_cancellation
        .store(true, Ordering::Release);
    let mut worker: Option<JoinHandle<io::Result<()>>> = None;
    let running = Arc::new(AtomicBool::new(false));
    let result = (|| {
        while let Some(frame) = read_frame(&mut input)? {
            let request = match frame.and_then(|frame| decode(&frame)) {
                Ok(request) => request,
                Err(error) => {
                    write_response(&output, response(Value::Null, Err(error)))?;
                    continue;
                }
            };
            let id = request.id.clone();
            // Reads and cancellation are serviced while the mutation worker runs.
            if matches!(
                request.command.as_str(),
                "get_download_progress" | "cancel_operation" | "get_app_info" | "list_system_fonts"
            ) {
                let result = tauri::async_runtime::block_on(dispatch(runtime.clone(), request));
                write_response(&output, response(id, result))?;
                continue;
            }
            if worker.as_ref().is_some_and(|worker| worker.is_finished())
                || !running.load(Ordering::Acquire)
            {
                finish(&mut worker)?;
            }
            if worker.is_some() {
                write_response(
                    &output,
                    response(
                        id,
                        Err(AppError::new(
                            "Busy",
                            "另一个操作正在进行，请等待或取消后重试",
                        )),
                    ),
                )?;
                continue;
            }
            let runtime = runtime.clone();
            let output = output.clone();
            let running = running.clone();
            // Reset at acceptance, before starting a worker, so a subsequent
            // cancel request cannot be lost while the worker is being scheduled.
            runtime.cancel.store(false, Ordering::Release);
            running.store(true, Ordering::Release);
            worker = Some(std::thread::spawn(move || {
                let result = tauri::async_runtime::block_on(dispatch(runtime, request));
                // Clear before writing so an immediate follow-up from the caller
                // cannot observe a completed operation as spuriously still Busy.
                running.store(false, Ordering::Release);
                write_response(&output, response(id, result))
            }));
        }
        Ok(())
    })();
    runtime.shutting_down.store(true, Ordering::Release);
    runtime.cancel.store(true, Ordering::Release);
    // A migration past its commit boundary must finish before locks are released.
    let stopped = finish(&mut worker);
    result.and(stopped)
}

fn parse_arguments(
    arguments: impl IntoIterator<Item = std::ffi::OsString>,
) -> Result<Option<PathBuf>> {
    let mut arguments = arguments.into_iter();
    let data = match arguments.next() {
        None => None,
        Some(flag) if flag == "--data-dir" => Some(PathBuf::from(
            arguments
                .next()
                .ok_or_else(|| invalid("--data-dir 需要绝对路径"))?,
        )),
        _ => return Err(invalid("不支持的启动参数")),
    };
    if arguments.next().is_some() {
        return Err(invalid("不支持的启动参数"));
    }
    Ok(data)
}

pub fn run() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let data = parse_arguments(std::env::args_os().skip(1))?;
    let runtime = bootstrap::initialize_helper(data)?;
    serve(
        runtime,
        io::stdin().lock(),
        Arc::new(Mutex::new(io::stdout())),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests;
