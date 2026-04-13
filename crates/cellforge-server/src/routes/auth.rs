use axum::Json;
use axum::extract::State;
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use cellforge_auth::jwt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::state::AppState;

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
    Json(req): Json<LoginReq>,
) -> impl IntoResponse {
    match state.users.login(&req.username, &req.password) {
        Ok(user) => {
            let token = jwt::create_token(&user.username).unwrap_or_default();
            let cookie =
                format!("cellforge_token={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800");

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
        Err(e) => (
            StatusCode::UNAUTHORIZED,
            Json(AuthResponse {
                ok: false,
                error: Some(e.to_string()),
                user: None,
            }),
        )
            .into_response(),
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
                let token = jwt::create_token(&user.username).unwrap_or_default();
                let cookie = format!(
                    "cellforge_token={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800"
                );
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

pub async fn logout() -> impl IntoResponse {
    let cookie = "cellforge_token=; Path=/; HttpOnly; Max-Age=0";
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie.to_string())],
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

/// Extract username from JWT cookie.
pub fn extract_user(headers: &axum::http::HeaderMap) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    let token = cookie_header
        .split(';')
        .map(|s| s.trim())
        .find(|s| s.starts_with("cellforge_token="))?
        .strip_prefix("cellforge_token=")?;

    jwt::verify_token(token).ok().map(|c| c.sub)
}
