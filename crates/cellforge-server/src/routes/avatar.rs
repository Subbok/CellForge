//! Avatar / profile-image endpoints.
//!
//! Resolution chain on `GET /api/users/{username}/avatar`:
//!   1. Local file uploaded by the user (preferred — works offline).
//!   2. Gravatar fetched via the email the user supplied — proxied
//!      through this server so the user's IP never leaks to gravatar.com.
//!   3. 404 — the frontend renders the username's initial in a coloured
//!      pill instead.
//!
//! Uploads are resized to a fixed 256 × 256 PNG so per-user disk usage
//! stays predictable and the wire format is consistent.

use crate::routes::auth as auth_route;
use crate::state::AppState;
use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum_extra::extract::Multipart;
use image::ImageReader;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// Upload size hard cap (pre-resize). Bigger images just get rejected with
/// 413 — the resize pipeline is plenty fast for 5 MB inputs and there's no
/// real-world camera output bigger than that we'd want to accept anyway.
const MAX_UPLOAD: usize = 5 * 1024 * 1024;
/// Output dimensions. 256² is the common "everywhere on the page" size —
/// big enough for header sidebar avatars without scaling up, small enough
/// to ship over /api/users without cache pressure.
const TARGET_SIZE: u32 = 256;

fn avatars_dir() -> PathBuf {
    let dir = cellforge_config::config_dir().join("avatars");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn avatar_path_for(username: &str) -> PathBuf {
    // Username is already validated at registration (alphanumeric +
    // underscore + dash) so we can use it directly as a filename.
    avatars_dir().join(format!("{username}.png"))
}

#[derive(Serialize)]
pub struct AvatarStatus {
    pub has_local: bool,
    pub email: Option<String>,
}

/// `GET /api/users/me/avatar-status` — returns whether a local avatar
/// exists and the configured email. Used by the Settings panel to show
/// either the upload button or the "remove avatar" button.
pub async fn me_avatar_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<AvatarStatus>, StatusCode> {
    let username = auth_route::extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    Ok(Json(AvatarStatus {
        has_local: state.users.avatar_path(&username).is_some(),
        email: state.users.email_for(&username),
    }))
}

#[derive(Deserialize)]
pub struct EmailReq {
    /// Empty string clears the email.
    pub email: String,
}

/// `PUT /api/users/me/email` — set or clear the Gravatar-derivation email.
pub async fn set_email(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<EmailReq>,
) -> Result<StatusCode, StatusCode> {
    let username = auth_route::extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let trimmed = req.email.trim();
    // Lightweight validation — must contain `@` and a `.` after it. We're
    // not using the email for delivery, only for Gravatar's hash, so a
    // typo just means no Gravatar match (safe failure).
    if !trimmed.is_empty() {
        let parts: Vec<&str> = trimmed.splitn(2, '@').collect();
        if parts.len() != 2 || parts[0].is_empty() || !parts[1].contains('.') {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    let value = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    };
    state.users.set_email(&username, value).map_err(|e| {
        tracing::warn!("set_email {username}: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(StatusCode::NO_CONTENT)
}

/// `PUT /api/users/me/avatar` — multipart upload, single field `file`.
/// The body is resized to a 256² PNG and stored under `data_dir/avatars/`.
pub async fn upload_avatar(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<StatusCode, StatusCode> {
    let username = auth_route::extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;

    let mut bytes: Option<Bytes> = None;
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() == Some("file") {
            bytes = field.bytes().await.ok();
            break;
        }
    }
    let bytes = bytes.ok_or(StatusCode::BAD_REQUEST)?;
    if bytes.len() > MAX_UPLOAD {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    // Decode + resize off the async runtime — image decoding is CPU-bound
    // and a malformed input could spin for tens of ms.
    let resized = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, image::ImageError> {
        let img = ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()?
            .decode()?;
        let resized = img.resize_to_fill(
            TARGET_SIZE,
            TARGET_SIZE,
            image::imageops::FilterType::Lanczos3,
        );
        let mut out = Vec::with_capacity(64 * 1024);
        resized.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)?;
        Ok(out)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|e| {
        tracing::warn!("avatar resize {username}: {e}");
        StatusCode::UNPROCESSABLE_ENTITY
    })?;

    let path = avatar_path_for(&username);
    std::fs::write(&path, &resized).map_err(|e| {
        tracing::error!("avatar write {username}: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    state
        .users
        .set_avatar_path(&username, Some(&path.to_string_lossy()))
        .map_err(|e| {
            tracing::error!("avatar db {username}: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(StatusCode::NO_CONTENT)
}

/// `DELETE /api/users/me/avatar` — remove the locally-stored image.
/// Email-based Gravatar fallback (if any) keeps working.
pub async fn delete_avatar(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let username = auth_route::extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    if let Some(p) = state.users.avatar_path(&username) {
        let _ = std::fs::remove_file(&p);
    }
    state
        .users
        .set_avatar_path(&username, None)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /api/users/{username}/avatar` — serve PNG bytes via the resolution
/// chain documented at the top of this module. Public route (no auth)
/// because avatars are shown next to author names everywhere; gating it
/// would force every list view to detour through a private helper.
pub async fn get_avatar(
    State(state): State<Arc<AppState>>,
    Path(username): Path<String>,
) -> Response {
    // 1. Local file
    if let Some(p) = state.users.avatar_path(&username)
        && let Ok(bytes) = std::fs::read(&p)
    {
        return png_response(bytes);
    }

    // 2. Gravatar via proxy. We compute the SHA-256 hash here (Gravatar's
    //    new recommended digest) and forward the user's email never leaves
    //    the box.
    if let Some(email) = state.users.email_for(&username) {
        let hash = sha256_hex(email.trim().to_lowercase().as_bytes());
        // `d=404` so Gravatar returns 404 for unknown emails — we want
        // the frontend to fall back to the initial-letter pill rather
        // than show their default mystery-person silhouette.
        let url = format!("https://www.gravatar.com/avatar/{hash}?s=256&d=404");
        match fetch_gravatar(&url).await {
            Ok(bytes) => return png_response(bytes),
            Err(GravatarError::NotFound) => {}
            Err(GravatarError::Transport(e)) => {
                tracing::debug!("gravatar fetch {username}: {e}");
            }
        }
    }

    // 3. Frontend renders an initial-letter fallback when the API returns
    //    404 — keeps the markup simple and lets us pick the colour from
    //    user preferences without a server round trip.
    StatusCode::NOT_FOUND.into_response()
}

fn png_response(bytes: Vec<u8>) -> Response {
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
    // Browser-side caching for an hour is plenty — when the user uploads a
    // new avatar the URL doesn't change so we can't cache for too long
    // without trapping the old image. A 3600s TTL strikes the balance.
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=3600"),
    );
    (StatusCode::OK, headers, bytes).into_response()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let mut hex = String::with_capacity(64);
    for b in hasher.finalize() {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{b:02x}");
    }
    hex
}

enum GravatarError {
    NotFound,
    Transport(reqwest::Error),
}

async fn fetch_gravatar(url: &str) -> Result<Vec<u8>, GravatarError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(GravatarError::Transport)?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(GravatarError::Transport)?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(GravatarError::NotFound);
    }
    let bytes = resp.bytes().await.map_err(GravatarError::Transport)?;
    Ok(bytes.to_vec())
}
