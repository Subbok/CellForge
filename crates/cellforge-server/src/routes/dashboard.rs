use crate::routes::auth::extract_user;
use crate::routes::user_notebook_dir;
use crate::state::AppState;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use cellforge_auth::db::KernelSession;
use serde::Serialize;
use std::sync::Arc;

#[derive(Serialize)]
pub struct DashboardResponse {
    username: String,
    display_name: String,
    is_admin: bool,
    stats: DashboardStats,
    recent_notebooks: Vec<cellforge_auth::db::RecentNotebook>,
    shared_files: Vec<cellforge_auth::db::SharedFile>,
    running_kernels: Vec<KernelSession>,
    /// Up to 6 usernames of other users active in the last 2 minutes —
    /// enough for the Home avatar stack without ballooning the payload on
    /// large workspaces. The full count lives in `stats.online_count`.
    online_others: Vec<String>,
}

#[derive(Serialize)]
pub struct DashboardStats {
    recent_notebooks_count: usize,
    shared_files_count: usize,
    running_kernels_count: usize,
    /// Total number of users (including the caller) seen by the auth
    /// middleware in the last 2 minutes. Drives the "X collaborators
    /// online" sub-line on Home.
    online_count: i64,
}

/// GET /api/dashboard — full dashboard data for the logged-in user.
pub async fn dashboard(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    let username = extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user = state
        .users
        .get_user(&username)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let _ = state.users.touch_user_active(&username);

    let workspace_dir = user_notebook_dir(&state, &headers);
    let recent_notebooks: Vec<_> = state
        .users
        .recent_notebooks(&username, 20)
        .into_iter()
        .filter(|n| {
            let full = workspace_dir.join(&n.file_path);
            full.exists()
        })
        .collect();
    let shared_files: Vec<_> = state
        .users
        .shared_with(&username)
        .into_iter()
        .filter(|s| workspace_dir.join(&s.file_name).exists())
        .collect();
    let all_sessions = state.users.list_kernel_sessions();
    let running_kernels: Vec<KernelSession> = all_sessions
        .into_iter()
        .filter(|s| s.username == username)
        .collect();

    // 2-minute presence window — long enough that a 5-second poll keeps
    // the user counted, short enough that closing the tab drops them off
    // within a couple of polls.
    const ONLINE_WINDOW_SECS: i64 = 120;
    let online_count = state.users.count_online(ONLINE_WINDOW_SECS);
    let online_others = state.users.online_others(&username, ONLINE_WINDOW_SECS, 6);

    let stats = DashboardStats {
        recent_notebooks_count: recent_notebooks.len(),
        shared_files_count: shared_files.len(),
        running_kernels_count: running_kernels.len(),
        online_count,
    };

    Ok(Json(DashboardResponse {
        username: user.username,
        display_name: user.display_name,
        is_admin: user.is_admin,
        stats,
        recent_notebooks,
        shared_files,
        running_kernels,
        online_others,
    }))
}

/// GET /api/dashboard/kernels — live kernel status for this user (polled by frontend every 5s).
pub async fn dashboard_kernels(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    let username = extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;

    let all_sessions = state.users.list_kernel_sessions();
    let user_kernels: Vec<KernelSession> = all_sessions
        .into_iter()
        .filter(|s| s.username == username)
        .collect();

    Ok(Json(user_kernels))
}

/// GET /api/activity — recent events visible to the calling user.
/// Visibility rule: events the user performed themselves + shares whose
/// recipient is the user. Limit hard-capped server-side so a malicious
/// client can't request a million rows.
pub async fn activity(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    let username = extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let events = state.users.list_activity(&username, 50);
    Ok(Json(events))
}

/// POST /api/kernels/:id/stop — stop a specific kernel.
/// Idempotent: missing kernels return 200 so dashboard UIs can use the
/// response to clear stale entries after the reaper or a WS-close already
/// stopped the kernel in-between the user's poll and click.
pub async fn stop_kernel(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(kernel_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let username = extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user = state
        .users
        .get_user(&username)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Find the kernel session to verify ownership. If it's gone, treat as
    // already-stopped: the user's dashboard raced the reaper or a WS close.
    let all_sessions = state.users.list_kernel_sessions();
    if let Some(session) = all_sessions.iter().find(|s| s.id == kernel_id)
        && session.username != username
        && !user.is_admin
    {
        return Err(StatusCode::FORBIDDEN);
    }

    // Stop the kernel via KernelManager (no-op if already gone) and
    // unconditionally scrub the DB row so the dashboard stops listing it.
    let mut km = state.kernels.lock().await;
    let _ = km.stop(&kernel_id).await;
    let _ = state.users.remove_kernel_session(&kernel_id);

    Ok(Json(serde_json::json!({ "ok": true })))
}
