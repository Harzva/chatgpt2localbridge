use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{Value, json};

const VERSION: &str = "0.1.0";
const SERVICE: &str = "chatgpt2localbridge-rs";

#[derive(Clone, Debug)]
struct Config {
    data_dir: PathBuf,
    log_dir: PathBuf,
    public_base_url: Option<String>,
    dashboard_token: Option<String>,
    oauth_enabled: bool,
    policy: Policy,
}

#[derive(Clone, Debug)]
struct Policy {
    allowed_project_roots: Vec<PathBuf>,
    skill_roots: Vec<PathBuf>,
    deny_globs: Vec<String>,
    shell_enabled: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyFile {
    allowed_project_roots: Option<Vec<String>>,
    skill_roots: Option<Vec<String>>,
    deny_globs: Option<Vec<String>>,
    shell: Option<ShellPolicy>,
}

#[derive(Debug, Default, Deserialize)]
struct ShellPolicy {
    enabled: Option<bool>,
}

#[derive(Debug)]
struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    body: String,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("[bridge-rs] {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--help" || arg == "help") {
        print_help();
        return Ok(());
    }
    if args.first().map(String::as_str) == Some("init") {
        return init_project(&args[1..]);
    }

    let config = load_config();
    fs::create_dir_all(&config.data_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&config.log_dir).map_err(|err| err.to_string())?;

    let port = http_port(&args);
    eprintln!("[bridge-rs] {SERVICE} v{VERSION} starting");
    eprintln!("[bridge-rs] Data dir: {}", config.data_dir.display());
    eprintln!("[bridge-rs] Local console: http://127.0.0.1:{port}/app");
    start_http(config, port)
}

fn print_help() {
    println!(
        "ChatGPT2LocalBridge RS\n\nUsage:\n  chatgpt2localbridge-rs init --root <workspace-root> [--public-url <url>]\n  chatgpt2localbridge-rs --http 3838\n\nThis Rust build currently provides health, local console, activity APIs, and a minimal MCP smoke surface."
    );
}

fn init_project(args: &[String]) -> Result<(), String> {
    let root = option_value(args, "--root").unwrap_or_else(|| ".".to_string());
    let public_url = option_value(args, "--public-url")
        .unwrap_or_else(|| "https://YOUR-FIXED-DOMAIN.ngrok-free.dev".to_string());
    let force = args.iter().any(|arg| arg == "--force");
    let root_path = expand_home(&root)
        .canonicalize()
        .map_err(|_| format!("Workspace root does not exist: {root}"))?;

    write_if_missing(
        Path::new("bridge.policy.json"),
        &format!(
            concat!(
                "{{\n",
                "  \"allowedProjectRoots\": [\n",
                "    \"{}\"\n",
                "  ],\n",
                "  \"skillRoots\": [\n",
                "    \"{}\"\n",
                "  ],\n",
                "  \"denyGlobs\": [\"**/.env\", \"**/.env.*\", \"**/*.pem\", \"**/*.key\", \"**/.ssh/**\"],\n",
                "  \"shell\": {{\n",
                "    \"enabled\": true,\n",
                "    \"denyPatterns\": [\"sudo\", \"rm\\\\s+-rf\\\\s+/\", \"chmod\\\\s+-R\", \"chown\\\\s+-R\"]\n",
                "  }}\n",
                "}}\n"
            ),
            json_escape(&root_path.to_string_lossy()),
            json_escape(&home_dir().join(".codex").join("skills").to_string_lossy())
        ),
        force,
    )?;

    let home = home_dir();
    let data_dir = home.join(".chatgpt2localbridge");
    write_if_missing(
        Path::new(".env.local"),
        &format!(
            concat!(
                "export LOCALBRIDGE_PORT=3838\n",
                "export LOCALBRIDGE_DATA_DIR=\"{}\"\n",
                "export LOCALBRIDGE_LOG_DIR=\"{}/logs\"\n",
                "export LOCALBRIDGE_POLICY_PATH=\"$PWD/bridge.policy.json\"\n",
                "export LOCALBRIDGE_PUBLIC_BASE_URL=\"{}\"\n",
                "export LOCALBRIDGE_OAUTH_ENABLED=1\n",
                "export LOCALBRIDGE_OAUTH_UNLOCK_CODE=\"{}\"\n",
                "export LOCALBRIDGE_DASHBOARD_TOKEN=\"{}\"\n"
            ),
            shell_escape(&data_dir.to_string_lossy()),
            shell_escape(&data_dir.to_string_lossy()),
            shell_escape(&public_url),
            random_hex(24)?,
            random_hex(24)?
        ),
        force,
    )?;

    println!("Created local bridge files for {}", root_path.display());
    println!("Run: set -a; source .env.local; set +a");
    println!(
        "Run: cargo run --manifest-path rust/chatgpt2localbridge-rs/Cargo.toml -- --http 3838"
    );
    Ok(())
}

