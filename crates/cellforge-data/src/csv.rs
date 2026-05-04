use crate::DataReader;
use crate::schema::{ColumnSchema, ColumnType, PreviewResponse, RowValue, SortKey};
use crate::sort::sort_rows;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

/// Number of rows scanned to infer column types. Larger samples catch more
/// edge cases (a column that's 99 % integers but has one float on row 500),
/// but reading thousands of rows just to render a 500-row preview wastes I/O.
/// 1000 is a pragmatic compromise: enough to catch most type drift, cheap
/// enough that even 10 MB files finish inference in <50 ms.
const TYPE_SAMPLE_ROWS: usize = 1000;

pub struct CsvReader {
    path: PathBuf,
    schema: Vec<ColumnSchema>,
    /// Cached row count. Computed lazily on first `total_rows()` /
    /// `preview()` with sort, since a full pass over a big CSV is expensive
    /// — pure paginated scrolling never needs it.
    total: Option<usize>,
}

impl CsvReader {
    pub fn open(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        let schema = infer_schema(&path)?;
        Ok(Self {
            path,
            schema,
            total: None,
        })
    }

    fn reader(&self) -> Result<csv::Reader<std::fs::File>> {
        csv::ReaderBuilder::new()
            .has_headers(true)
            .flexible(true)
            .from_path(&self.path)
            .with_context(|| format!("opening CSV {}", self.path.display()))
    }

    fn count_rows(&mut self) -> Result<usize> {
        if let Some(t) = self.total {
            return Ok(t);
        }
        let mut rdr = self.reader()?;
        let mut n = 0;
        for r in rdr.records() {
            r?;
            n += 1;
        }
        self.total = Some(n);
        Ok(n)
    }

    /// Read every row into memory and materialise as `RowValue`s. Used by
    /// the sort path and `count_rows + preview` when the caller asked for a
    /// row count up front. For unsorted, paginated reads we use the
    /// streaming `preview_streaming` path instead — that one stays O(offset
    /// + limit) in I/O and never allocates the full file.
    fn read_all(&self) -> Result<Vec<Vec<RowValue>>> {
        let mut rdr = self.reader()?;
        let mut rows = Vec::new();
        for record in rdr.records() {
            let record = record?;
            rows.push(record_to_row(&record, &self.schema));
        }
        Ok(rows)
    }

    fn preview_streaming(&self, offset: usize, limit: usize) -> Result<Vec<Vec<RowValue>>> {
        let mut rdr = self.reader()?;
        let mut rows = Vec::with_capacity(limit);
        for (i, record) in rdr.records().enumerate() {
            if i < offset {
                // Even when skipping we have to consume the record to advance
                // the stream — `csv` doesn't expose a cheap line-skip and the
                // file might have multi-line quoted fields.
                record?;
                continue;
            }
            if rows.len() >= limit {
                break;
            }
            let record = record?;
            rows.push(record_to_row(&record, &self.schema));
        }
        Ok(rows)
    }
}

impl DataReader for CsvReader {
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

fn record_to_row(record: &csv::StringRecord, schema: &[ColumnSchema]) -> Vec<RowValue> {
    schema
        .iter()
        .enumerate()
        .map(|(i, col)| {
            let raw = record.get(i).unwrap_or("");
            cell_to_value(raw, col.ty)
        })
        .collect()
}

fn cell_to_value(raw: &str, ty: ColumnType) -> RowValue {
    if raw.is_empty() {
        return RowValue::Null;
    }
    match ty {
        ColumnType::Int => raw
            .parse::<i64>()
            .map(RowValue::Int)
            .unwrap_or_else(|_| RowValue::String(raw.to_string())),
        ColumnType::Float => raw
            .parse::<f64>()
            .map(RowValue::Float)
            .unwrap_or_else(|_| RowValue::String(raw.to_string())),
        ColumnType::Bool => match raw.to_ascii_lowercase().as_str() {
            "true" | "t" | "yes" | "y" | "1" => RowValue::Bool(true),
            "false" | "f" | "no" | "n" | "0" => RowValue::Bool(false),
            _ => RowValue::String(raw.to_string()),
        },
        // Dates and Strings stay as strings on the wire — viewer formats
        // dates client-side. We don't normalise here because users often
        // *want* to see the original spelling.
        ColumnType::Date | ColumnType::String | ColumnType::Null => {
            RowValue::String(raw.to_string())
        }
    }
}

fn infer_schema(path: &Path) -> Result<Vec<ColumnSchema>> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_path(path)
        .with_context(|| format!("opening CSV {}", path.display()))?;

    let headers = rdr.headers()?.clone();
    let mut samples: Vec<Vec<String>> = vec![Vec::new(); headers.len()];
    for (i, record) in rdr.records().enumerate() {
        if i >= TYPE_SAMPLE_ROWS {
            break;
        }
        let record = record?;
        for (col, sample) in samples.iter_mut().enumerate() {
            sample.push(record.get(col).unwrap_or("").to_string());
        }
    }

