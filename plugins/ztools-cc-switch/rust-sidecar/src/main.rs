use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::collections::HashSet;
use toml_edit::{DocumentMut, Item, TableLike};
use rusqlite::{backup::Backup, params_from_iter, Connection};

#[derive(Debug, Deserialize)]
struct Request {
    #[serde(default)]
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct Response {
    id: Value,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Provider {
    name: String,
    api_key: String,
    base_url: String,
    #[serde(default)]
    model: String,
    #[serde(default = "default_wire_api")]
    wire_api: String,
    #[serde(default = "default_claude_auth_field")]
    claude_auth_field: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyParams {
    client: String,
    home_dir: PathBuf,
    provider: Provider,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TomlSnippetParams { config_toml: String, snippet_toml: String, enabled: bool }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexHistoryTomlParams { config_toml: String, enabled: bool, #[serde(default = "default_history_bucket")] bucket: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexStateParams { db_paths: Vec<PathBuf>, source_provider: String, target_provider: String, #[serde(default)] thread_ids: Vec<String>, #[serde(default)] filter_thread_ids: bool, backup_dir: PathBuf }

fn default_history_bucket() -> String { "ztools_cc_switch".into() }

fn merge_toml(target: &mut dyn TableLike, source: &dyn TableLike) {
    for (key, source_item) in source.iter() {
        if let (Some(target_value), Some(source_value)) = (target.get_mut(key).and_then(Item::as_value_mut), source_item.as_value()) {
            let decor = target_value.decor().clone();
            let mut replacement = source_value.clone();
            *replacement.decor_mut() = decor;
            *target_value = replacement;
        } else if let (Some(target_table), Some(source_table)) = (target.get_mut(key).and_then(Item::as_table_like_mut), source_item.as_table_like()) {
            merge_toml(target_table, source_table);
        } else { target.insert(key, source_item.clone()); }
    }
}

fn remove_toml_item(target: &mut Item, source: &Item) {
    if let (Some(target_table), Some(source_table)) = (target.as_table_like_mut(), source.as_table_like()) {
        let keys: Vec<String> = source_table.iter().map(|(key, _)| key.to_string()).collect();
        for key in keys {
            let mut remove = false;
            if let (Some(target_item), Some(source_item)) = (target_table.get_mut(&key), source_table.get(&key)) {
                remove_toml_item(target_item, source_item);
                remove = target_item.is_none() || target_item.as_table_like().is_some_and(|table| table.is_empty());
            }
            if remove { target_table.remove(&key); }
        }
    } else if target.to_string() == source.to_string() { *target = Item::None; }
}

fn update_toml_snippet(params: TomlSnippetParams) -> Result<Value, String> {
    let mut target = if params.config_toml.trim().is_empty() { DocumentMut::new() } else { params.config_toml.parse::<DocumentMut>().map_err(|e| format!("Invalid Codex config.toml: {e}"))? };
    let source = params.snippet_toml.parse::<DocumentMut>().map_err(|e| format!("Invalid Codex common config snippet: {e}"))?;
    if params.enabled { merge_toml(target.as_table_mut(), source.as_table()); }
    else {
        let mut root = Item::Table(target.as_table().clone());
        remove_toml_item(&mut root, source.as_item());
        target = root.as_table().cloned().unwrap_or_default().into();
    }
    Ok(Value::String(target.to_string()))
}

fn extract_codex_common(config_toml: &str) -> Result<Value, String> {
    let mut doc = config_toml.parse::<DocumentMut>().map_err(|e| format!("TOML parse error: {e}"))?;
    let root = doc.as_table_mut();
    for key in ["model", "model_provider", "base_url", "wire_api", "model_providers", "mcp_servers", "experimental_bearer_token", "model_catalog_json"] { root.remove(key); }
    if let Some(mcp) = root.get_mut("mcp").and_then(Item::as_table_like_mut) { mcp.remove("servers"); if mcp.is_empty() { root.remove("mcp"); } }
    if root.get("web_search").and_then(Item::as_str) == Some("disabled") { root.remove("web_search"); }
    Ok(Value::String(doc.to_string().trim().to_string()))
}

fn default_wire_api() -> String {
    "responses".into()
}

fn default_claude_auth_field() -> String {
    "ANTHROPIC_AUTH_TOKEN".into()
}

fn now_token() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn validate_provider(provider: &Provider) -> Result<(), String> {
    if provider.name.trim().is_empty() {
        return Err("Provider 名称不能为空".into());
    }
    if provider.api_key.is_empty() {
        return Err("API Key 不能为空".into());
    }
    for (label, value) in [
        ("API Key", &provider.api_key),
        ("Base URL", &provider.base_url),
        ("模型名称", &provider.model),
    ] {
        if value.contains(['\r', '\n', '\0']) {
            return Err(format!("{label} 不能包含换行或空字符"));
        }
    }
    if !matches!(provider.wire_api.as_str(), "responses" | "chat_completions") {
        return Err("Codex wire_api 仅支持 responses 或 chat_completions".into());
    }
    Ok(())
}

fn read_json_or_empty(path: &Path) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|error| format!("读取 JSON 失败 ({}): {error}", path.display())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(json!({})),
        Err(error) => Err(format!("读取文件失败 ({}): {error}", path.display())),
    }
}

fn json_object_mut<'a>(
    value: &'a mut Value,
    label: &str,
) -> Result<&'a mut Map<String, Value>, String> {
    value
        .as_object_mut()
        .ok_or_else(|| format!("{label} 根节点必须是 JSON 对象"))
}

fn child_object_mut<'a>(
    parent: &'a mut Map<String, Value>,
    key: &str,
) -> &'a mut Map<String, Value> {
    let value = parent.entry(key.to_string()).or_insert_with(|| json!({}));
    if !value.is_object() {
        *value = json!({});
    }
    value.as_object_mut().expect("object just initialized")
}

