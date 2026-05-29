use crate::routes::{safe_resolve, user_notebook_dir};
use crate::state::AppState;
use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use cellforge_data::{
    CsvReader, DataReader, JsonlReader, ParquetReader, PreviewResponse, SortDir, SortKey,
    StatsResponse, edit, stats,
};
use serde::Deserialize;
use std::sync::Arc;

/// Cap on rows per request. Frontend pages in chunks; we never want a single
/// preview to allocate more than this so a curious client can't OOM the
/// server with `?limit=100000000`.
const MAX_LIMIT: usize = 5000;
const DEFAULT_LIMIT: usize = 500;

#[derive(Deserialize)]
pub struct PreviewQuery {
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    limit: Option<usize>,
    /// Column index to sort by. Omitting it skips the sort path entirely so
    /// even gigabyte CSVs scroll without reading the whole file.
    #[serde(default)]
    sort_col: Option<usize>,
    /// `asc` (default) or `desc`. Ignored unless `sort_col` is also set.
    #[serde(default)]
    sort_dir: Option<String>,
}

/// `GET /api/data/preview/{path}?offset=…&limit=…&sort_col=…&sort_dir=asc`
///
/// Returns a chunk of the file at `{path}` (relative to the caller's
/// workspace) plus an inferred schema. `open_reader` dispatches by extension
/// to the matching format reader (csv/tsv/txt, jsonl/ndjson/json, parquet).
pub async fn preview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(path): Path<String>,
    Query(q): Query<PreviewQuery>,
) -> Result<Json<PreviewResponse>, StatusCode> {
    if crate::routes::auth::extract_user(&headers).is_none() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let dir = user_notebook_dir(&state, &headers);
    let full = safe_resolve(&dir, &path)?;

    let mut reader = open_reader(&full, &path)?;

    let offset = q.offset.unwrap_or(0);
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);

    let sort = q.sort_col.map(|column| SortKey {
        column,
        dir: match q.sort_dir.as_deref().unwrap_or("asc") {
            "desc" => SortDir::Desc,
            _ => SortDir::Asc,
        },
    });

    let preview = reader.preview(offset, limit, sort).map_err(|e| {
        tracing::error!("data preview {path}: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(preview))
}

/// `GET /api/data/stats/{path}` — per-column count / nulls / distinct /
/// min / max / mean. One full pass over the file; the viewer fetches it
/// lazily when the user opens the stats panel so ordinary scrolling never
/// pays the cost.
pub async fn column_stats(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(path): Path<String>,
) -> Result<Json<StatsResponse>, StatusCode> {
    if crate::routes::auth::extract_user(&headers).is_none() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let dir = user_notebook_dir(&state, &headers);
    let full = safe_resolve(&dir, &path)?;
    let mut reader = open_reader(&full, &path)?;
    let resp = stats::compute(reader.as_mut()).map_err(|e| {
        tracing::error!("data stats {path}: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(resp))
}

#[derive(Deserialize)]
pub struct EditCellReq {
    path: String,
    row: usize,
    col: usize,
    value: String,
}

/// `POST /api/data/cell` — update a single cell of a CSV/TSV or JSON/JSONL file.
/// Addressed by file row index (header excluded). The frontend only allows this
/// in the unsorted, unfiltered view so the index matches the file. Parquet is
/// read-only.
pub async fn edit_cell(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<EditCellReq>,
) -> Result<StatusCode, StatusCode> {
    if crate::routes::auth::extract_user(&headers).is_none() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let dir = user_notebook_dir(&state, &headers);
    let full = safe_resolve(&dir, &req.path)?;

    let ext = full
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);

    match ext.as_deref() {
        Some("csv") | Some("tsv") | Some("txt") => {
            edit::set_csv_cell(&full, req.row, req.col, &req.value).map_err(|e| {
                tracing::warn!("edit csv {}: {e}", req.path);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        }
        Some("jsonl") | Some("ndjson") | Some("json") => {
            // Need the column's name + type to set/coerce the JSON field.
            let reader = open_reader(&full, &req.path)?;
            let schema = reader.schema();
            let col = schema.get(req.col).ok_or(StatusCode::BAD_REQUEST)?;
            edit::set_json_cell(&full, &col.name, col.ty, req.row, &req.value).map_err(|e| {
                tracing::warn!("edit json {}: {e}", req.path);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        }
        _ => return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE),
    }
    Ok(StatusCode::OK)
}

fn open_reader(full: &std::path::Path, label: &str) -> Result<Box<dyn DataReader>, StatusCode> {
    let ext = full
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    let map_open_err = |e: anyhow::Error| {
        tracing::warn!("data open {label}: {e}");
        StatusCode::UNPROCESSABLE_ENTITY
    };
    match ext.as_deref() {
        Some("csv") | Some("tsv") | Some("txt") => {
            Ok(Box::new(CsvReader::open(full).map_err(map_open_err)?))
        }
        Some("jsonl") | Some("ndjson") | Some("json") => {
            // JsonlReader auto-detects between JSON-array and JSONL by
            // peeking the first non-whitespace byte, so a single dispatch
            // arm covers both shapes.
            Ok(Box::new(JsonlReader::open(full).map_err(map_open_err)?))
        }
        Some("parquet") | Some("pq") => {
            Ok(Box::new(ParquetReader::open(full).map_err(map_open_err)?))
        }
        _ => Err(StatusCode::UNSUPPORTED_MEDIA_TYPE),
    }
}