fn write_if_missing(path: &Path, content: &str, force: bool) -> Result<(), String> {
    if path.exists() && !force {
        println!("Kept existing {}", path.display());
        return Ok(());
    }
    fs::write(path, content).map_err(|err| format!("Failed to write {}: {err}", path.display()))?;
    println!("Wrote {}", path.display());
    Ok(())
}

fn start_http(config: Config, port: u16) -> Result<(), String> {
    let listener = TcpListener::bind(("0.0.0.0", port))
        .map_err(|err| format!("Failed to listen on port {port}: {err}"))?;
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let cfg = config.clone();
                std::thread::spawn(move || {
                    if let Err(err) = handle_connection(stream, &cfg) {
                        eprintln!("[bridge-rs] request error: {err}");
                    }
                });
            }
            Err(err) => eprintln!("[bridge-rs] connection error: {err}"),
        }
    }
    Ok(())
}

fn handle_connection(mut stream: TcpStream, config: &Config) -> Result<(), String> {
    let request = read_request(&mut stream)?;
    if request.method == "OPTIONS" {
        return respond(&mut stream, 204, "text/plain", "");
    }

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => respond_json(
            &mut stream,
            200,
            &json!({
                "status": "ok",
                "service": SERVICE,
                "version": VERSION
            })
            .to_string(),
        ),
        ("GET", "/app") | ("GET", "/app/") => respond(
            &mut stream,
            200,
            "text/html; charset=utf-8",
            &render_dashboard(),
        ),
        ("GET", "/app/api/status") => {
            if !dashboard_authorized(&request, config) {
                return respond_json(
                    &mut stream,
                    401,
                    &json!({"error": "Dashboard token required"}).to_string(),
                );
            }
            respond_json(&mut stream, 200, &status_json(config))
        }
        ("GET", "/app/api/activity") => {
            if !dashboard_authorized(&request, config) {
                return respond_json(
                    &mut stream,
                    401,
                    &json!({"error": "Dashboard token required"}).to_string(),
                );
            }
            let limit = request
                .query
                .get("limit")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(100)
                .clamp(1, 500);
            respond_json(&mut stream, 200, &activity_json(config, limit))
        }
        ("POST", "/mcp") => respond_json(&mut stream, 200, &handle_mcp(&request.body, config)),
        _ => respond_json(
            &mut stream,
            404,
            &json!({
                "error": "Not found",
                "endpoints": ["/health", "/app", "/mcp"]
            })
            .to_string(),
        ),
    }
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|err| err.to_string())?;
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let count = stream.read(&mut chunk).map_err(|err| err.to_string())?;
        if count == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..count]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            let content_length = header_content_length(&buffer);
            let header_end = header_end(&buffer).unwrap_or(buffer.len());
            if buffer.len() >= header_end + content_length {
                break;
            }
        }
        if buffer.len() > 2_000_000 {
            return Err("request too large".to_string());
        }
    }

    let text = String::from_utf8_lossy(&buffer);
    let header_end = text
        .find("\r\n\r\n")
        .ok_or_else(|| "missing HTTP header terminator".to_string())?;
    let (head, body_with_sep) = text.split_at(header_end);
    let body = body_with_sep.trim_start_matches("\r\n\r\n").to_string();
    let mut lines = head.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "missing request line".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/");
    let (path, query) = parse_target(target);
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    Ok(Request {
        method,
        path,
        query,
        headers,
        body,
    })
}

fn header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|pos| pos + 4)
}