    Ok(headers
        .iter()
        .enumerate()
        .map(|(i, name)| {
            let sample = samples.get(i).map(Vec::as_slice).unwrap_or(&[]);
            let (ty, nullable) = infer_column(sample);
            ColumnSchema {
                name: name.to_string(),
                ty,
                nullable,
            }
        })
        .collect())
}

fn infer_column(samples: &[String]) -> (ColumnType, bool) {
    let mut nullable = false;
    let mut all_int = true;
    let mut all_float = true;
    let mut all_bool = true;
    let mut all_date = true;
    let mut any_value = false;

    for raw in samples {
        if raw.is_empty() {
            nullable = true;
            continue;
        }
        any_value = true;
        if raw.parse::<i64>().is_err() {
            all_int = false;
        }
        if raw.parse::<f64>().is_err() {
            all_float = false;
        }
        let lower = raw.to_ascii_lowercase();
        if !matches!(
            lower.as_str(),
            "true" | "false" | "t" | "f" | "yes" | "no" | "y" | "n" | "0" | "1"
        ) {
            all_bool = false;
        }
        if !looks_like_date(raw) {
            all_date = false;
        }
    }

    let ty = if !any_value {
        ColumnType::Null
    } else if all_int {
        ColumnType::Int
    } else if all_float {
        ColumnType::Float
    } else if all_bool {
        ColumnType::Bool
    } else if all_date {
        ColumnType::Date
    } else {
        ColumnType::String
    };
    (ty, nullable)
}

fn looks_like_date(s: &str) -> bool {
    // Accept the three common ISO-ish forms. Anything else falls through to
    // `String` — we'd rather miss exotic formats than mistype a column and
    // lose right-alignment on values that really are strings.
    let bytes = s.as_bytes();
    let date_prefix = bytes.len() >= 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[8..10].iter().all(u8::is_ascii_digit);
    if !date_prefix {
        return false;
    }
    if s.len() == 10 {
        return true;
    }
    let sep = s.as_bytes()[10];
    sep == b'T' || sep == b' '
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SortDir;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn write_csv(s: &str) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        f.write_all(s.as_bytes()).unwrap();
        f.flush().unwrap();
        f
    }

    #[test]
    fn schema_infers_basic_types() {
        let f = write_csv("a,b,c,d\n1,1.5,true,2024-01-15\n2,2.5,false,2024-02-01\n");
        let r = CsvReader::open(f.path()).unwrap();
        let s = r.schema();
        assert_eq!(s[0].ty, ColumnType::Int);
        assert_eq!(s[1].ty, ColumnType::Float);
        assert_eq!(s[2].ty, ColumnType::Bool);
        assert_eq!(s[3].ty, ColumnType::Date);
    }

    #[test]
    fn schema_promotes_int_to_float_when_decimal_present() {
        let f = write_csv("x\n1\n2\n3.5\n");
        let r = CsvReader::open(f.path()).unwrap();
        assert_eq!(r.schema()[0].ty, ColumnType::Float);
    }

    #[test]
    fn schema_marks_nullable_columns() {
        let f = write_csv("x,y\n1,a\n,b\n3,\n");
        let r = CsvReader::open(f.path()).unwrap();
        assert!(r.schema()[0].nullable);
        assert!(r.schema()[1].nullable);
    }

    #[test]
    fn preview_paginates_without_sort() {
        let mut body = String::from("n\n");
        for i in 0..10 {
            body.push_str(&format!("{i}\n"));
        }
        let f = write_csv(&body);
        let mut r = CsvReader::open(f.path()).unwrap();
        let p = r.preview(5, 3, None).unwrap();
        assert_eq!(p.rows.len(), 3);
        assert_eq!(p.offset, 5);
        match &p.rows[0][0] {
            RowValue::Int(n) => assert_eq!(*n, 5),
            other => panic!("expected Int, got {other:?}"),
        }
    }

    #[test]
    fn preview_with_sort_returns_offset_within_sorted_view() {
        let f = write_csv("n\n3\n1\n2\n5\n4\n");
        let mut r = CsvReader::open(f.path()).unwrap();
        let key = SortKey {
            column: 0,
            dir: SortDir::Asc,
        };
        let p = r.preview(0, 3, Some(key)).unwrap();
        let nums: Vec<i64> = p
            .rows
            .iter()
            .map(|r| match r[0] {
                RowValue::Int(n) => n,
                _ => -1,
            })
            .collect();
        assert_eq!(nums, vec![1, 2, 3]);
        // total is computed as a side effect of sorting, which read all rows
        assert_eq!(p.total, Some(5));
    }

    #[test]
    fn null_cells_become_null_value() {
        // Empty *fields* (between commas), not empty *rows* — the csv crate
        // skips fully blank lines, which would also be the right behaviour
        // for the viewer.
        let f = write_csv("x,y\n1,a\n,b\n3,c\n");
        let mut r = CsvReader::open(f.path()).unwrap();
        let p = r.preview(0, 5, None).unwrap();
        assert!(matches!(p.rows[1][0], RowValue::Null));
    }
}
