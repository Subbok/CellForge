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
}

#[derive(Serialize)]
pub struct DashboardStats {
    recent_notebooks_count: usize,
    shared_files_count: usize,
    running_kernels_count: usize,
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

    let stats = DashboardStats {
        recent_notebooks_count: recent_notebooks.len(),
        shared_files_count: shared_files.len(),
        running_kernels_count: running_kernels.len(),
    };

    Ok(Json(DashboardResponse {
        username: user.username,
        display_name: user.display_name,
        is_admin: user.is_admin,
        stats,
        recent_notebooks,
        shared_files,
        running_kernels,
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

/// POST /api/kernels/:id/stop — stop a specific kernel.
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

    // Find the kernel session to verify ownership
    let all_sessions = state.users.list_kernel_sessions();
    let session = all_sessions
        .iter()
        .find(|s| s.id == kernel_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    // Verify kernel belongs to user OR user is admin
    if session.username != username && !user.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    // Stop the kernel via KernelManager
    let mut km = state.kernels.lock().await;
    let _ = km.stop(&kernel_id).await;

    // Remove from DB
    let _ = state.users.remove_kernel_session(&kernel_id);

    Ok(StatusCode::OK)
}