fn header_content_length(buffer: &[u8]) -> usize {
    let header_end = match header_end(buffer) {
        Some(value) => value,
        None => return 0,
    };
    let text = String::from_utf8_lossy(&buffer[..header_end]);
    for line in text.lines() {
        if let Some((key, value)) = line.split_once(':') {
            if key.trim().eq_ignore_ascii_case("content-length") {
                return value.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }
    0
}

fn parse_target(target: &str) -> (String, HashMap<String, String>) {
    let (path, query_raw) = target.split_once('?').unwrap_or((target, ""));
    let mut query = HashMap::new();
    for pair in query_raw.split('&').filter(|part| !part.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        query.insert(percent_decode(key), percent_decode(value));
    }
    (path.to_string(), query)
}

fn respond_json(stream: &mut TcpStream, status: u16, body: &str) -> Result<(), String> {
    respond(stream, status, "application/json", body)
}

fn respond(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
) -> Result<(), String> {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        _ => "OK",
    };
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Accept, Authorization, X-LocalBridge-Token, X-LocalBridge-Dashboard-Token\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|err| err.to_string())
}

fn load_config() -> Config {
    let data_dir = env_prefixed("DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".chatgpt2localbridge-rs"));
    let log_dir = env_prefixed("LOG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| data_dir.join("logs"));
    let policy_path = env_prefixed("POLICY_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("bridge.policy.json"));
    Config {
        data_dir,
        log_dir,
        public_base_url: env_prefixed("PUBLIC_BASE_URL"),
        dashboard_token: env_prefixed("DASHBOARD_TOKEN"),
        oauth_enabled: matches!(
            env_prefixed("OAUTH_ENABLED").as_deref(),
            Some("1" | "true" | "TRUE")
        ),
        policy: load_policy(&policy_path),
    }
}

fn load_policy(path: &Path) -> Policy {
    let default = Policy {
        allowed_project_roots: vec![home_dir()],
        skill_roots: vec![home_dir().join(".codex").join("skills")],
        deny_globs: vec![
            "**/.env".to_string(),
            "**/.env.*".to_string(),
            "**/*.pem".to_string(),
            "**/*.key".to_string(),
            "**/.ssh/**".to_string(),
        ],
        shell_enabled: true,
    };
    let raw = match fs::read_to_string(path) {
        Ok(value) => value,
        Err(_) => return default,
    };
    let parsed = serde_json::from_str::<PolicyFile>(&raw).unwrap_or_default();
    let roots = parsed
        .allowed_project_roots
        .unwrap_or_default()
        .into_iter()
        .map(|root| expand_home(&root))
        .collect::<Vec<_>>();
    let skill_roots = parsed
        .skill_roots
        .unwrap_or_default()
        .into_iter()
        .map(|root| expand_home(&root))
        .collect::<Vec<_>>();
    let deny_globs = parsed.deny_globs.unwrap_or_default();
    let shell_enabled = parsed
        .shell
        .and_then(|shell| shell.enabled)
        .unwrap_or(default.shell_enabled);
    Policy {
        allowed_project_roots: if roots.is_empty() {
            default.allowed_project_roots
        } else {
            roots
        },
        skill_roots: if skill_roots.is_empty() {
            default.skill_roots
        } else {
            skill_roots
        },
        deny_globs: if deny_globs.is_empty() {
            default.deny_globs
        } else {
            deny_globs
        },
        shell_enabled,
    }
}

fn status_json(config: &Config) -> String {
    json!({
        "service": SERVICE,
        "version": VERSION,
        "oauthEnabled": config.oauth_enabled,
        "publicBaseUrl": config.public_base_url,
        "dataDir": config.data_dir,
        "logDir": config.log_dir,
        "allowedProjectRoots": config.policy.allowed_project_roots,
        "skillRoots": config.policy.skill_roots,
        "denyGlobs": config.policy.deny_globs,
        "shellEnabled": config.policy.shell_enabled,
        "dashboardTokenConfigured": config.dashboard_token.is_some()
    })
    .to_string()
}

fn activity_json(config: &Config, limit: usize) -> String {
    let calls = read_jsonl_recent(&config.data_dir.join("tool-calls.jsonl"), limit);
    let audit = read_jsonl_recent(&config.data_dir.join("audit.jsonl"), limit);
    json!({
        "toolCalls": calls,
        "auditEvents": audit
    })
    .to_string()
}

fn dashboard_authorized(request: &Request, config: &Config) -> bool {
    let Some(token) = &config.dashboard_token else {
        return false;
    };
    request
        .headers
        .get("x-localbridge-dashboard-token")
        .map(|value| value == token)
        .unwrap_or(false)
        || request
            .query
            .get("dashboard_token")
            .map(|value| value == token)
            .unwrap_or(false)
}

fn handle_mcp(body: &str, config: &Config) -> String {
    let request = match serde_json::from_str::<Value>(body) {
        Ok(value) => value,
        Err(err) => {
            return json!({
                "jsonrpc": "2.0",
                "id": Value::Null,
                "error": {
                    "code": -32700,
                    "message": "Parse error",
                    "data": err.to_string()
                }
            })
            .to_string();
        }
    };
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");

    match method {
        "initialize" => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": SERVICE,
                    "version": VERSION
                }
            }
        })
        .to_string(),
        "tools/list" => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "tools": mcp_tools_value()
            }
        })
        .to_string(),
        "tools/call" => {
            let params = request.get("params").unwrap_or(&Value::Null);
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));

            append_tool_record(config, name, "started", None, &args, None, None);
            let result = match name {
                "bridge.health" => Ok(mcp_tool_result(
                    "local: ok 200\nrust: ok",
                    json!({
                        "status": "ok",
                        "service": SERVICE,
                        "version": VERSION
                    }),
                )),
                "bridge.activity" => Ok(mcp_tool_result(
                    "Activity loaded.",
                    serde_json::from_str::<Value>(&activity_json(config, 50))
                        .unwrap_or_else(|_| json!({})),
                )),
                "file.list" => file_list_tool(&args, config).map(|text| {
                    mcp_tool_result(
                        &text,
                        json!({
                            "textPreview": text
                        }),
                    )
                }),
                "" => Err("tools/call params.name is required".to_string()),
                _ => Err(format!("Unknown Rust MCP smoke tool: {name}")),
            };

            match result {
                Ok(payload) => {
                    append_tool_record(config, name, "ok", Some(0), &args, Some(json!({})), None);
                    json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": payload
                    })
                    .to_string()
                }
                Err(err) => {
                    append_tool_record(config, name, "error", Some(0), &args, None, Some(&err));
                    json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "isError": true,
                            "content": [
                                {
                                    "type": "text",
                                    "text": err
                                }
                            ]
                        }
                    })
                    .to_string()
                }
            }
        }
        _ => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": "method not implemented in Rust smoke server"
            }
        })
        .to_string(),
    }
}

