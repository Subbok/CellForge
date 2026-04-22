use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::IntoResponse;
use cellforge_auth::jwt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::state::AppState;

/// Detect whether the request came in over HTTPS. Order of checks:
/// 1. `CELLFORGE_COOKIE_SECURE=1` env — force-on opt-in for deployments that
///    know they're TLS-terminated but can't set `X-Forwarded-Proto` (e.g.
///    some Cloudflare Tunnel setups).
/// 2. `X-Forwarded-Proto` header — set by reverse proxies like nginx /
///    Cloudflare / Traefik.
/// 3. Otherwise assume plain HTTP. Safer to skip `Secure` than to set it and
///    have browsers drop the cookie on a localhost dev setup.
fn is_secure_request(headers: &HeaderMap) -> bool {
    if std::env::var("CELLFORGE_COOKIE_SECURE").ok().as_deref() == Some("1") {
        return true;
    }
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("https"))
        .unwrap_or(false)
}

fn auth_cookie(token: &str, headers: &HeaderMap) -> String {
    let secure = if is_secure_request(headers) {
        "; Secure"
    } else {
        ""
    };
    format!("cellforge_token={token}; Path=/; HttpOnly; SameSite=Strict{secure}; Max-Age=604800")
}

fn logout_cookie(headers: &HeaderMap) -> String {
    let secure = if is_secure_request(headers) {
        "; Secure"
    } else {
        ""
    };
    format!("cellforge_token=; Path=/; HttpOnly; SameSite=Strict{secure}; Max-Age=0")
}

#[derive(Deserialize)]
pub struct LoginReq {
    username: String,
    password: String,
}

#[derive(Deserialize)]
pub struct RegisterReq {
    username: String,
    password: String,
    display_name: Option<String>,
}

#[derive(Serialize)]
pub struct AuthResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user: Option<cellforge_auth::db::User>,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<LoginReq>,
) -> impl IntoResponse {
    // Rate-limit key is (normalized username, client ip). Both components
    // are cheap to compute and keep the counter keyed tightly enough that
    // one attacker can't lock out every user by flooding with mixed
    // usernames.
    let rate_key = format!(
        "{}:{}",
        req.username.trim().to_lowercase(),
        crate::routes::client_ip(&headers)
    );

    if let Some(retry_after) = state.check_login_rate(&rate_key) {
        tracing::warn!("login rate-limited key={rate_key} retry_after={retry_after}s");
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(header::RETRY_AFTER, retry_after.to_string())],
            Json(AuthResponse {
                ok: false,
                error: Some(format!("too many failed attempts, retry in {retry_after}s")),
                user: None,
            }),
        )
            .into_response();
    }

    match state.users.login(&req.username, &req.password) {
        Ok(user) => {
            state.clear_login_rate(&rate_key);
            let tv = state.users.user_token_version(&user.username);
            let token = jwt::create_token_with_version(&user.username, tv).unwrap_or_default();
            let cookie = auth_cookie(&token, &headers);

            (
                StatusCode::OK,
                [(header::SET_COOKIE, cookie)],
                Json(AuthResponse {
                    ok: true,
                    error: None,
                    user: Some(user),
                }),
            )
                .into_response()
        }
        Err(e) => {
            state.record_login_failure(&rate_key);
            (
                StatusCode::UNAUTHORIZED,
                Json(AuthResponse {
                    ok: false,
                    error: Some(e.to_string()),
                    user: None,
                }),
            )
                .into_response()
        }
    }
}

pub async fn register(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(req): Json<RegisterReq>,
) -> impl IntoResponse {
    // only admin can create accounts (except the very first user)
    if state.users.has_users() {
        let caller = extract_user(&headers);
        match caller {
            Some(name) => {
                if let Ok(u) = state.users.get_user(&name)
                    && !u.is_admin
                {
                    return (
                        StatusCode::FORBIDDEN,
                        Json(AuthResponse {
                            ok: false,
                            error: Some("only admin can create accounts".into()),
                            user: None,
                        }),
                    )
                        .into_response();
                }
            }
            None => {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(AuthResponse {
                        ok: false,
                        error: Some("login required".into()),
                        user: None,
                    }),
                )
                    .into_response();
            }
        }
    }

    let is_first = !state.users.has_users();
    let display = req.display_name.unwrap_or_else(|| req.username.clone());
    match state.users.register(&req.username, &req.password, &display) {
        Ok(user) => {
            if is_first {
                // first user = self-registration, log them in
                let tv = state.users.user_token_version(&user.username);
                let token = jwt::create_token_with_version(&user.username, tv).unwrap_or_default();
                let cookie = auth_cookie(&token, &headers);
                return (
                    StatusCode::OK,
                    [(header::SET_COOKIE, cookie)],
                    Json(AuthResponse {
                        ok: true,
                        error: None,
                        user: Some(user),
                    }),
                )
                    .into_response();
            }
            // admin creating account — don't change their session
            Json(AuthResponse {
                ok: true,
                error: None,
                user: Some(user),
            })
            .into_response()
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(AuthResponse {
                ok: false,
                error: Some(e.to_string()),
                user: None,
            }),
        )
            .into_response(),
    }
}