fn backup_path(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.bak", path.display()))
}

fn atomic_write(
    path: &Path,
    content: &[u8],
    create_backup: bool,
) -> Result<Option<PathBuf>, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建目录失败 ({}): {error}", parent.display()))?;
    }
    let backup = if create_backup && path.exists() {
        let backup = backup_path(path);
        fs::copy(path, &backup)
            .map_err(|error| format!("创建备份失败 ({}): {error}", backup.display()))?;
        Some(backup)
    } else {
        None
    };
    let temp = PathBuf::from(format!("{}.{}.tmp", path.display(), now_token()));
    if let Err(error) = fs::write(&temp, content) {
        let _ = fs::remove_file(&temp);
        return Err(format!("写入临时文件失败 ({}): {error}", temp.display()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(0o600));
    }
    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(format!("原子替换失败 ({}): {error}", path.display()));
    }
    Ok(backup)
}

fn write_json(path: &Path, value: &Value) -> Result<Option<PathBuf>, String> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    atomic_write(path, &bytes, true)
}

fn apply_claude(home: &Path, provider: &Provider) -> Result<Value, String> {
    let path = home.join(".claude/settings.json");
    let mut settings = read_json_or_empty(&path)?;
    let root = json_object_mut(&mut settings, "Claude settings.json")?;
    let env = child_object_mut(root, "env");
    let auth_field = if provider.claude_auth_field == "ANTHROPIC_API_KEY" {
        "ANTHROPIC_API_KEY"
    } else {
        "ANTHROPIC_AUTH_TOKEN"
    };
    let stale_field = if auth_field == "ANTHROPIC_API_KEY" {
        "ANTHROPIC_AUTH_TOKEN"
    } else {
        "ANTHROPIC_API_KEY"
    };
    env.insert(auth_field.into(), Value::String(provider.api_key.clone()));
    env.remove(stale_field);
    env.insert(
        "ANTHROPIC_BASE_URL".into(),
        Value::String(provider.base_url.clone()),
    );
    if provider.model.is_empty() {
        env.remove("ANTHROPIC_MODEL");
    } else {
        env.insert(
            "ANTHROPIC_MODEL".into(),
            Value::String(provider.model.clone()),
        );
    }
    let backup = write_json(&path, &settings)?;
    Ok(json!({"files": [path], "backups": backup.into_iter().collect::<Vec<_>>() }))
}