fn mcp_tools_value() -> Value {
    json!([
        {
            "name": "bridge.health",
            "description": "Rust smoke health check",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "bridge.activity",
            "description": "Read Rust/Node bridge activity files",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "file.list",
            "description": "List files in an approved project root",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "projectPath": {
                        "type": "string"
                    },
                    "dir": {
                        "type": "string",
                        "default": "."
                    },
                    "maxEntries": {
                        "type": "number",
                        "default": 50,
                        "minimum": 1,
                        "maximum": 500
                    }
                },
                "required": ["projectPath"]
            }
        }
    ])
}

fn mcp_tool_result(text: &str, structured: Value) -> Value {
    json!({
        "content": [
            {
                "type": "text",
                "text": text
            }
        ],
        "structuredContent": structured
    })
}

fn file_list_tool(args: &Value, config: &Config) -> Result<String, String> {
    let project_path = args
        .get("projectPath")
        .and_then(Value::as_str)
        .ok_or_else(|| "projectPath is required".to_string())?;
    let dir = args.get("dir").and_then(Value::as_str).unwrap_or(".");
    let max_entries = args
        .get("maxEntries")
        .and_then(Value::as_i64)
        .unwrap_or(50)
        .clamp(1, 500) as usize;
    let project = PathBuf::from(project_path);
    if !path_allowed(&project, &config.policy.allowed_project_roots) {
        return Err("projectPath is outside allowedProjectRoots".to_string());
    }
    let target = project.join(dir);
    if path_denied(&target, &config.policy.deny_globs) {
        return Err("target is denied by denyGlobs".to_string());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&target).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        if path_denied(&entry.path(), &config.policy.deny_globs) {
            continue;
        }
        let file_type = entry.file_type().map_err(|err| err.to_string())?;
        let kind = if file_type.is_dir() {
            "directory"
        } else {
            "file"
        };
        entries.push(format!(
            "{:<9} {}",
            kind,
            entry.file_name().to_string_lossy()
        ));
        if entries.len() >= max_entries {
            break;
        }
    }
    entries.sort();
    Ok(entries.join("\n"))
}

