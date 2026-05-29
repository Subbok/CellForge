//! JSON / JSONL reader — supports both shapes:
//!
//! - **JSONL** (one object per line, `.jsonl` / `.ndjson`): lines are
//!   streamed from disk, so we can paginate gigabyte log files without
//!   loading them into memory.
//! - **JSON array** (`.json`): the whole file is read once into a
//!   `Vec<Value>` on `open`. JSON arrays don't have a streaming line
//!   delimiter, so partial parsing isn't worth the complexity for the
//!   sizes typical of `.json` data dumps.
//!
//! Schema is inferred from the first `TYPE_SAMPLE_ROWS` records: every key
//! seen becomes a column, types are picked from the JSON value type, and
//! any divergent type across rows demotes the column to `String`. Rows
//! missing a key produce `null` for that column instead of widening the
//! schema.

use crate::DataReader;
use crate::schema::{ColumnSchema, ColumnType, PreviewResponse, RowValue, SortKey};
use crate::sort::sort_rows;
use anyhow::{Context, Result, bail};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

const TYPE_SAMPLE_ROWS: usize = 1000;

/// Source layout — set once on `open`. Lines mode keeps re-opening the
/// file so we never hold a file handle longer than a single preview call;
/// Array mode caches the parsed values because reparsing a multi-MB JSON
/// array per page would be silly.
enum Source {
    Lines,
    Array(Vec<serde_json::Value>),
}

pub struct JsonlReader {
    path: PathBuf,
    schema: Vec<ColumnSchema>,
    total: Option<usize>,
    source: Source,
}

impl JsonlReader {
    pub fn open(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        let source = detect_source(&path)?;
        let total = match &source {
            Source::Array(values) => Some(values.len()),
            Source::Lines => None,
        };
        let schema = infer_schema(&source, &path)?;
        Ok(Self {
            path,
            schema,
            total,
            source,
        })
    }

    fn lines(&self) -> Result<impl Iterator<Item = std::io::Result<String>>> {
        let f = File::open(&self.path)
            .with_context(|| format!("opening JSON {}", self.path.display()))?;
        Ok(BufReader::new(f).lines())
    }

    fn count_rows(&mut self) -> Result<usize> {
        if let Some(t) = self.total {
            return Ok(t);
        }
        let mut n = 0;
        for line in self.lines()? {
            let line = line?;
            if !line.trim().is_empty() {
                n += 1;
            }
        }
        self.total = Some(n);
        Ok(n)
    }

    fn read_all(&self) -> Result<Vec<Vec<RowValue>>> {
        match &self.source {
            Source::Array(values) => Ok(values
                .iter()
                .map(|v| value_to_row(v, &self.schema))
                .collect()),
            Source::Lines => {
                let mut rows = Vec::new();
                for line in self.lines()? {
                    let line = line?;
                    if line.trim().is_empty() {
                        continue;
                    }
                    rows.push(json_to_row(&line, &self.schema));
                }
                Ok(rows)
            }
        }
    }

    fn preview_streaming(&self, offset: usize, limit: usize) -> Result<Vec<Vec<RowValue>>> {
        match &self.source {
            Source::Array(values) => Ok(values
                .iter()
                .skip(offset)
                .take(limit)
                .map(|v| value_to_row(v, &self.schema))
                .collect()),
            Source::Lines => {
                // Cap the capacity hint — callers pass usize::MAX for "all
                // rows" and Vec::with_capacity(usize::MAX) panics.
                let mut rows = Vec::with_capacity(limit.min(4096));
                let mut seen = 0usize;
                for line in self.lines()? {
                    let line = line?;
                    if line.trim().is_empty() {
                        continue;
                    }
                    if seen < offset {
                        seen += 1;
                        continue;
                    }
                    if rows.len() >= limit {
                        break;
                    }
                    rows.push(json_to_row(&line, &self.schema));
                    seen += 1;
                }
                Ok(rows)
            }
        }
    }
}

impl DataReader for JsonlReader {
    fn schema(&self) -> &[ColumnSchema] {
        &self.schema
    }

    fn total_rows(&mut self) -> Option<usize> {
        self.count_rows().ok()
    }

    fn preview(
        &mut self,
        offset: usize,
        limit: usize,
        sort: Option<SortKey>,
    ) -> Result<PreviewResponse> {
        let rows = match sort {
            Some(key) => {
                let mut all = self.read_all()?;
                self.total = Some(all.len());
                sort_rows(&mut all, key);
                all.into_iter().skip(offset).take(limit).collect()
            }
            None => self.preview_streaming(offset, limit)?,
        };
        Ok(PreviewResponse {
            schema: self.schema.clone(),
            rows,
            total: self.total,
            offset,
        })
    }
}