fn strip_managed_codex_config(input: &str) -> String {
    let mut output = Vec::new();
    let mut in_managed_block = false;
    let mut in_managed_section = false;
    let mut current_section = String::new();
    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed == "# >>> ztools-cc-switch >>>" {
            in_managed_block = true;
            continue;
        }
        if trimmed == "# <<< ztools-cc-switch <<<" {
            in_managed_block = false;
            continue;
        }
        if in_managed_block {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            current_section = trimmed[1..trimmed.len() - 1].to_string();
            in_managed_section = current_section == "model_providers.ztools_cc_switch";
            if in_managed_section {
                continue;
            }
        } else if in_managed_section {
            continue;
        }
        if current_section.is_empty()
            && (trimmed.starts_with("model =") || trimmed.starts_with("model_provider ="))
        {
            continue;
        }
        output.push(line);
    }
    output.join("\n").trim_end().to_string()
}

fn toml_string(value: &str) -> String {
    serde_json::to_string(value).expect("serializing a string cannot fail")
}

fn apply_codex(home: &Path, provider: &Provider) -> Result<Value, String> {
    let config_path = home.join(".codex/config.toml");
    let auth_path = home.join(".codex/auth.json");
    let original_config = match fs::read_to_string(&config_path) {
        Ok(value) => Some(value),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("读取 Codex config.toml 失败: {error}")),
    };
    let preserved = strip_managed_codex_config(original_config.as_deref().unwrap_or(""));
    let block = format!(
        "# >>> ztools-cc-switch >>>\nmodel = {}\nmodel_provider = \"ztools_cc_switch\"\n\n[model_providers.ztools_cc_switch]\nname = {}\nbase_url = {}\nenv_key = \"OPENAI_API_KEY\"\nwire_api = {}\n# <<< ztools-cc-switch <<<\n",
        toml_string(if provider.model.is_empty() { "gpt-5" } else { &provider.model }),
        toml_string(&provider.name),
        toml_string(&provider.base_url),
        toml_string(&provider.wire_api)
    );
    let next_config = if preserved.is_empty() {
        block
    } else {
        format!("{preserved}\n\n{block}")
    };
    let config_backup = atomic_write(&config_path, next_config.as_bytes(), true)?;

    let auth_result = (|| {
        let mut auth = read_json_or_empty(&auth_path)?;
        json_object_mut(&mut auth, "Codex auth.json")?.insert(
            "OPENAI_API_KEY".into(),
            Value::String(provider.api_key.clone()),
        );
        write_json(&auth_path, &auth)
    })();

    let auth_backup = match auth_result {
        Ok(value) => value,
        Err(error) => {
            if let Some(original) = original_config {
                let _ = atomic_write(&config_path, original.as_bytes(), false);
            } else {
                let _ = fs::remove_file(&config_path);
            }
            return Err(error);
        }
    };
    let backups: Vec<PathBuf> = config_backup.into_iter().chain(auth_backup).collect();
    Ok(json!({"files": [config_path, auth_path], "backups": backups}))
}

fn env_assignment(key: &str, value: &str) -> String {
    let safe = value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || "_./:@+-".contains(ch));
    if safe {
        format!("{key}={value}")
    } else {
        format!(
            "{key}={}",
            serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
        )
    }
}

