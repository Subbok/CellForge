use crate::routes::{safe_resolve, scan_workspace, user_notebook_dir};
use crate::state::AppState;
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::sync::Arc;

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    /// Last modification time as ISO 8601 UTC, e.g. "2026-05-01T14:32:11Z".
    /// `None` only if the filesystem doesn't expose mtime — frontend treats
    /// missing as "unknown" rather than substituting now().
    pub modified: Option<String>,
    /// Number of cells inside a `.ipynb` notebook. `None` for folders, plain
    /// files, or notebooks we couldn't parse (corrupt / partial / too big).
    pub cell_count: Option<usize>,
    /// Kernel display name from notebook metadata (`metadata.kernelspec.display_name`,
    /// falling back to `metadata.kernelspec.name`). `None` for non-notebooks
    /// or notebooks without a recorded kernelspec.
    pub kernelspec: Option<String>,
}

/// Cap on bytes read when peeking at a notebook to extract metadata. Notebooks
/// can be very large (multi-MB after embedded outputs), but the metadata
/// header is at the top of the JSON, so a few hundred KB is plenty in practice
/// and keeps `list_dir` fast even on directories full of notebooks.
const NOTEBOOK_PEEK_CAP_BYTES: u64 = 512 * 1024;

pub async fn list_root(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<FileEntry>>, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let _ = std::fs::create_dir_all(&dir);
    list_dir(&dir, &dir)
}

#[derive(Serialize)]
pub struct Quota {
    /// Total bytes consumed by everything under the workspace dir.
    pub used_bytes: u64,
    /// Number of `.ipynb` files in the workspace.
    pub notebook_count: usize,
    /// Maximum storage in MB the admin granted; 0 means unlimited.
    pub max_storage_mb: i64,
}

/// GET /api/quota — current user's workspace usage. Powers the Files page
/// subtitle (`~/{cwd} · 14 notebooks · 312 MB used / 50 GB`) and any future
/// quota indicators. Cheap enough to call on every Files refresh — same
/// recursive walk as the admin per-user count.
pub async fn quota(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Quota>, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let _ = std::fs::create_dir_all(&dir);
    let (notebook_count, used_bytes) = scan_workspace(&dir);
    let max_storage_mb = crate::routes::auth::extract_user(&headers)
        .and_then(|n| state.users.get_user_limits(&n).ok())
        .map(|l| l.max_storage_mb)
        .unwrap_or(0);
    Ok(Json(Quota {
        used_bytes,
        notebook_count,
        max_storage_mb,
    }))
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
        let size = meta
            .as_ref()
            .and_then(|m| if m.is_file() { Some(m.len()) } else { None });

        let modified = meta.as_ref().and_then(|m| m.modified().ok()).map(|t| {
            let dt: DateTime<Utc> = t.into();
            dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
        });

        let path_buf = entry.path();
        let rel_path = path_buf
            .strip_prefix(base)
            .unwrap_or(&path_buf)
            .to_string_lossy()
            .to_string();

        // Notebook-only metadata: cell count and kernelspec. Read the file
        // up to a small cap so we never block listing on a runaway notebook.
        let (cell_count, kernelspec) = if !is_dir && name.ends_with(".ipynb") {
            peek_notebook_metadata(&path_buf, size.unwrap_or(0))
        } else {
            (None, None)
        };

        entries.push(FileEntry {
            name,
            path: rel_path,
            is_dir,
            size,
            modified,
            cell_count,
            kernelspec,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    Ok(Json(entries))
}

/// Read a chunk of the notebook JSON and extract `cells.length` and the
/// kernelspec display name. Returns `(None, None)` on any parse error so a
/// malformed notebook never blocks the listing.
fn peek_notebook_metadata(path: &std::path::Path, size: u64) -> (Option<usize>, Option<String>) {
    use std::io::Read;

    // Read at most NOTEBOOK_PEEK_CAP_BYTES; for tiny notebooks just read it all.
    let read_cap = std::cmp::min(size, NOTEBOOK_PEEK_CAP_BYTES) as usize;
    if read_cap == 0 {
        return (None, None);
    }

    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (None, None),
    };
    let mut buf = Vec::with_capacity(read_cap);
    if file.take(read_cap as u64).read_to_end(&mut buf).is_err() {
        return (None, None);
    }

    // For notebooks that fit under the cap, the buffer is the whole file and
    // is valid JSON; for larger ones we get a truncated prefix that won't
    // parse — fall back to a streaming-style search so cell_count + kernelspec
    // still come out for huge-output notebooks.
    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf) {
        let cells = v.get("cells").and_then(|c| c.as_array()).map(|a| a.len());
        let kspec = v
            .pointer("/metadata/kernelspec/display_name")
            .and_then(|s| s.as_str())
            .or_else(|| {
                v.pointer("/metadata/kernelspec/name")
                    .and_then(|s| s.as_str())
            })
            .map(|s| s.to_string());
        return (cells, kspec);
    }

    // Truncated parse fallback: regex-extract kernelspec.display_name (or name)
    // from the prefix; we can't count cells reliably without the full JSON.
    let text = String::from_utf8_lossy(&buf);
    let kspec = extract_kernelspec_from_prefix(&text);
    (None, kspec)
}

/// Pull `kernelspec.display_name` (or `name`) out of a JSON prefix without
/// parsing the whole document. The metadata block sits near the top of every
/// `.ipynb` file produced by Jupyter, so a substring scan is reliable enough
/// for the truncated-read case.
fn extract_kernelspec_from_prefix(prefix: &str) -> Option<String> {
    let kspec_idx = prefix.find("\"kernelspec\"")?;
    let after = &prefix[kspec_idx..];
    for key in ["\"display_name\"", "\"name\""] {
        if let Some(k_idx) = after.find(key) {
            // Skip past the key, the colon, and any whitespace, then read the
            // next quoted string.
            let tail = &after[k_idx + key.len()..];
            if let Some(quote_open) = tail.find('"') {
                let value_start = quote_open + 1;
                let after_value = &tail[value_start..];
                if let Some(quote_close) = after_value.find('"') {
                    return Some(after_value[..quote_close].to_string());
                }
            }
        }
    }
    None
}