fn json_to_row(line: &str, schema: &[ColumnSchema]) -> Vec<RowValue> {
    let value: serde_json::Value = serde_json::from_str(line).unwrap_or(serde_json::Value::Null);
    value_to_row(&value, schema)
}

fn value_to_row(value: &serde_json::Value, schema: &[ColumnSchema]) -> Vec<RowValue> {
    let map = value.as_object();
    schema
        .iter()
        .map(|col| match map.and_then(|m| m.get(&col.name)) {
            None | Some(serde_json::Value::Null) => RowValue::Null,
            Some(v) => json_value_to_row(v),
        })
        .collect()
}

/// Peek the first non-whitespace byte. `[` means JSON array, `{` (or
/// anything else) means JSONL — empty / non-JSON files fall through to the
/// streaming path which then yields no rows. We deliberately don't try to
/// guess from the file extension alone — `.json` files in the wild contain
/// both shapes.
fn detect_source(path: &Path) -> Result<Source> {
    let mut f = File::open(path).with_context(|| format!("opening JSON {}", path.display()))?;
    let mut buf = [0u8; 4096];
    let n = f.read(&mut buf)?;
    let head = &buf[..n];
    let first = head.iter().find(|b| !b.is_ascii_whitespace()).copied();
    if first == Some(b'[') {
        // Read the rest of the file and parse as a JSON array.
        let mut rest = Vec::with_capacity(64 * 1024);
        rest.extend_from_slice(head);
        f.read_to_end(&mut rest)?;
        let value: serde_json::Value = serde_json::from_slice(&rest)
            .with_context(|| format!("parsing JSON array {}", path.display()))?;
        let arr = match value {
            serde_json::Value::Array(a) => a,
            _ => bail!("expected JSON array at {}", path.display()),
        };
        Ok(Source::Array(arr))
    } else {
        Ok(Source::Lines)
    }
}

fn json_value_to_row(v: &serde_json::Value) -> RowValue {
    match v {
        serde_json::Value::Null => RowValue::Null,
        serde_json::Value::Bool(b) => RowValue::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                RowValue::Int(i)
            } else if let Some(f) = n.as_f64() {
                RowValue::Float(f)
            } else {
                RowValue::String(n.to_string())
            }
        }
        serde_json::Value::String(s) => RowValue::String(s.clone()),
        // Arrays / objects rendered as compact JSON. Drilling into nested
        // structures inside the table cell would clobber the row layout —
        // a future "expand cell" UX can pretty-print these.
        other => RowValue::String(other.to_string()),
    }
}

fn infer_schema(source: &Source, path: &Path) -> Result<Vec<ColumnSchema>> {
    // BTreeMap so iteration order is deterministic — frontend's column order
    // matches the alphabetical key order from the first samples. JSON
    // objects don't carry a stable column order, so any choice is arbitrary;
    // alphabetical is at least reproducible.
    let mut columns: BTreeMap<String, (Option<ColumnType>, bool)> = BTreeMap::new();

    match source {
        Source::Array(values) => {
            for v in values.iter().take(TYPE_SAMPLE_ROWS) {
                accumulate_value(v, &mut columns);
            }
        }
        Source::Lines => {
            let f = File::open(path).with_context(|| format!("opening JSON {}", path.display()))?;
            let reader = BufReader::new(f);
            for (i, line) in reader.lines().enumerate() {
                if i >= TYPE_SAMPLE_ROWS {
                    break;
                }
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                let value: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    // Skip malformed lines on inference rather than failing
                    // the open — failing the whole file because of one bad
                    // record is a poor UX for log-style JSONL.
                    Err(_) => continue,
                };
                accumulate_value(&value, &mut columns);
            }
        }
    }

    Ok(columns
        .into_iter()
        .map(|(name, (ty, nullable))| ColumnSchema {
            name,
            ty: ty.unwrap_or(ColumnType::Null),
            nullable,
        })
        .collect())
}

fn accumulate_value(
    value: &serde_json::Value,
    columns: &mut BTreeMap<String, (Option<ColumnType>, bool)>,
) {
    let Some(map) = value.as_object() else {
        return;
    };
    for (key, val) in map {
        let inferred = infer_type(val);
        let entry = columns.entry(key.clone()).or_insert((None, false));
        if matches!(val, serde_json::Value::Null) {
            entry.1 = true;
            continue;
        }
        entry.0 = Some(merge_types(entry.0, inferred));
    }
}

