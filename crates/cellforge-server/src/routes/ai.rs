//! AI proxy — forwards chat requests to the user's chosen provider API.
//! The API key is sent from the frontend per-request (stored in localStorage,
//! never persisted on our server). We just proxy to avoid CORS issues.

use crate::routes::auth::extract_user;
use crate::state::AppState;
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Hosts that the AI proxy is allowed to forward requests to. Prevents SSRF —
/// an authenticated user could otherwise use the server as a proxy to hit
/// arbitrary internal/external URLs. Localhost is included so Ollama works.
const ALLOWED_AI_HOSTS: &[&str] = &[
    "api.anthropic.com",
    "api.openai.com",
    "generativelanguage.googleapis.com",
    "api.deepseek.com",
    "api.groq.com",
    "api.mistral.ai",
    "openrouter.ai",
    "localhost",
    "127.0.0.1",
];

/// Extract just the host component from a URL string (no scheme, port, path).
/// Returns None if the URL is malformed. Used for allowlist checking only —
/// doesn't need to be a full RFC-3986 parser.
fn parse_host(base_url: &str) -> Option<&str> {
    // strip scheme
    let rest = base_url
        .split_once("://")
        .map(|(_, r)| r)
        .unwrap_or(base_url);
    // strip userinfo
    let rest = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
    // take up to first '/', '?', or '#'
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let hostport = &rest[..end];
    // strip port
    let host = hostport
        .rsplit_once(':')
        .map(|(h, _)| h)
        .unwrap_or(hostport);
    if host.is_empty() { None } else { Some(host) }
}

fn host_is_allowed(base_url: &str) -> bool {
    match parse_host(base_url) {
        Some(h) => ALLOWED_AI_HOSTS.contains(&h),
        None => false,
    }
}

#[derive(Deserialize)]
pub struct AiChatReq {
    pub provider: String, // "anthropic", "openai", "ollama", "custom"
    pub api_key: String,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub messages: Vec<AiMessage>,
    pub system: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct AiChatRes {
    pub ok: bool,
    pub content: Option<String>,
    pub error: Option<String>,
}

pub async fn chat(
    State(_state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<AiChatReq>,
) -> Result<(StatusCode, Json<AiChatRes>), StatusCode> {
    let _username = extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;

    // Validate base_url against allowlist (SSRF prevention). If base_url is not
    // set, the hard-coded provider defaults in call_* are used and are safe.
    if let Some(base_url) = req.base_url.as_deref()
        && !base_url.is_empty()
        && !host_is_allowed(base_url)
    {
        tracing::warn!("ai chat rejected base_url not in allowlist: {}", base_url);
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(AiChatRes {
                ok: false,
                content: None,
                error: Some(format!("base_url host is not in the allowlist: {base_url}")),
            }),
        ));
    }

    if req.api_key.is_empty() && req.provider != "ollama" {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(AiChatRes {
                ok: false,
                content: None,
                error: Some("API key is required".into()),
            }),
        ));
    }

    let model = req.model.as_deref().unwrap_or("default");
    tracing::info!(
        "AI chat: provider={}, model={}, messages={}",
        req.provider,
        model,
        req.messages.len()
    );

    let start = std::time::Instant::now();
    let result = match req.provider.as_str() {
        "anthropic" => call_anthropic(&req).await,
        "openai" => call_openai(&req).await,
        "ollama" => call_ollama(&req).await,
        "custom" => call_openai_compat(&req).await,
        _ => Err(format!("Unknown provider: {}", req.provider)),
    };
    let elapsed = start.elapsed();

    match &result {
        Ok(content) => tracing::info!(
            "AI response: {}ms, {} chars",
            elapsed.as_millis(),
            content.len()
        ),
        Err(e) => tracing::error!("AI error after {}ms: {}", elapsed.as_millis(), e),
    }

    match result {
        Ok(content) => Ok((
            StatusCode::OK,
            Json(AiChatRes {
                ok: true,
                content: Some(content),
                error: None,
            }),
        )),
        Err(e) => Ok((
            StatusCode::OK,
            Json(AiChatRes {
                ok: false,
                content: None,
                error: Some(e),
            }),
        )),
    }
}

async fn call_anthropic(req: &AiChatReq) -> Result<String, String> {
    let model = req.model.as_deref().unwrap_or("claude-sonnet-4-20250514");
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "system": req.system.as_deref().unwrap_or("You are a helpful coding assistant in a Jupyter-style notebook."),
        "messages": req.messages,
    });

    let client = http_client();
    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &req.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = res.status();
    let text = res.text().await.map_err(|e| format!("read body: {e}"))?;
    if !status.is_success() {
        return Err(format!("Anthropic API {status}: {text}"));
    }

    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("parse: {e}"))?;
    let content = json["content"][0]["text"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(content)
}

async fn call_openai(req: &AiChatReq) -> Result<String, String> {
    call_openai_at("https://api.openai.com/v1/chat/completions", req).await
}

async fn call_ollama(req: &AiChatReq) -> Result<String, String> {
    let base = req.base_url.as_deref().unwrap_or("http://localhost:11434");
    let url = format!("{base}/api/chat");

    let body = serde_json::json!({
        "model": req.model.as_deref().unwrap_or("llama3"),
        "messages": req.messages,
        "stream": false,
    });

    let client = http_client();
    let res = client
        .post(&url)
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let text = res.text().await.map_err(|e| format!("read body: {e}"))?;
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("parse: {e}"))?;
    let content = json["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(content)
}

async fn call_openai_compat(req: &AiChatReq) -> Result<String, String> {
    let base = req
        .base_url
        .as_deref()
        .unwrap_or("https://api.openai.com/v1");
    let url = format!("{base}/chat/completions");
    call_openai_at(&url, req).await
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

async fn call_openai_at(url: &str, req: &AiChatReq) -> Result<String, String> {
    let model = req.model.as_deref().unwrap_or("gpt-4o-mini");
    let mut messages = vec![];
    if let Some(sys) = &req.system {
        messages.push(serde_json::json!({"role": "system", "content": sys}));
    }
    for m in &req.messages {
        messages.push(serde_json::json!({"role": m.role, "content": m.content}));
    }

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "max_tokens": 4096,
    });

    tracing::debug!("OpenAI-compat POST {} model={}", url, model);

    let client = http_client();
    let res = client
        .post(url)
        .header("authorization", format!("Bearer {}", req.api_key))
        .header("content-type", "application/json")
        // OpenRouter / other providers may want these
        .header("http-referer", "https://cellforge.app")
        .header("x-title", "CellForge")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = res.status();
    let text = res.text().await.map_err(|e| format!("read body: {e}"))?;

    tracing::debug!("OpenAI-compat response: {} ({} bytes)", status, text.len());

    if !status.is_success() {
        return Err(format!("API {status}: {text}"));
    }

    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("parse: {e}"))?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(content)
}
