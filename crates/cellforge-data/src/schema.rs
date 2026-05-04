use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColumnType {
    /// Integers — i64. Falls back to `Float` if any value has a decimal.
    Int,
    /// f64. Used when at least one cell parses as a number with a fraction.
    Float,
    /// Boolean — case-insensitive `true`/`false`.
    Bool,
    /// Date or datetime — formats accepted: `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SS`,
    /// `YYYY-MM-DD HH:MM:SS`. We don't normalise to a canonical form here;
    /// the frontend just right-aligns and shows as-is.
    Date,
    /// Default. Anything that doesn't fit a stricter type goes here.
    String,
    /// Cell is empty (NULL/NaN/empty-string) in *every* sampled row.
    Null,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnSchema {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: ColumnType,
    /// True if any sampled cell was empty — drives a different render in the
    /// frontend (italicised "null" vs an actual empty string cell).
    pub nullable: bool,
}

/// One cell value. Numbers and booleans are passed through as JSON natives so
/// the frontend doesn't have to re-parse them; strings stay strings; missing
/// cells become JSON `null`. This keeps the wire format compact and lets
/// `JSON.stringify` on the client round-trip cleanly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RowValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    String(String),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDir {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortKey {
    /// Column index into `schema()`. Frontend sends index rather than name
    /// so renamed columns (rare but possible with header rewrites) stay
    /// stable across requests.
    pub column: usize,
    pub dir: SortDir,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnStats {
    pub column: usize,
    pub count: usize,
    pub null_count: usize,
    pub distinct: Option<usize>,
    /// Min/max as JSON natives when the column is numeric, otherwise the
    /// lexically smallest/largest string value. `None` when the column is
    /// fully null.
    pub min: Option<serde_json::Value>,
    pub max: Option<serde_json::Value>,
    /// Mean for numeric columns; absent for everything else.
    pub mean: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatsResponse {
    pub schema: Vec<ColumnSchema>,
    pub stats: Vec<ColumnStats>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreviewResponse {
    pub schema: Vec<ColumnSchema>,
    /// Row-major: `rows[r][c]` is the value at row `r`, column `c`.
    /// Frontend converts to the column-major / object-per-row shape that
    /// TanStack Table expects — keeping the wire format row-major shrinks
    /// the JSON for typical wide-and-shallow preview windows.
    pub rows: Vec<Vec<RowValue>>,
    /// Total rows in the source file if known, else `None`. CSV computes on
    /// first preview and caches; Parquet (later) reads from footer.
    pub total: Option<usize>,
    /// Echo back the offset that was served so the viewer can render
    /// "rows N–M of T" without trusting its own request state.
    pub offset: usize,
}