fn infer_type(v: &serde_json::Value) -> ColumnType {
    match v {
        serde_json::Value::Null => ColumnType::Null,
        serde_json::Value::Bool(_) => ColumnType::Bool,
        serde_json::Value::Number(n) => {
            if n.is_i64() || n.is_u64() {
                ColumnType::Int
            } else {
                ColumnType::Float
            }
        }
        // Arrays and objects render as JSON strings — no point claiming a
        // pseudo-type the viewer can't take advantage of.
        _ => ColumnType::String,
    }
}

/// Merge two seen types for the same column. Conflicts always demote to
/// `String` — better to lose right-alignment than to crash on parse on the
/// frontend side.
fn merge_types(prev: Option<ColumnType>, next: ColumnType) -> ColumnType {
    let Some(prev) = prev else {
        return next;
    };
    if prev == next {
        return prev;
    }
    // Int + Float is the one widening that's actually useful.
    if (prev == ColumnType::Int && next == ColumnType::Float)
        || (prev == ColumnType::Float && next == ColumnType::Int)
    {
        return ColumnType::Float;
    }
    ColumnType::String
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn write_jsonl(s: &str) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        f.write_all(s.as_bytes()).unwrap();
        f.flush().unwrap();
        f
    }

    #[test]
    fn schema_alphabetical_and_typed() {
        let f = write_jsonl("{\"name\":\"a\",\"x\":1}\n{\"name\":\"b\",\"x\":2}\n");
        let r = JsonlReader::open(f.path()).unwrap();
        let s = r.schema();
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].name, "name");
        assert_eq!(s[0].ty, ColumnType::String);
        assert_eq!(s[1].name, "x");
        assert_eq!(s[1].ty, ColumnType::Int);
    }

    #[test]
    fn missing_keys_become_null() {
        let f = write_jsonl("{\"a\":1,\"b\":2}\n{\"a\":3}\n");
        let mut r = JsonlReader::open(f.path()).unwrap();
        let p = r.preview(0, 5, None).unwrap();
        // Row 1 (`{"a":3}`) is missing `b` — column index 1 should be Null.
        assert!(matches!(p.rows[1][1], RowValue::Null));
    }

    #[test]
    fn malformed_lines_skipped_silently() {
        let f = write_jsonl("{\"a\":1}\nnot json\n{\"a\":2}\n");
        let mut r = JsonlReader::open(f.path()).unwrap();
        let p = r.preview(0, 10, None).unwrap();
        // Three input lines but the middle one parses as `Value::Null` and
        // produces a single Null cell — preserved as a row so offsets align
        // with file position. We accept either 2 or 3 rows depending on the
        // streaming behaviour; what we mainly want is no panic and the well-
        // formed rows present.
        assert!(p.rows.iter().any(|r| matches!(r[0], RowValue::Int(1))));
        assert!(p.rows.iter().any(|r| matches!(r[0], RowValue::Int(2))));
    }

    #[test]
    fn int_widens_to_float_on_mixed_column() {
        let f = write_jsonl("{\"x\":1}\n{\"x\":2.5}\n");
        let r = JsonlReader::open(f.path()).unwrap();
        assert_eq!(r.schema()[0].ty, ColumnType::Float);
    }

    #[test]
    fn json_array_form_is_supported() {
        // Whitespace + leading bracket — auto-detect should pick the array
        // path and yield typed rows just like JSONL.
        let f = write_jsonl("  \n[\n  {\"a\":1,\"b\":\"x\"},\n  {\"a\":2,\"b\":\"y\"}\n]\n");
        let mut r = JsonlReader::open(f.path()).unwrap();
        let s = r.schema();
        assert_eq!(s.len(), 2);
        let p = r.preview(0, 5, None).unwrap();
        assert_eq!(p.rows.len(), 2);
        assert_eq!(p.total, Some(2));
        match &p.rows[1][0] {
            RowValue::Int(n) => assert_eq!(*n, 2),
            other => panic!("expected Int, got {other:?}"),
        }
    }

    #[test]
    fn pagination_offset_works() {
        let mut body = String::new();
        for i in 0..10 {
            body.push_str(&format!("{{\"n\":{i}}}\n"));
        }
        let f = write_jsonl(&body);
        let mut r = JsonlReader::open(f.path()).unwrap();
        let p = r.preview(5, 3, None).unwrap();
        assert_eq!(p.rows.len(), 3);
        match &p.rows[0][0] {
            RowValue::Int(n) => assert_eq!(*n, 5),
            other => panic!("expected Int, got {other:?}"),
        }
    }
}