fn update_gemini_env(content: &str, provider: &Provider) -> String {
    let managed_keys = ["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL", "GEMINI_MODEL"];
    let mut preserved = Vec::new();
    let mut in_managed = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "# >>> ztools-cc-switch >>>" {
            in_managed = true;
            continue;
        }
        if trimmed == "# <<< ztools-cc-switch <<<" {
            in_managed = false;
            continue;
        }
        if in_managed {
            continue;
        }
        let normalized = trimmed.strip_prefix("export ").unwrap_or(trimmed);
        let key = normalized.split('=').next().unwrap_or("").trim();
        if managed_keys.contains(&key) {
            continue;
        }
        preserved.push(line);
    }
    while preserved.last().is_some_and(|line| line.trim().is_empty()) {
        preserved.pop();
    }
    let mut managed = vec![
        "# >>> ztools-cc-switch >>>".to_string(),
        env_assignment("GEMINI_API_KEY", &provider.api_key),
        env_assignment("GOOGLE_GEMINI_BASE_URL", &provider.base_url),
    ];
    if !provider.model.is_empty() {
        managed.push(env_assignment("GEMINI_MODEL", &provider.model));
    }
    managed.push("# <<< ztools-cc-switch <<<".into());
    if preserved.is_empty() {
        format!("{}\n", managed.join("\n"))
    } else {
        format!("{}\n\n{}\n", preserved.join("\n"), managed.join("\n"))
    }
}

fn apply_gemini(home: &Path, provider: &Provider) -> Result<Value, String> {
    let env_path = home.join(".gemini/.env");
    let settings_path = home.join(".gemini/settings.json");
    let original_env = match fs::read_to_string(&env_path) {
        Ok(value) => Some(value),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("读取 Gemini .env 失败: {error}")),
    };
    let next_env = update_gemini_env(original_env.as_deref().unwrap_or(""), provider);
    let env_backup = atomic_write(&env_path, next_env.as_bytes(), true)?;

    let settings_result = (|| {
        let mut settings = read_json_or_empty(&settings_path)?;
        let root = json_object_mut(&mut settings, "Gemini settings.json")?;
        let security = child_object_mut(root, "security");
        let auth = child_object_mut(security, "auth");
        auth.insert(
            "selectedType".into(),
            Value::String("gemini-api-key".into()),
        );
        write_json(&settings_path, &settings)
    })();
    let settings_backup = match settings_result {
        Ok(value) => value,
        Err(error) => {
            if let Some(original) = original_env {
                let _ = atomic_write(&env_path, original.as_bytes(), false);
            } else {
                let _ = fs::remove_file(&env_path);
            }
            return Err(error);
        }
    };
    let backups: Vec<PathBuf> = env_backup.into_iter().chain(settings_backup).collect();
    Ok(json!({"files": [env_path, settings_path], "backups": backups}))
}

fn apply_client(params: ApplyParams) -> Result<Value, String> {
    validate_provider(&params.provider)?;
    if !params.home_dir.is_absolute() {
        return Err("homeDir 必须是绝对路径".into());
    }
    match params.client.as_str() {
        "claude" => apply_claude(&params.home_dir, &params.provider),
        "codex" => apply_codex(&params.home_dir, &params.provider),
        "gemini" => apply_gemini(&params.home_dir, &params.provider),
        other => Err(format!("不支持的客户端: {other}")),
    }
}

fn unified_official_table() -> toml_edit::Table {
    let mut table = toml_edit::Table::new();
    table.insert("name", toml_edit::value("OpenAI"));
    table.insert("requires_openai_auth", toml_edit::value(true));
    table.insert("supports_websockets", toml_edit::value(true));
    table.insert("wire_api", toml_edit::value("responses"));
    table
}

fn is_unified_official_table(table: &toml_edit::Table) -> bool {
    table.len() == 4
        && table.get("name").and_then(Item::as_str) == Some("OpenAI")
        && table.get("requires_openai_auth").and_then(Item::as_bool) == Some(true)
        && table.get("supports_websockets").and_then(Item::as_bool) == Some(true)
        && table.get("wire_api").and_then(Item::as_str) == Some("responses")
}