pub async fn me(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let username = extract_user(&headers);
    match username {
        Some(name) => match state.users.get_user(&name) {
            Ok(user) => Json(AuthResponse {
                ok: true,
                error: None,
                user: Some(user),
            })
            .into_response(),
            Err(_) => (
                StatusCode::UNAUTHORIZED,
                Json(AuthResponse {
                    ok: false,
                    error: Some("session expired".into()),
                    user: None,
                }),
            )
                .into_response(),
        },
        None => (
            StatusCode::UNAUTHORIZED,
            Json(AuthResponse {
                ok: false,
                error: Some("not logged in".into()),
                user: None,
            }),
        )
            .into_response(),
    }
}

pub async fn logout(headers: HeaderMap) -> impl IntoResponse {
    let cookie = logout_cookie(&headers);
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(AuthResponse {
            ok: true,
            error: None,
            user: None,
        }),
    )
}

pub async fn status(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "has_users": state.users.has_users(),
    }))
}

pub async fn list_users(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let caller = extract_user(&headers);
    let is_admin = caller
        .and_then(|n| state.users.get_user(&n).ok())
        .is_some_and(|u| u.is_admin);
    if !is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "admin only"})),
        )
            .into_response();
    }
    Json(state.users.list_users()).into_response()
}

pub async fn delete_user(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(username): axum::extract::Path<String>,
) -> impl IntoResponse {
    let caller = extract_user(&headers);
    let is_admin = caller
        .and_then(|n| state.users.get_user(&n).ok())
        .is_some_and(|u| u.is_admin);
    if !is_admin {
        return StatusCode::FORBIDDEN;
    }
    let _ = state.users.delete_user(&username);
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
pub struct ChangePasswordReq {
    /// Target user — if omitted, changes the caller's own password.
    pub username: Option<String>,
    pub new_password: String,
}

/// Change password. Users can change their own; admins can change anyone's.
pub async fn change_password(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(req): Json<ChangePasswordReq>,
) -> impl IntoResponse {
    let caller = match extract_user(&headers) {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(AuthResponse {
                    ok: false,
                    error: Some("login required".into()),
                    user: None,
                }),
            )
                .into_response();
        }
    };

    let target = req.username.unwrap_or_else(|| caller.clone());
    let is_admin = state
        .users
        .get_user(&caller)
        .map(|u| u.is_admin)
        .unwrap_or(false);

    // non-admin can only change their own password
    if target != caller && !is_admin {
        return (
            StatusCode::FORBIDDEN,
            Json(AuthResponse {
                ok: false,
                error: Some("only admin can change other users' passwords".into()),
                user: None,
            }),
        )
            .into_response();
    }

    match state.users.change_password(&target, &req.new_password) {
        Ok(()) => Json(AuthResponse {
            ok: true,
            error: None,
            user: None,
        })
        .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(AuthResponse {
                ok: false,
                error: Some(e.to_string()),
                user: None,
            }),
        )
            .into_response(),
    }
}

/// Extract username from the JWT cookie.
/// This is a JWT-only check — it does NOT consult the database for
/// `is_disabled` or `token_version`. Full validation happens in the
/// `active_user_check` middleware (see `lib.rs`), which fires once per
/// request and rejects 401 when the account has been disabled or the
/// token version is stale. Handlers call this to learn the claimed
/// username after the middleware has already vetted the JWT envelope.
/// Kept JWT-only (rather than taking `&AppState`) so it stays cheap in
/// tight loops (e.g. WS message routing) and so existing handlers keep
/// their signatures.
pub fn extract_user(headers: &axum::http::HeaderMap) -> Option<String> {
    extract_claims(headers).map(|c| c.sub)
}

/// Decode the full JWT claims payload. Used by the auth middleware to
/// validate token_version against the DB without re-parsing the cookie.
pub fn extract_claims(headers: &axum::http::HeaderMap) -> Option<jwt::Claims> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    let token = cookie_header
        .split(';')
        .map(|s| s.trim())
        .find(|s| s.starts_with("cellforge_token="))?
        .strip_prefix("cellforge_token=")?;

    jwt::verify_token(token).ok()
}
