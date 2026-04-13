use crate::routes::{safe_resolve, user_notebook_dir};
use crate::state::AppState;
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Serialize;
use std::sync::Arc;

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

pub async fn list_root(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<FileEntry>>, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let _ = std::fs::create_dir_all(&dir);
    list_dir(&dir, &dir)
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(path): Path<String>,
) -> Result<Json<Vec<FileEntry>>, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let resolved = safe_resolve(&dir, &path)?;
    list_dir(&resolved, &dir)
}

fn list_dir(
    full_path: &std::path::Path,
    base: &std::path::Path,
) -> Result<Json<Vec<FileEntry>>, StatusCode> {
    if !full_path.is_dir() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut entries = Vec::new();
    let rd = std::fs::read_dir(full_path).map_err(|_| StatusCode::NOT_FOUND)?;

    for entry in rd.flatten() {
        let meta = entry.metadata().ok();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let is_dir = meta.as_ref().is_some_and(|m| m.is_dir());
        let size = meta.and_then(|m| if m.is_file() { Some(m.len()) } else { None });
        let rel_path = entry
            .path()
            .strip_prefix(base)
            .unwrap_or(&entry.path())
            .to_string_lossy()
            .to_string();

        entries.push(FileEntry {
            name,
            path: rel_path,
            is_dir,
            size,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    Ok(Json(entries))
}
