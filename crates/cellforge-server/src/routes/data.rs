use crate::routes::{safe_resolve, user_notebook_dir};
use crate::state::AppState;
use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use cellforge_data::{
    CsvReader, DataReader, JsonlReader, ParquetReader, PreviewResponse, SortDir, SortKey,
    StatsResponse, stats,
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
/// workspace) plus an inferred schema. CSV-only for 1.2.5; JSONL/Parquet
/// dispatch will land in 1.2.6.
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