fn update_codex_history_toml(params: CodexHistoryTomlParams) -> Result<Value, String> {
    if params.bucket.trim().is_empty() { return Err("bucket 不能为空".into()); }
    let original = params.config_toml;
    let mut doc = original.parse::<DocumentMut>().map_err(|e| format!("Invalid Codex config.toml: {e}"))?;
    if params.enabled {
        if doc.get("model_provider").is_some() {
            return Ok(json!({"configToml": original, "changed": false, "reason": "explicit_model_provider"}));
        }
        let conflict = doc.get("model_providers").and_then(Item::as_table)
            .and_then(|providers| providers.get(&params.bucket)).and_then(Item::as_table)
            .is_some_and(|table| !is_unified_official_table(table));
        if conflict { return Ok(json!({"configToml": original, "changed": false, "reason": "bucket_conflict"})); }
        doc["model_provider"] = toml_edit::value(params.bucket.clone());
        if doc.get("model_providers").is_none() {
            let mut parent = toml_edit::Table::new(); parent.set_implicit(true);
            doc["model_providers"] = Item::Table(parent);
        }
        let providers = doc["model_providers"].as_table_mut().ok_or("model_providers 不是表")?;
        if !providers.contains_key(&params.bucket) { providers.insert(&params.bucket, Item::Table(unified_official_table())); }
        let output = doc.to_string();
        return Ok(json!({"changed": output != original, "configToml": output, "reason": null}));
    }
    if doc.get("model_provider").and_then(Item::as_str) != Some(params.bucket.as_str()) {
        return Ok(json!({"configToml": original, "changed": false, "reason": "not_injected"}));
    }
    let matches = doc.get("model_providers").and_then(Item::as_table)
        .and_then(|providers| providers.get(&params.bucket)).and_then(Item::as_table)
        .is_some_and(is_unified_official_table);
    if !matches { return Ok(json!({"configToml": original, "changed": false, "reason": "bucket_not_owned"})); }
    doc.as_table_mut().remove("model_provider");
    let empty = doc.get_mut("model_providers").and_then(Item::as_table_mut).map(|providers| { providers.remove(&params.bucket); providers.is_empty() }).unwrap_or(false);
    if empty { doc.as_table_mut().remove("model_providers"); }
    let output = doc.to_string();
    Ok(json!({"changed": output != original, "configToml": output, "reason": null}))
}

fn sqlite_has_threads(conn: &Connection) -> Result<bool, String> {
    let table: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='threads'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if table == 0 { return Ok(false); }
    let mut stmt = conn.prepare("PRAGMA table_info(threads)").map_err(|e| e.to_string())?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?;
    let found = columns.flatten().any(|name| name == "model_provider");
    Ok(found)
}