fn path_allowed(path: &Path, allowed_roots: &[PathBuf]) -> bool {
    let canonical = match path.canonicalize() {
        Ok(value) => value,
        Err(_) => return false,
    };
    allowed_roots.iter().any(|root| {
        root.canonicalize()
            .map(|allowed| canonical.starts_with(allowed))
            .unwrap_or(false)
    })
}

fn path_denied(path: &Path, deny_globs: &[String]) -> bool {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();

    deny_globs.iter().any(|pattern| {
        let pattern = pattern.as_str();
        match pattern {
            "**/.env" => file_name == ".env",
            "**/.env.*" => file_name.starts_with(".env."),
            "**/*.pem" => file_name.ends_with(".pem"),
            "**/*.key" => file_name.ends_with(".key"),
            "**/*.p12" => file_name.ends_with(".p12"),
            "**/*.pfx" => file_name.ends_with(".pfx"),
            "**/.npmrc" => file_name == ".npmrc",
            "**/.netrc" => file_name == ".netrc",
            "**/.ssh/**" => normalized.contains("/.ssh/") || normalized.ends_with("/.ssh"),
            "**/id_rsa" => file_name == "id_rsa",
            "**/id_ed25519" => file_name == "id_ed25519",
            _ => {
                if let Some(suffix) = pattern.strip_prefix("**/*") {
                    file_name.ends_with(suffix)
                } else if let Some(name) = pattern.strip_prefix("**/") {
                    file_name == name
                } else {
                    normalized == pattern
                }
            }
        }
    })
}

fn append_tool_record(
    config: &Config,
    tool: &str,
    status: &str,
    duration_ms: Option<u128>,
    args: &Value,
    result: Option<Value>,
    error: Option<&str>,
) {
    let _ = fs::create_dir_all(&config.data_dir);
    let file = config.data_dir.join("tool-calls.jsonl");
    let mut record = json!({
        "id": format!("rs-{}", randomish_id()),
        "ts": iso_timestamp(),
        "tool": tool,
        "status": status,
        "args": args
    });
    if let Some(duration) = duration_ms {
        record["durationMs"] = json!(duration.min(u64::MAX as u128) as u64);
    }
    if let Some(result) = result {
        record["result"] = result;
    }
    if let Some(error) = error {
        record["error"] = json!(error);
    }
    let record = format!("{record}\n");
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .mode_compat(0o600)
        .open(file)
        .and_then(|mut handle| handle.write_all(record.as_bytes()));
}

trait OpenOptionsModeCompat {
    fn mode_compat(&mut self, mode: u32) -> &mut Self;
}

impl OpenOptionsModeCompat for fs::OpenOptions {
    #[cfg(unix)]
    fn mode_compat(&mut self, mode: u32) -> &mut Self {
        use std::os::unix::fs::OpenOptionsExt;
        self.mode(mode)
    }

    #[cfg(not(unix))]
    fn mode_compat(&mut self, _mode: u32) -> &mut Self {
        self
    }
}

