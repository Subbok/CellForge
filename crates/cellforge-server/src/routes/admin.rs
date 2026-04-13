use crate::routes::auth::extract_user;
use crate::state::AppState;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use cellforge_auth::db::User;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Extract user from headers and verify they are an admin.
/// Returns the User on success, or an appropriate error status.
fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<User, StatusCode> {
    let username = extract_user(headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user = state
        .users
        .get_user(&username)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    if !user.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(user)
}

// ── Stats ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct SystemStats {
    user_count: usize,
    total_kernels: usize,
    total_memory_mb: i64,
}

/// GET /api/admin/stats — system overview.
pub async fn stats(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    require_admin(&state, &headers)?;

    let users = state.users.list_users();
    let sessions = state.users.list_kernel_sessions();
    let total_memory_mb: i64 = sessions.iter().map(|s| s.memory_mb).sum();

    Ok(Json(SystemStats {
        user_count: users.len(),
        total_kernels: sessions.len(),
        total_memory_mb,
    }))
}

// ── Users ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct EnrichedUser {
    #[serde(flatten)]
    user: User,
    kernel_count: usize,
}

/// GET /api/admin/users — enriched user list with kernel counts.
pub async fn list_users(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    require_admin(&state, &headers)?;

    let users = state.users.list_users();
    let sessions = state.users.list_kernel_sessions();

    let enriched: Vec<EnrichedUser> = users
        .into_iter()
        .map(|u| {
            let kernel_count = sessions.iter().filter(|s| s.username == u.username).count();
            EnrichedUser {
                user: u,
                kernel_count,
            }
        })
        .collect();

    Ok(Json(enriched))
}

#[derive(Deserialize)]
pub struct UpdateUserReq {
    max_kernels: Option<i64>,
    max_memory_mb: Option<i64>,
    group_name: Option<String>,
    is_active: Option<bool>,
}

/// PUT /api/admin/users/:username — update limits/group/active status.
pub async fn update_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(username): Path<String>,
    Json(req): Json<UpdateUserReq>,
) -> Result<impl IntoResponse, StatusCode> {
    require_admin(&state, &headers)?;

    // Get current limits to fill in defaults for unspecified fields
    let current = state
        .users
        .get_user_limits(&username)
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let max_kernels = req.max_kernels.unwrap_or(current.max_kernels);
    let max_memory_mb = req.max_memory_mb.unwrap_or(current.max_memory_mb);
    let group_name = req.group_name.unwrap_or(current.group_name);

    state
        .users
        .update_user_limits(&username, max_kernels, max_memory_mb, &group_name)
        .map_err(|_| StatusCode::NOT_FOUND)?;

    // Handle is_active toggle if provided
    if let Some(active) = req.is_active
        && active
    {
        let _ = state.users.touch_user_active(&username);
        // Note: deactivation would need a separate DB method; touch_user_active
        // only sets active=true. For now we only support activation via this field.
    }

    Ok(StatusCode::OK)
}

// ── Groups ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateGroupReq {
    name: String,
    description: String,
    max_kernels_per_user: i64,
    max_memory_mb_per_user: i64,
}

#[derive(Deserialize)]
pub struct UpdateGroupReq {
    description: String,
    max_kernels_per_user: i64,
    max_memory_mb_per_user: i64,
}

/// GET /api/admin/groups — list all groups.
pub async fn list_groups(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    require_admin(&state, &headers)?;
    Ok(Json(state.users.list_groups()))
}

/// POST /api/admin/groups — create a new group.
pub async fn create_group(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CreateGroupReq>,
) -> Result<impl IntoResponse, StatusCode> {
    require_admin(&state, &headers)?;

    let group = state
        .users
        .create_group(
            &req.name,
            &req.description,
            req.max_kernels_per_user,
            req.max_memory_mb_per_user,
        )
        .map_err(|_| StatusCode::CONFLICT)?;

    Ok((StatusCode::CREATED, Json(group)))
}

/// PUT /api/admin/groups/:name — update a group.
pub async fn update_group(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(req): Json<UpdateGroupReq>,
) -> Result<impl IntoResponse, StatusCode> {
    require_admin(&state, &headers)?;

    state
        .users
        .update_group(
            &name,
            &req.description,
            req.max_kernels_per_user,
            req.max_memory_mb_per_user,
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(StatusCode::OK)
}

/// DELETE /api/admin/groups/:name — delete a group (unsets group_name on users).
pub async fn delete_group(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    require_admin(&state, &headers)?;

    state
        .users
        .delete_group(&name)
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(StatusCode::OK)
}

// ── Kernels ──────────────────────────────────────────────────────────

/// GET /api/admin/kernels — all running kernels across all users.
pub async fn all_kernels(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    require_admin(&state, &headers)?;
    Ok(Json(state.users.list_kernel_sessions()))
}

/// POST /api/admin/kernels/:id/stop — force-stop any kernel.
pub async fn stop_kernel(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(kernel_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    require_admin(&state, &headers)?;

    let mut km = state.kernels.lock().await;
    let _ = km.stop(&kernel_id).await;
    let _ = state.users.remove_kernel_session(&kernel_id);

    Ok(StatusCode::OK)
}

/// POST /api/admin/kernels/stop-idle — stop all idle kernels, return count stopped.
pub async fn stop_all_idle(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    require_admin(&state, &headers)?;

    let mut km = state.kernels.lock().await;
    let stopped = km.cleanup_idle().await;

    // Also clean up DB records for kernels that no longer exist in the manager
    let sessions = state.users.list_kernel_sessions();
    for session in &sessions {
        if km.get(&session.id).is_none() {
            let _ = state.users.remove_kernel_session(&session.id);
        }
    }

    Ok(Json(serde_json::json!({ "stopped": stopped })))
}
