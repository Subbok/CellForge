use crate::routes::auth::extract_user;
use crate::routes::scan_workspace;
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
    /// Number of `.ipynb` files anywhere under the user's workspace dir.
    notebook_count: usize,
    /// Total bytes consumed by everything under the workspace dir
    /// (notebooks, uploaded files, folders). Hidden entries (`.git`,
    /// `.cache`) are excluded so checkouts of repos with bulky `.git`
    /// dirs don't dominate.
    storage_bytes: u64,
}

/// GET /api/admin/users — enriched user list with kernel + storage counts.
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
            let workspace = std::path::PathBuf::from(&u.workspace_dir);
            let (notebook_count, storage_bytes) = scan_workspace(&workspace);
            EnrichedUser {
                user: u,
                kernel_count,
                notebook_count,
                storage_bytes,
            }
        })
        .collect();

    Ok(Json(enriched))
}

#[derive(Deserialize)]
pub struct CreateUserReq {
    username: String,
    password: String,
    #[serde(default)]
    display_name: Option<String>,
    /// Optional role; "admin" sets is_admin=true, anything else (including
    /// missing) creates a regular user.
    #[serde(default)]
    role: Option<String>,
}

#[derive(Serialize)]
pub struct CreateUserResp {
    user: User,
}

/// POST /api/admin/users — admin-only user creation with optional role.
/// Distinct from POST /api/auth/register: this endpoint never logs the
/// caller in or out, and it accepts a `role` flag that the bootstrap-style
/// register can't honour. Attribution (`created_by`) is filled from the
/// admin's JWT so the new row records who provisioned it.
pub async fn create_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CreateUserReq>,
) -> Result<impl IntoResponse, StatusCode> {
    let admin = require_admin(&state, &headers)?;
    let display = req.display_name.unwrap_or_else(|| req.username.clone());
    let want_admin = req.role.as_deref() == Some("admin");

    // Re-use the existing register() so password hashing + workspace dir
    // creation stay in one place. is_admin gets toggled in a follow-up
    // write when the caller asked for an admin role — register() always
    // creates non-admin (its first-user-admin path is gated on has_users()).
    let mut user = state
        .users
        // Admin-created accounts get must_change_password=true — the
        // password the admin set is a one-shot bootstrap value, not the
        // user's real password.
        .register(
            &req.username,
            &req.password,
            &display,
            &admin.username,
            true,
        )
        .map_err(|e| {
            tracing::warn!("admin create_user failed: {e}");
            if e.to_string().contains("already taken") {
                StatusCode::CONFLICT
            } else {
                StatusCode::BAD_REQUEST
            }
        })?;

    if want_admin && !user.is_admin {
        if let Err(e) = state.users.set_admin(&user.username, true) {
            tracing::warn!("admin promotion after create failed: {e}");
            // Don't unwind the user creation — they're created as non-admin
            // and the admin can retry via the limits dialog.
        } else {
            user.is_admin = true;
        }
    }

    state
        .users
        .record_activity(&admin.username, "created_user", &user.username, "");

    Ok(Json(CreateUserResp { user }))
}

#[derive(Deserialize)]
pub struct UpdateUserReq {
    max_kernels: Option<i64>,
    max_memory_mb: Option<i64>,
    group_name: Option<String>,
    max_storage_mb: Option<i64>,
    is_active: Option<bool>,
    /// Promote/demote. Only the bootstrap super-admin can flip this on
    /// existing users; any admin can already create new admins via
    /// POST /api/admin/users with `role: "admin"`.
    is_admin: Option<bool>,
}

/// PUT /api/admin/users/:username — update limits/group/active/role.
pub async fn update_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(username): Path<String>,
    Json(req): Json<UpdateUserReq>,
) -> Result<impl IntoResponse, StatusCode> {
    let caller = require_admin(&state, &headers)?;

    // Get current limits to fill in defaults for unspecified fields
    let current = state
        .users
        .get_user_limits(&username)
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let max_kernels = req.max_kernels.unwrap_or(current.max_kernels);
    let max_memory_mb = req.max_memory_mb.unwrap_or(current.max_memory_mb);
    let group_name = req.group_name.unwrap_or(current.group_name);
    let max_storage_mb = req.max_storage_mb.unwrap_or(current.max_storage_mb);

    state
        .users
        .update_user_limits(
            &username,
            max_kernels,
            max_memory_mb,
            &group_name,
            max_storage_mb,
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;

    // Handle is_active toggle — both directions now work.
    // `is_active=true` → reactivate (clear is_disabled) and bump last_active;
    // `is_active=false` → deactivate (set is_disabled, invalidate JWTs).
    if let Some(active) = req.is_active {
        if active {
            let _ = state.users.reactivate_user(&username);
            let _ = state.users.touch_user_active(&username);
        } else {
            let _ = state.users.deactivate_user(&username);
        }
    }

    // Role change — only the bootstrap super-admin can flip this. Refuses
    // to demote the super-admin themselves so the workspace can never be
    // left without an owner.
    if let Some(want_admin) = req.is_admin {
        if !caller.is_super_admin {
            return Err(StatusCode::FORBIDDEN);
        }
        let target = state
            .users
            .get_user(&username)
            .map_err(|_| StatusCode::NOT_FOUND)?;
        if target.is_super_admin {
            return Err(StatusCode::FORBIDDEN);
        }
        state
            .users
            .set_admin(&username, want_admin)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let action = if want_admin {
            "promoted_admin"
        } else {
            "demoted_admin"
        };
        state
            .users
            .record_activity(&caller.username, action, &username, "");
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