fn render_dashboard() -> String {
    let html = r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ChatGPT2LocalBridge RS Console</title>
  <style>
    :root{color-scheme:light;--ink:#18211f;--soft:#5b6965;--line:#ccd8d4;--paper:#eef3f1;--panel:#fff;--rail:#22302d;--green:#0f7b68;--amber:#a96c18;--red:#b64242;--shadow:0 18px 50px rgba(22,35,32,.08)}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#eef3f1 0,#f8faf9 48%,#eef3f1 100%);color:var(--ink);font-family:Avenir Next,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgba(24,33,31,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(24,33,31,.03) 1px,transparent 1px);background-size:28px 28px;mask-image:linear-gradient(#000,transparent 72%)}
    header{position:sticky;top:0;z-index:2;border-bottom:1px solid var(--line);background:rgba(248,250,249,.9);backdrop-filter:blur(16px)}.topbar{max-width:1240px;margin:0 auto;padding:14px 20px;display:grid;grid-template-columns:minmax(240px,1fr) auto;gap:18px;align-items:center}
    h1{margin:0;font-size:18px}.kicker{margin-top:3px;color:var(--soft);font-size:12px}.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.input{height:38px;width:min(380px,46vw);border:1px solid var(--line);border-radius:8px;padding:0 12px;background:#fff;font:inherit;font-size:13px}
    button{height:38px;border:1px solid var(--rail);border-radius:8px;background:var(--rail);color:#fff;font-weight:760;padding:0 13px;cursor:pointer;font:inherit;font-size:13px}.secondary{border-color:var(--line);background:#fff;color:var(--ink)}
    .shell{max-width:1240px;margin:0 auto;padding:20px}.status-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric{min-height:96px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.88);box-shadow:var(--shadow);padding:14px;display:grid;align-content:space-between}.label{color:var(--soft);font-size:12px;font-weight:720;text-transform:uppercase}.value{font-size:24px;font-weight:820}.note{color:var(--soft);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .layout{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px;margin-top:14px}.card{border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:var(--shadow);padding:16px}.card h2{font-size:14px;margin:0 0 12px}.kv{display:grid;grid-template-columns:136px minmax(0,1fr);gap:9px 12px;font-size:13px}.kv div:nth-child(odd){color:var(--soft);font-weight:700}.path,code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.path{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.root{border:1px solid var(--line);border-radius:8px;padding:10px 11px;background:#f8fbfa;font-size:12px;margin-bottom:8px}
    table{width:100%;border-collapse:separate;border-spacing:0;margin-top:10px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:12px}th{background:#edf4f1;color:#42524e;font-size:11px;text-transform:uppercase}.ok{color:var(--green);font-weight:760}.error{color:var(--red);font-weight:760}.started{color:var(--amber);font-weight:760}pre{white-space:pre-wrap;margin:0;max-height:132px;overflow:auto}.empty{padding:22px;border:1px dashed var(--line);border-radius:8px;color:var(--soft);font-size:13px;text-align:center;background:#fbfcfc}.hidden{display:none!important}
    @media(max-width:980px){.topbar,.layout{grid-template-columns:1fr}.toolbar{justify-content:flex-start}.input{width:100%}.status-strip{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.shell{padding:14px}.status-strip{grid-template-columns:1fr}.kv{grid-template-columns:1fr}th:nth-child(4),td:nth-child(4){display:none}}
  </style>
</head>
<body>
  <header><div class="topbar"><div><h1>ChatGPT2LocalBridge RS</h1><div class="kicker">Rust-native local operations console</div></div><div class="toolbar"><input id="token" class="input" type="password" placeholder="LOCALBRIDGE_DASHBOARD_TOKEN"><button id="save">Save</button><button class="secondary" id="clear">Clear</button><button class="secondary" id="refresh">Refresh</button></div></div></header>
  <main class="shell">
    <section class="status-strip"><article class="metric"><div class="label">Service</div><div class="value" id="metric-service">Waiting</div><div class="note" id="metric-version">-</div></article><article class="metric"><div class="label">OAuth</div><div class="value" id="metric-oauth">-</div><div class="note" id="metric-public">-</div></article><article class="metric"><div class="label">Workspace Roots</div><div class="value" id="metric-roots">-</div><div class="note">approved filesystem scope</div></article><article class="metric"><div class="label">Activity</div><div class="value" id="metric-activity">-</div><div class="note" id="metric-audit">-</div></article></section>
    <section class="layout"><article class="card"><h2>Runtime</h2><div class="kv" id="runtime"></div></article><article class="card"><h2>Roots</h2><div id="roots"></div></article></section>
    <section class="card" style="margin-top:14px"><h2>Tool Calls <span id="calls-pill"></span></h2><table><thead><tr><th>Time</th><th>Tool</th><th>Status</th><th>Duration</th><th>Summary</th></tr></thead><tbody id="calls"></tbody></table><div class="empty hidden" id="calls-empty">No tool calls recorded yet.</div></section>
    <section class="card" style="margin-top:14px"><h2>Audit Events <span id="audit-pill"></span></h2><table><thead><tr><th>Time</th><th>Action</th><th>Data</th></tr></thead><tbody id="audit"></tbody></table><div class="empty hidden" id="audit-empty">No audit events recorded yet.</div></section>
  </main>
  <script>
    const params = new URLSearchParams(location.search); const queryToken = params.get('dashboard_token');
    if (queryToken) { localStorage.setItem('localbridge.rs.dashboardToken', queryToken); history.replaceState(null, '', location.pathname); }
    const tokenInput = document.getElementById('token'); tokenInput.value = queryToken || localStorage.getItem('localbridge.rs.dashboardToken') || '';
    document.getElementById('save').onclick = () => { localStorage.setItem('localbridge.rs.dashboardToken', tokenInput.value); load(); };
    document.getElementById('clear').onclick = () => { tokenInput.value = ''; localStorage.removeItem('localbridge.rs.dashboardToken'); load(); };
    document.getElementById('refresh').onclick = () => load();
    async function api(path) { const token = tokenInput.value; const res = await fetch(path, {headers: token ? {'x-localbridge-dashboard-token': token} : {}}); if (!res.ok) throw new Error(await res.text()); return res.json(); }
    async function load() { try { const status = await api('/app/api/status'); renderStatus(status); const activity = await api('/app/api/activity?limit=120'); renderCalls(activity.toolCalls || []); renderAudit(activity.auditEvents || []); } catch (err) { document.getElementById('metric-service').textContent = 'Locked'; document.getElementById('runtime').innerHTML = '<div>Console</div><div>'+esc(err.message || err)+'</div>'; renderCalls([]); renderAudit([]); } }
    function renderStatus(s) { document.getElementById('metric-service').textContent='Online'; document.getElementById('metric-version').textContent=s.service+' '+s.version; document.getElementById('metric-oauth').textContent=s.oauthEnabled?'Enabled':'Off'; document.getElementById('metric-public').textContent=s.publicBaseUrl||'local only'; document.getElementById('metric-roots').textContent=String((s.allowedProjectRoots||[]).length); document.getElementById('runtime').innerHTML=[['Public URL',s.publicBaseUrl||'not configured'],['Data dir',s.dataDir],['Log dir',s.logDir],['OAuth',s.oauthEnabled?'enabled':'off'],['Dashboard token',s.dashboardTokenConfigured?'configured':'missing'],['Shell',s.shellEnabled?'enabled':'off']].map(([k,v])=>'<div>'+esc(k)+'</div><div class="path" title="'+esc(v)+'">'+esc(v)+'</div>').join(''); document.getElementById('roots').innerHTML=(s.allowedProjectRoots||[]).map(r=>'<div class="root path" title="'+esc(r)+'">'+esc(r)+'</div>').join('')||'<div class="empty">No approved roots.</div>'; }
    function renderCalls(records) { document.getElementById('metric-activity').textContent=String(records.length); document.getElementById('calls-pill').textContent=records.length+' records'; document.getElementById('calls').closest('table').classList.toggle('hidden', records.length===0); document.getElementById('calls-empty').classList.toggle('hidden', records.length!==0); document.getElementById('calls').innerHTML=records.map(r=>'<tr><td>'+esc(formatTime(r.ts))+'</td><td><code>'+esc(r.tool)+'</code></td><td class="'+esc(r.status)+'">'+esc(r.status)+'</td><td>'+esc(r.durationMs==null?'-':r.durationMs+' ms')+'</td><td><pre>'+esc(JSON.stringify(r.args||r.result||r.error||{},null,2))+'</pre></td></tr>').join(''); }
    function renderAudit(records) { document.getElementById('metric-audit').textContent=records.length+' audit events'; document.getElementById('audit-pill').textContent=records.length+' records'; document.getElementById('audit').closest('table').classList.toggle('hidden', records.length===0); document.getElementById('audit-empty').classList.toggle('hidden', records.length!==0); document.getElementById('audit').innerHTML=records.map(r=>'<tr><td>'+esc(formatTime(r.ts))+'</td><td><code>'+esc(r.action)+'</code></td><td><pre>'+esc(JSON.stringify(r,null,2))+'</pre></td></tr>').join(''); }
    function formatTime(v){const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString()} function esc(v){return String(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
    if (tokenInput.value) load();
  </script>
</body>
</html>"#;
    html.to_string()
}

fn http_port(args: &[String]) -> u16 {
    if let Some(value) = option_value(args, "--http") {
        return value.parse().unwrap_or(3838);
    }
    env_prefixed("PORT")
        .and_then(|value| value.parse().ok())
        .unwrap_or(3838)
}

fn option_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

fn env_prefixed(name: &str) -> Option<String> {
    env::var(format!("LOCALBRIDGE_{name}")).ok()
}

fn home_dir() -> PathBuf {
    if let Ok(home) = env::var("HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home);
        }
    }
    if let Ok(user) = env::var("USER") {
        if !user.trim().is_empty() {
            return PathBuf::from("/Users").join(user);
        }
    }
    PathBuf::from(".")
}

fn expand_home(value: &str) -> PathBuf {
    if value == "~" {
        return home_dir();
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(value)
}

fn read_jsonl_recent(path: &Path, limit: usize) -> Vec<Value> {
    let raw = match fs::read_to_string(path) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let mut lines = raw
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect::<Vec<_>>();
    if lines.len() > limit {
        lines = lines.split_off(lines.len() - limit);
    }
    lines.reverse();
    lines
}

fn json_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn shell_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn percent_decode(value: &str) -> String {
    let mut out = String::new();
    let mut chars = value.as_bytes().iter().copied().peekable();
    while let Some(ch) = chars.next() {
        if ch == b'%' {
            let hi = chars.next();
            let lo = chars.next();
            if let (Some(hi), Some(lo)) = (hi, lo) {
                if let Ok(byte) = u8::from_str_radix(&format!("{}{}", hi as char, lo as char), 16) {
                    out.push(byte as char);
                    continue;
                }
            }
        }
        out.push(if ch == b'+' { ' ' } else { ch as char });
    }
    out
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut file = fs::File::open("/dev/urandom").map_err(|err| err.to_string())?;
    let mut buf = vec![0_u8; bytes];
    file.read_exact(&mut buf).map_err(|err| err.to_string())?;
    Ok(buf.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn randomish_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

fn iso_timestamp() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    let total = duration.as_secs() as i64;
    let millis = duration.subsec_millis();
    let days = total.div_euclid(86_400);
    let seconds_of_day = total.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3600;
    let minute = (seconds_of_day % 3600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_policy_with_serde() {
        let raw = r#"{
            "allowedProjectRoots": ["/tmp/a", "/tmp/b"],
            "denyGlobs": ["**/.env"],
            "shell": { "enabled": false }
        }"#;
        let parsed = serde_json::from_str::<PolicyFile>(raw).expect("valid policy json");
        assert_eq!(
            parsed.allowed_project_roots,
            Some(vec!["/tmp/a".to_string(), "/tmp/b".to_string()])
        );
        assert_eq!(parsed.deny_globs, Some(vec!["**/.env".to_string()]));
        assert_eq!(parsed.shell.and_then(|shell| shell.enabled), Some(false));
    }

    #[test]
    fn reads_recent_jsonl_objects() {
        let path = env::temp_dir().join(format!("chatgpt2localbridge-rs-{}.jsonl", randomish_id()));
        fs::write(
            &path,
            "{\"id\":\"a\"}\nnot-json\n{\"id\":\"b\"}\n{\"id\":\"c\"}\n",
        )
        .expect("write temp jsonl");

        let values = read_jsonl_recent(&path, 2);
        let _ = fs::remove_file(&path);
        assert_eq!(values.len(), 2);
        assert_eq!(values[0]["id"], "c");
        assert_eq!(values[1]["id"], "b");
    }

    #[test]
    fn denies_sensitive_paths() {
        let deny = vec![
            "**/.env".to_string(),
            "**/.env.*".to_string(),
            "**/*.pem".to_string(),
            "**/.ssh/**".to_string(),
        ];

        assert!(path_denied(Path::new("/repo/.env.local"), &deny));
        assert!(path_denied(Path::new("/repo/key.pem"), &deny));
        assert!(path_denied(Path::new("/repo/.ssh/config"), &deny));
        assert!(!path_denied(Path::new("/repo/src/main.rs"), &deny));
    }

    #[test]
    fn timestamps_are_iso_like() {
        let value = iso_timestamp();
        assert!(value.ends_with('Z'));
        assert!(value.contains('T'));
    }
}
