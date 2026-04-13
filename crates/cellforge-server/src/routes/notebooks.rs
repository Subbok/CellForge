use crate::routes::{safe_resolve, user_notebook_dir};
use crate::state::AppState;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use cellforge_notebook::format::Notebook;
use cellforge_notebook::io;
use serde::Serialize;
use std::sync::Arc;

#[derive(Serialize)]
pub struct NotebookEntry {
    pub name: String,
    pub path: String,
}

pub async fn list(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    let dir = user_notebook_dir(&state, &headers);
    let _ = std::fs::create_dir_all(&dir);
    let mut entries = vec![];
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().is_some_and(|e| e == "ipynb") {
                let name = p.file_name().unwrap().to_string_lossy().into();
                let rel = p.strip_prefix(&dir).unwrap_or(&p);
                entries.push(NotebookEntry {
                    name,
                    path: rel.to_string_lossy().into(),
                });
            }
        }
    }
    Json(entries)
}

pub async fn read(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(path): Path<String>,
) -> Result<Json<Notebook>, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let full = safe_resolve(&dir, &path)?;
    io::read_notebook(&full).map(Json).map_err(|e| {
        tracing::error!("reading {path}: {e}");
        StatusCode::NOT_FOUND
    })
}

#[derive(serde::Deserialize)]
pub struct CreateReq {
    pub name: Option<String>,
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CreateReq>,
) -> Result<Json<NotebookEntry>, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let _ = std::fs::create_dir_all(&dir);
    let name = req.name.unwrap_or("Untitled.ipynb".into());
    let full = safe_resolve(&dir, &name)?;
    if full.exists() {
        return Err(StatusCode::CONFLICT);
    }

    let nb = Notebook::new_empty("python3", "Python 3", "python");
    io::write_notebook(&full, &nb).map_err(|e| {
        tracing::error!("creating {name}: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(NotebookEntry {
        name: name.clone(),
        path: name,
    }))
}

pub async fn save(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(path): Path<String>,
    Json(nb): Json<Notebook>,
) -> Result<StatusCode, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let full = safe_resolve(&dir, &path)?;
    io::write_notebook(&full, &nb).map_err(|e| {
        tracing::error!("saving {path}: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // record in history with cell-level diff
    let username = crate::routes::auth::extract_user(&headers).unwrap_or("unknown".into());
    let snapshot = serde_json::to_string(&nb).unwrap_or_default();

    // compute what changed vs previous version
    let changed = if let Some(prev_snap) = state.users.last_snapshot(&path) {
        compute_cell_changes(&prev_snap, &snapshot)
    } else {
        "[]".to_string()
    };

    let _ = state
        .users
        .save_history(&path, &username, "save", &snapshot, &changed);

    Ok(StatusCode::OK)
}

pub async fn remove(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(path): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let full = safe_resolve(&dir, &path)?;
    std::fs::remove_file(&full).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(serde::Deserialize)]
pub struct RenameReq {
    pub old_path: String,
    pub new_name: String,
}

pub async fn rename(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<RenameReq>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let old = safe_resolve(&dir, &req.old_path)?;
    if !old.exists() {
        return Err(StatusCode::NOT_FOUND);
    }
    let new_rel = old
        .strip_prefix(&dir)
        .ok()
        .and_then(|p| p.parent())
        .unwrap_or(std::path::Path::new(""))
        .join(&req.new_name);
    let new_path = safe_resolve(&dir, &new_rel.to_string_lossy())?;
    std::fs::rename(&old, &new_path).map_err(|e| {
        tracing::error!("rename: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let rel = new_path
        .strip_prefix(&dir)
        .unwrap_or(&new_path)
        .to_string_lossy()
        .to_string();
    Ok(Json(serde_json::json!({"path": rel})))
}

/// Compare two notebook snapshots and return JSON describing cell-level changes.
fn compute_cell_changes(old_json: &str, new_json: &str) -> String {
    let old: serde_json::Value = serde_json::from_str(old_json).unwrap_or_default();
    let new: serde_json::Value = serde_json::from_str(new_json).unwrap_or_default();

    let old_cells = old.get("cells").and_then(|v| v.as_array());
    let new_cells = new.get("cells").and_then(|v| v.as_array());

    let (Some(old_cells), Some(new_cells)) = (old_cells, new_cells) else {
        return "[]".into();
    };

    let mut changes = vec![];

    // build map of old cells by id
    let old_map: std::collections::HashMap<String, &serde_json::Value> = old_cells
        .iter()
        .filter_map(|c| {
            c.get("id")
                .and_then(|v| v.as_str())
                .map(|id| (id.to_string(), c))
        })
        .collect();

    let new_map: std::collections::HashMap<String, &serde_json::Value> = new_cells
        .iter()
        .filter_map(|c| {
            c.get("id")
                .and_then(|v| v.as_str())
                .map(|id| (id.to_string(), c))
        })
        .collect();

    // check for edited and added cells
    for cell in new_cells {
        let id = cell.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let new_src = cell_source(cell);

        if let Some(old_cell) = old_map.get(id) {
            let old_src = cell_source(old_cell);
            if old_src != new_src {
                let summary = format!(
                    "{} lines → {} lines",
                    old_src.lines().count(),
                    new_src.lines().count()
                );
                changes.push(serde_json::json!({
                    "cell_id": id, "change": "edited", "summary": summary,
                    "old_source": old_src, "new_source": new_src,
                }));
            }
        } else {
            let preview = new_src
                .lines()
                .next()
                .unwrap_or("")
                .chars()
                .take(60)
                .collect::<String>();
            changes.push(serde_json::json!({
                "cell_id": id, "change": "added", "summary": preview,
                "new_source": new_src,
            }));
        }
    }

    // check for deleted cells
    for (id, old_cell) in &old_map {
        if !new_map.contains_key(id) {
            let preview = cell_source(old_cell)
                .lines()
                .next()
                .unwrap_or("")
                .chars()
                .take(60)
                .collect::<String>();
            changes.push(serde_json::json!({
                "cell_id": id, "change": "deleted", "summary": preview,
                "old_source": cell_source(old_cell),
            }));
        }
    }

    serde_json::to_string(&changes).unwrap_or("[]".into())
}

fn cell_source(cell: &serde_json::Value) -> String {
    match cell.get("source") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

#[derive(serde::Deserialize)]
pub struct OpenPathReq {
    pub path: String,
}

pub async fn open_path(Json(req): Json<OpenPathReq>) -> Result<Json<Notebook>, StatusCode> {
    let p = std::path::Path::new(&req.path);
    if !p.exists() {
        return Err(StatusCode::NOT_FOUND);
    }
    io::read_notebook(p).map(Json).map_err(|e| {
        tracing::error!("open_path {}: {e}", req.path);
        StatusCode::INTERNAL_SERVER_ERROR
    })
}
