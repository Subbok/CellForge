pub mod admin;
pub mod ai;
pub mod auth;
pub mod dashboard;
pub mod export;
pub mod fileops;
pub mod files;
pub mod git;
pub mod kernels;
pub mod notebooks;

#[cfg(test)]
mod tests;

use crate::state::AppState;
use axum::Json;
use axum::extract::State;
use axum::http::HeaderMap;
use serde::Serialize;
use std::sync::Arc;

#[derive(Serialize)]
pub struct AppConfig {
    notebook_dir: String,
    initial_notebook: Option<String>,
}

/// Best-effort client identifier string for logging and rate-limit keying.
/// Reads `X-Forwarded-For` ONLY when the operator has explicitly set
/// `CELLFORGE_TRUST_XFF=1` — otherwise any request could spoof the header.
/// The env-var opt-in assumes the operator has put a trusted proxy in front
/// (Cloudflare Tunnel, nginx, Traefik) that strips client-supplied XFF and
/// sets its own.
/// Returns `"unknown"` when no trustworthy source is available — callers
/// should treat that string as an opaque bucket (all "unknown" clients share
/// one rate-limit slot, which is fine for a v1 implementation).
pub fn client_ip(headers: &HeaderMap) -> String {
    if std::env::var("CELLFORGE_TRUST_XFF").ok().as_deref() == Some("1")
        && let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok())
        && let Some(first) = xff.split(',').next()
    {
        let trimmed = first.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    "unknown".to_string()
}

/// Resolve a user-supplied relative path against a base directory, rejecting
/// path traversal (e.g. `../../etc/passwd`). Returns the canonical absolute
/// path on success, or `Err(StatusCode::FORBIDDEN)` if the result escapes base.
pub fn safe_resolve(
    base: &std::path::Path,
    relative: &str,
) -> Result<std::path::PathBuf, axum::http::StatusCode> {
    // Reject absolute paths and obvious traversal before any filesystem access
    if relative.starts_with('/') || relative.starts_with('\\') {
        return Err(axum::http::StatusCode::FORBIDDEN);
    }

    let joined = base.join(relative);

    // Canonicalize base (must exist); fail fast if base itself doesn't exist.
    let base_canon = std::fs::canonicalize(base).unwrap_or_else(|_| base.to_path_buf());

    // For existing paths: canonicalize fully (resolves symlinks and ..).
    // Exception: symlinks inside the base dir are allowed (shared files are symlinks
    // pointing to other users' workspaces). Check the *link* location, not the target.
    // If canonicalize fails on an existing path, reject — don't fall back.
    let target_canon = if joined.exists() {
        // If the path is a symlink inside base, allow it even if target is outside
        if joined.is_symlink() {
            let parent = joined.parent().unwrap_or(&joined);
            let parent_canon =
                std::fs::canonicalize(parent).map_err(|_| axum::http::StatusCode::FORBIDDEN)?;
            if parent_canon.starts_with(&base_canon) {
                // Symlink lives inside workspace — resolve to actual target for reading
                return std::fs::canonicalize(&joined)
                    .map_err(|_| axum::http::StatusCode::FORBIDDEN);
            }
        }
        std::fs::canonicalize(&joined).map_err(|_| axum::http::StatusCode::FORBIDDEN)?
    } else if let Some(parent) = joined.parent() {
        let parent_canon = if parent.exists() {
            std::fs::canonicalize(parent).map_err(|_| axum::http::StatusCode::FORBIDDEN)?
        } else {
            // parent doesn't exist yet either — normalize manually
            let mut acc = base_canon.clone();
            for component in std::path::Path::new(relative).components() {
                use std::path::Component;
                match component {
                    Component::Normal(c) => acc.push(c),
                    Component::ParentDir => {
                        if !acc.pop() || !acc.starts_with(&base_canon) {
                            return Err(axum::http::StatusCode::FORBIDDEN);
                        }
                    }
                    Component::CurDir => {}
                    // RootDir / Prefix mean absolute path — reject
                    _ => return Err(axum::http::StatusCode::FORBIDDEN),
                }
            }
            return if acc.starts_with(&base_canon) {
                Ok(acc)
            } else {
                Err(axum::http::StatusCode::FORBIDDEN)
            };
        };
        parent_canon.join(joined.file_name().unwrap_or_default())
    } else {
        return Err(axum::http::StatusCode::FORBIDDEN);
    };

    if !target_canon.starts_with(&base_canon) {
        tracing::warn!(
            "path traversal blocked: {:?} escapes {:?}",
            target_canon,
            base_canon
        );
        return Err(axum::http::StatusCode::FORBIDDEN);
    }
    Ok(target_canon)
}

/// Get the notebook directory for the current user (or fallback to global).
pub fn user_notebook_dir(state: &AppState, headers: &axum::http::HeaderMap) -> std::path::PathBuf {
    auth::extract_user(headers)
        .and_then(|name| state.users.get_user(&name).ok())
        .map(|u| std::path::PathBuf::from(u.workspace_dir))
        .unwrap_or_else(|| state.notebook_dir.clone())
}

pub async fn config(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Json<AppConfig> {
    let notebook_dir = auth::extract_user(&headers)
        .and_then(|name| state.users.get_user(&name).ok())
        .map(|u| format!("/{}/notebooks", u.username))
        .unwrap_or_else(|| state.notebook_dir.to_string_lossy().to_string());

    Json(AppConfig {
        notebook_dir,
        initial_notebook: state
            .initial_notebook
            .as_ref()
            .map(|p| p.to_string_lossy().into()),
    })
}