fn update_codex_state(params: CodexStateParams) -> Result<Value, String> {
    if !params.backup_dir.is_absolute() { return Err("backupDir 必须是绝对路径".into()); }
    fs::create_dir_all(&params.backup_dir).map_err(|e| format!("创建 SQLite 备份目录失败: {e}"))?;
    let filter: HashSet<String> = params.thread_ids.into_iter().collect();
    let mut changed_rows = 0usize; let mut thread_ids = Vec::new(); let mut backups = Vec::new();
    for (index, db_path) in params.db_paths.iter().enumerate() {
        if !db_path.exists() { continue; }
        let mut conn = Connection::open(db_path).map_err(|e| format!("打开 Codex state DB 失败 ({}): {e}", db_path.display()))?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?;
        if !sqlite_has_threads(&conn)? { continue; }
        let ids = {
            let mut stmt = conn.prepare("SELECT id FROM threads WHERE model_provider = ?1").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([&params.source_provider], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
            rows.flatten().filter(|id| !params.filter_thread_ids || filter.contains(id)).collect::<Vec<_>>()
        };
        if ids.is_empty() { continue; }
        let filename = db_path.file_name().and_then(|value| value.to_str()).unwrap_or("state.sqlite");
        let backup_path = params.backup_dir.join(format!("{index}-{filename}"));
        let mut destination = Connection::open(&backup_path).map_err(|e| format!("创建 SQLite 备份失败: {e}"))?;
        Backup::new(&conn, &mut destination).and_then(|backup| backup.run_to_completion(64, Duration::from_millis(10), None)).map_err(|e| format!("备份 SQLite 失败: {e}"))?;
        drop(destination); backups.push(backup_path);
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for id in &ids {
            changed_rows += tx.execute("UPDATE threads SET model_provider = ?1 WHERE model_provider = ?2 AND id = ?3", params_from_iter([&params.target_provider, &params.source_provider, id])).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        thread_ids.extend(ids);
    }
    thread_ids.sort(); thread_ids.dedup();
    Ok(json!({"changedRows": changed_rows, "threadIds": thread_ids, "backups": backups}))
}

fn handle(request: Request) -> Response {
    let result = match request.method.as_str() {
        "ping" => Ok(json!({
            "name": "cc-switch-sidecar",
            "version": env!("CARGO_PKG_VERSION"),
            "protocol": 1
        })),
        "applyClient" => serde_json::from_value::<ApplyParams>(request.params)
            .map_err(|error| format!("请求参数无效: {error}"))
            .and_then(apply_client),
        "updateTomlCommonConfig" => serde_json::from_value::<TomlSnippetParams>(request.params).map_err(|e| format!("请求参数无效: {e}")).and_then(update_toml_snippet),
        "extractCodexCommonConfig" => request.params.get("configToml").and_then(Value::as_str).ok_or_else(|| "configToml 必须是字符串".to_string()).and_then(extract_codex_common),
        "updateCodexHistoryToml" => serde_json::from_value::<CodexHistoryTomlParams>(request.params).map_err(|e| format!("请求参数无效: {e}")).and_then(update_codex_history_toml),
        "updateCodexStateProviders" => serde_json::from_value::<CodexStateParams>(request.params).map_err(|e| format!("请求参数无效: {e}")).and_then(update_codex_state),
        other => Err(format!("未知方法: {other}")),
    };
    match result {
        Ok(value) => Response {
            id: request.id,
            ok: true,
            result: Some(value),
            error: None,
        },
        Err(error) => Response {
            id: request.id,
            ok: false,
            result: None,
            error: Some(error),
        },
    }
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout());
    for line in stdin.lock().lines() {
        let response = match line {
            Ok(line) if line.trim().is_empty() => continue,
            Ok(line) => match serde_json::from_str::<Request>(&line) {
                Ok(request) => handle(request),
                Err(error) => Response {
                    id: Value::Null,
                    ok: false,
                    result: None,
                    error: Some(format!("JSON 请求无效: {error}")),
                },
            },
            Err(error) => Response {
                id: Value::Null,
                ok: false,
                result: None,
                error: Some(format!("读取 stdin 失败: {error}")),
            },
        };
        if serde_json::to_writer(&mut stdout, &response).is_err() {
            break;
        }
        if writeln!(&mut stdout).and_then(|_| stdout.flush()).is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        let path = std::env::temp_dir().join(format!("cc-switch-sidecar-test-{}", now_token()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn provider() -> Provider {
        Provider {
            name: "Test".into(),
            api_key: "sk-test".into(),
            base_url: "https://api.example.com".into(),
            model: "model-test".into(),
            wire_api: "responses".into(),
            claude_auth_field: "ANTHROPIC_AUTH_TOKEN".into(),
        }
    }

    #[test]
    fn claude_preserves_unknown_settings_and_backs_up() {
        let home = fixture();
        let path = home.join(".claude/settings.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"permissions":{"allow":["Bash"]},"env":{"KEEP":"yes"}}"#,
        )
        .unwrap();
        apply_claude(&home, &provider()).unwrap();
        let value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            value.pointer("/env/KEEP").and_then(Value::as_str),
            Some("yes")
        );
        assert_eq!(
            value
                .pointer("/env/ANTHROPIC_AUTH_TOKEN")
                .and_then(Value::as_str),
            Some("sk-test")
        );
        assert!(backup_path(&path).exists());
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn codex_preserves_other_toml_and_login_material() {
        let home = fixture();
        let config = home.join(".codex/config.toml");
        let auth = home.join(".codex/auth.json");
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(
            &config,
            "model = \"old\"\napproval_policy = \"on-request\"\n",
        )
        .unwrap();
        fs::write(&auth, r#"{"tokens":{"access_token":"keep"}}"#).unwrap();
        apply_codex(&home, &provider()).unwrap();
        let text = fs::read_to_string(config).unwrap();
        assert!(text.contains("approval_policy = \"on-request\""));
        assert!(text.contains("wire_api = \"responses\""));
        let value: Value = serde_json::from_str(&fs::read_to_string(auth).unwrap()).unwrap();
        assert_eq!(
            value
                .pointer("/tokens/access_token")
                .and_then(Value::as_str),
            Some("keep")
        );
        assert_eq!(
            value.get("OPENAI_API_KEY").and_then(Value::as_str),
            Some("sk-test")
        );
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn gemini_preserves_unmanaged_env() {
        let home = fixture();
        let env = home.join(".gemini/.env");
        fs::create_dir_all(env.parent().unwrap()).unwrap();
        fs::write(&env, "# keep\nKEEP=value\nGEMINI_API_KEY=old\n").unwrap();
        apply_gemini(&home, &provider()).unwrap();
        let text = fs::read_to_string(env).unwrap();
        assert!(text.contains("KEEP=value"));
        assert_eq!(text.matches("GEMINI_API_KEY=").count(), 1);
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn rejects_injected_values() {
        let mut invalid = provider();
        invalid.api_key = "safe\nINJECTED=value".into();
        assert!(validate_provider(&invalid).is_err());
    }

    #[test]
    fn codex_history_toml_injection_is_owned_and_reversible() {
        let enabled = update_codex_history_toml(CodexHistoryTomlParams { config_toml: "approval_policy = \"on-request\"\n".into(), enabled: true, bucket: "ztools_cc_switch".into() }).unwrap();
        let config = enabled.get("configToml").and_then(Value::as_str).unwrap();
        assert!(config.contains("model_provider = \"ztools_cc_switch\""));
        assert!(config.contains("requires_openai_auth = true"));
        let disabled = update_codex_history_toml(CodexHistoryTomlParams { config_toml: config.into(), enabled: false, bucket: "ztools_cc_switch".into() }).unwrap();
        let restored = disabled.get("configToml").and_then(Value::as_str).unwrap();
        assert!(restored.contains("approval_policy"));
        assert!(!restored.contains("model_provider"));
    }

    #[test]
    fn codex_state_provider_update_backs_up_and_filters_ids() {
        let root = fixture(); let db = root.join("state_5.sqlite");
        let conn = Connection::open(&db).unwrap();
        conn.execute("CREATE TABLE threads (id TEXT PRIMARY KEY, model_provider TEXT)", []).unwrap();
        conn.execute("INSERT INTO threads VALUES ('a','openai'),('b','openai'),('c','other')", []).unwrap(); drop(conn);
        let result = update_codex_state(CodexStateParams { db_paths: vec![db.clone()], source_provider: "openai".into(), target_provider: "ztools_cc_switch".into(), thread_ids: vec!["a".into()], filter_thread_ids: true, backup_dir: root.join("backup") }).unwrap();
        assert_eq!(result.get("changedRows").and_then(Value::as_u64), Some(1));
        let conn = Connection::open(&db).unwrap();
        assert_eq!(conn.query_row("SELECT model_provider FROM threads WHERE id='a'", [], |row| row.get::<_, String>(0)).unwrap(), "ztools_cc_switch");
        assert_eq!(conn.query_row("SELECT model_provider FROM threads WHERE id='b'", [], |row| row.get::<_, String>(0)).unwrap(), "openai");
        assert!(root.join("backup/0-state_5.sqlite").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
