//! Tabular-data preview backend.
//!
//! Powers the data viewer tab — given a path to a CSV / JSONL / Parquet file,
//! returns a typed schema plus a slice of rows for display. The viewer in the
//! frontend asks for chunks (offset, limit, sort) and renders each chunk in a
//! virtualised table; this crate hides the per-format quirks behind one
//! `DataReader` trait so the route layer stays format-agnostic.
//!
//! The trait shape (`schema()`, `preview()`, `total_rows()`) is deliberately
//! small enough that any row-oriented format fits; CSV, JSONL, JSON-array,
//! and Parquet readers ship in-tree.

pub mod csv;
pub mod edit;
pub mod jsonl;
pub mod parquet;
pub mod schema;
pub mod sort;
pub mod stats;

use anyhow::Result;
pub use csv::CsvReader;
pub use jsonl::JsonlReader;
pub use parquet::ParquetReader;
pub use schema::{
    ColumnSchema, ColumnStats, ColumnType, PreviewResponse, RowValue, SortDir, SortKey,
    StatsResponse,
};

/// One DataReader instance per opened file. Implementations may keep an
/// internal buffer / index but must remain `Send` so the route handler can
/// hold them across await points.
pub trait DataReader: Send {
    /// Inferred column schema. Stable across `preview()` calls so the
    /// frontend can cache header metadata.
    fn schema(&self) -> &[ColumnSchema];

    /// Total row count if cheap to determine (CSV reader counts on first call
    /// and caches; future Parquet impl reads it from footer metadata).
    /// `None` means "don't show a paginator total — display rows seen so far".
    fn total_rows(&mut self) -> Option<usize>;

    /// Return up to `limit` rows starting at `offset`, optionally sorted by
    /// `sort`. Sorting at this layer (rather than in the frontend) lets the
    /// viewer page through gigabytes without holding everything in browser
    /// memory; small files just sort in-memory and slice.
    fn preview(
        &mut self,
        offset: usize,
        limit: usize,
        sort: Option<SortKey>,
    ) -> Result<PreviewResponse>;
}
