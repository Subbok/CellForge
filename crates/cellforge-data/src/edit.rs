//! Single-cell edits with write-back for CSV/TSV and JSON/JSONL files.
//!
//! The data viewer is otherwise read-only; this module backs inline cell
//! editing. Edits are addressed by the **file** row index (header excluded),
//! which is only meaningful for the unsorted, unfiltered view — the caller
//! (route + frontend) enforces that.
//!
//! Parquet is intentionally NOT supported (columnar binary format).

use crate::schema::ColumnType;
use anyhow::{Result, anyhow};
use serde_json::{Number, Value};
use std::path::Path;

/// Update one cell in a CSV file. Mirrors `CsvReader`'s parsing (default comma
/// delimiter, header row, flexible row lengths) and rewrites the whole file.
/// `row` is the 0-based data row (the header is row -1). Values are stored as
/// text, like every CSV cell.
pub fn set_csv_cell(path: &Path, row: usize, col: usize, value: &str) -> Result<()> {
    let delimiter = crate::csv::delimiter_for(path);
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .delimiter(delimiter)
        .from_path(path)?;
    let headers = rdr.headers()?.clone();
    let mut records: Vec<csv::StringRecord> = Vec::new();
    for r in rdr.records() {
        records.push(r?);
    }
    drop(rdr); // release the read handle before truncating the file for write

    let nrows = records.len();
    let rec = records
        .get_mut(row)
        .ok_or_else(|| anyhow!("row {row} out of range ({nrows} rows)"))?;
    let mut fields: Vec<String> = rec.iter().map(|s| s.to_string()).collect();
    if col >= fields.len() {
        // pad ragged rows so the edited column exists
        fields.resize(col + 1, String::new());
    }
    fields[col] = value.to_string();
    *rec = csv::StringRecord::from(fields);

    let mut wtr = csv::WriterBuilder::new()
        .delimiter(delimiter)
        .from_path(path)?;
    wtr.write_record(&headers)?;
    for r in &records {
        wtr.write_record(r)?;
    }
    wtr.flush()?;
    Ok(())
}

/// Update one cell in a JSON (array of objects) or JSONL file. The cell is the
/// `col_name` field of the `row`-th record. The value is coerced to the
/// column's JSON type so numeric/bool columns stay numeric/bool.
pub fn set_json_cell(
    path: &Path,
    col_name: &str,
    col_ty: ColumnType,
    row: usize,
    value: &str,
) -> Result<()> {
    let text = std::fs::read_to_string(path)?;
    let coerced = coerce(value, col_ty);

    if text.trim_start().starts_with('[') {
        // JSON array of objects.
        let mut arr: Vec<Value> = serde_json::from_str(&text)?;
        let len = arr.len();
        let obj = arr
            .get_mut(row)
            .ok_or_else(|| anyhow!("row {row} out of range ({len} rows)"))?;
        set_field(obj, col_name, coerced)?;
        std::fs::write(path, serde_json::to_string_pretty(&arr)?)?;
    } else {
        // JSONL — one object per non-empty line.
        let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
        let mut seen = 0usize;
        let mut target: Option<usize> = None;
        for (i, l) in lines.iter().enumerate() {
            if l.trim().is_empty() {
                continue;
            }
            if seen == row {
                target = Some(i);
                break;
            }
            seen += 1;
        }
        let idx = target.ok_or_else(|| anyhow!("row {row} out of range"))?;
        let mut obj: Value = serde_json::from_str(&lines[idx])?;
        set_field(&mut obj, col_name, coerced)?;
        lines[idx] = serde_json::to_string(&obj)?;
        std::fs::write(path, lines.join("\n") + "\n")?;
    }
    Ok(())
}

fn set_field(obj: &mut Value, name: &str, val: Value) -> Result<()> {
    match obj {
        Value::Object(map) => {
            map.insert(name.to_string(), val);
            Ok(())
        }
        _ => Err(anyhow!("record is not a JSON object")),
    }
}

fn coerce(value: &str, ty: ColumnType) -> Value {
    if value.is_empty() {
        return Value::Null;
    }
    match ty {
        ColumnType::Int => value
            .parse::<i64>()
            .map(Value::from)
            .unwrap_or_else(|_| Value::String(value.to_string())),
        ColumnType::Float => value
            .parse::<f64>()
            .ok()
            .and_then(Number::from_f64)
            .map(Value::Number)
            .unwrap_or_else(|| Value::String(value.to_string())),
        ColumnType::Bool => match value.to_ascii_lowercase().as_str() {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            _ => Value::String(value.to_string()),
        },
        // Date and String (and any future text type) stay as strings.
        _ => Value::String(value.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn tmp(ext: &str, body: &str) -> NamedTempFile {
        let f = tempfile::Builder::new()
            .suffix(&format!(".{ext}"))
            .tempfile()
            .unwrap();
        write!(f.as_file(), "{body}").unwrap();
        f
    }

    #[test]
    fn csv_cell_is_updated() {
        let f = tmp("csv", "a,b\n1,x\n2,y\n");
        set_csv_cell(f.path(), 1, 1, "ZZ").unwrap();
        let out = std::fs::read_to_string(f.path()).unwrap();
        assert!(out.contains("2,ZZ"), "got: {out}");
        assert!(out.contains("1,x"), "other rows preserved: {out}");
    }

    #[test]
    fn tsv_cell_uses_tab_delimiter() {
        let f = tmp("tsv", "a\tb\n1\tx\n2\ty\n");
        set_csv_cell(f.path(), 1, 1, "ZZ").unwrap();
        let out = std::fs::read_to_string(f.path()).unwrap();
        assert!(
            out.contains("2\tZZ"),
            "tab-separated write expected, got: {out}"
        );
    }

    #[test]
    fn jsonl_cell_is_updated_and_typed() {
        let f = tmp("jsonl", "{\"a\":1,\"b\":\"x\"}\n{\"a\":2,\"b\":\"y\"}\n");
        set_json_cell(f.path(), "a", ColumnType::Int, 1, "99").unwrap();
        let out = std::fs::read_to_string(f.path()).unwrap();
        // numeric coercion: 99 not "99"
        assert!(out.contains("\"a\":99"), "got: {out}");
    }

    #[test]
    fn json_array_cell_is_updated() {
        let f = tmp("json", "[{\"a\":1},{\"a\":2}]");
        set_json_cell(f.path(), "a", ColumnType::Int, 0, "7").unwrap();
        let arr: Vec<serde_json::Value> =
            serde_json::from_str(&std::fs::read_to_string(f.path()).unwrap()).unwrap();
        assert_eq!(arr[0]["a"], 7);
    }
}
