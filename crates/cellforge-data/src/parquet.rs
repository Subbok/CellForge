//! Parquet preview reader.
//!
//! Uses `parquet`'s row-based reader (no Arrow dependency) — that's enough
//! for the viewer, which only needs typed cell values, and it keeps our
//! binary footprint smaller than the RecordBatch path. The footer holds the
//! total row count, so unlike CSV we never need a full pass to populate the
//! paginator total.

use crate::DataReader;
use crate::schema::{ColumnSchema, ColumnType, PreviewResponse, RowValue, SortKey};
use crate::sort::sort_rows;
use anyhow::{Context, Result};
use parquet::basic::{ConvertedType, LogicalType, Type as PhysicalType};
use parquet::file::reader::{FileReader, SerializedFileReader};
use parquet::record::{Field, Row};
use std::fs::File;
use std::path::PathBuf;

pub struct ParquetReader {
    path: PathBuf,
    schema: Vec<ColumnSchema>,
    /// Total rows from the footer — Parquet stores this so we can show it in
    /// the paginator without scanning. Set in `open()`.
    total_rows: usize,
}

impl ParquetReader {
    pub fn open(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        let file =
            File::open(&path).with_context(|| format!("opening Parquet {}", path.display()))?;
        let reader = SerializedFileReader::new(file)
            .with_context(|| format!("parsing Parquet {}", path.display()))?;
        let meta = reader.metadata();
        let total_rows = meta.file_metadata().num_rows() as usize;

        // Schema is derived from the file metadata. We walk the top-level
        // columns only — nested groups (lists, structs) collapse into a
        // single `String` column rendered as JSON.
        let parquet_schema = meta.file_metadata().schema_descr();
        let mut schema = Vec::with_capacity(parquet_schema.num_columns());
        for i in 0..parquet_schema.num_columns() {
            let col = parquet_schema.column(i);
            let name = col.name().to_string();
            let ty = map_type(
                col.physical_type(),
                col.logical_type_ref(),
                col.converted_type(),
            );
            schema.push(ColumnSchema {
                name,
                ty,
                // Parquet has explicit nullability per column. `definition_level`
                // > 0 on the leaf means the column can contain nulls.
                nullable: col.max_def_level() > 0,
            });
        }

        Ok(Self {
            path,
            schema,
            total_rows,
        })
    }

    fn reader(&self) -> Result<SerializedFileReader<File>> {
        let file = File::open(&self.path)
            .with_context(|| format!("opening Parquet {}", self.path.display()))?;
        SerializedFileReader::new(file)
            .with_context(|| format!("parsing Parquet {}", self.path.display()))
    }

    fn read_all(&self) -> Result<Vec<Vec<RowValue>>> {
        let reader = self.reader()?;
        let iter = reader.get_row_iter(None)?;
        let mut rows = Vec::new();
        for r in iter {
            let r = r?;
            rows.push(parquet_row_to_row(&r, &self.schema));
        }
        Ok(rows)
    }

    fn preview_streaming(&self, offset: usize, limit: usize) -> Result<Vec<Vec<RowValue>>> {
        let reader = self.reader()?;
        let iter = reader.get_row_iter(None)?;
        // Cap the capacity hint — callers pass usize::MAX for "all rows" and
        // Vec::with_capacity(usize::MAX) panics with capacity overflow.
        let mut rows = Vec::with_capacity(limit.min(4096));
        for (i, r) in iter.enumerate() {
            if i < offset {
                let _ = r?;
                continue;
            }
            if rows.len() >= limit {
                break;
            }
            let r = r?;
            rows.push(parquet_row_to_row(&r, &self.schema));
        }
        Ok(rows)
    }
}

impl DataReader for ParquetReader {
    fn schema(&self) -> &[ColumnSchema] {
        &self.schema
    }

    fn total_rows(&mut self) -> Option<usize> {
        Some(self.total_rows)
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
                sort_rows(&mut all, key);
                all.into_iter().skip(offset).take(limit).collect()
            }
            None => self.preview_streaming(offset, limit)?,
        };
        Ok(PreviewResponse {
            schema: self.schema.clone(),
            rows,
            total: Some(self.total_rows),
            offset,
        })
    }
}

fn parquet_row_to_row(r: &Row, schema: &[ColumnSchema]) -> Vec<RowValue> {
    schema
        .iter()
        .enumerate()
        .map(|(i, _col)| match r.get_column_iter().nth(i) {
            Some((_, field)) => field_to_value(field),
            None => RowValue::Null,
        })
        .collect()
}

fn field_to_value(f: &Field) -> RowValue {
    match f {
        Field::Null => RowValue::Null,
        Field::Bool(b) => RowValue::Bool(*b),
        Field::Byte(n) => RowValue::Int(*n as i64),
        Field::Short(n) => RowValue::Int(*n as i64),
        Field::Int(n) => RowValue::Int(*n as i64),
        Field::Long(n) => RowValue::Int(*n),
        Field::UByte(n) => RowValue::Int(*n as i64),
        Field::UShort(n) => RowValue::Int(*n as i64),
        Field::UInt(n) => RowValue::Int(*n as i64),
        Field::ULong(n) => {
            // u64 above i64::MAX gets stringified rather than silently
            // wrapping — losing precision in a viewer is worse than seeing
            // a string.
            if *n <= i64::MAX as u64 {
                RowValue::Int(*n as i64)
            } else {
                RowValue::String(n.to_string())
            }
        }
        Field::Float(n) => RowValue::Float(*n as f64),
        Field::Double(n) => RowValue::Float(*n),
        Field::Decimal(d) => RowValue::String(format!("{d:?}")),
        Field::Str(s) => RowValue::String(s.clone()),
        Field::Bytes(b) => RowValue::String(format!("<{} bytes>", b.len())),
        Field::Date(_) | Field::TimestampMillis(_) | Field::TimestampMicros(_) => {
            // Parquet exposes its own Display impl; the viewer formats the
            // string client-side.
            RowValue::String(format!("{f}"))
        }
        // Nested groups, lists, maps — render as JSON-ish strings. Drilling
        // into them would need a nested-cell UI we don't have yet.
        other => RowValue::String(format!("{other}")),
    }
}

fn map_type(
    physical: PhysicalType,
    logical: Option<&LogicalType>,
    converted: ConvertedType,
) -> ColumnType {
    // Logical types take precedence — they describe intent (DATE, STRING)
    // independent of how the column is physically encoded.
    if let Some(lt) = logical {
        match lt {
            LogicalType::String | LogicalType::Enum | LogicalType::Uuid | LogicalType::Json => {
                return ColumnType::String;
            }
            LogicalType::Date | LogicalType::Timestamp { .. } | LogicalType::Time { .. } => {
                return ColumnType::Date;
            }
            LogicalType::Integer { .. } => return ColumnType::Int,
            LogicalType::Decimal { .. } | LogicalType::Float16 => return ColumnType::Float,
            _ => {}
        }
    }
    // Pre-2.4 Parquet uses ConvertedType for the same intent.
    match converted {
        ConvertedType::UTF8 | ConvertedType::ENUM | ConvertedType::JSON => ColumnType::String,
        ConvertedType::DATE
        | ConvertedType::TIMESTAMP_MILLIS
        | ConvertedType::TIMESTAMP_MICROS
        | ConvertedType::TIME_MILLIS
        | ConvertedType::TIME_MICROS => ColumnType::Date,
        ConvertedType::DECIMAL => ColumnType::Float,
        _ => match physical {
            PhysicalType::BOOLEAN => ColumnType::Bool,
            PhysicalType::INT32 | PhysicalType::INT64 | PhysicalType::INT96 => ColumnType::Int,
            PhysicalType::FLOAT | PhysicalType::DOUBLE => ColumnType::Float,
            PhysicalType::BYTE_ARRAY | PhysicalType::FIXED_LEN_BYTE_ARRAY => ColumnType::String,
        },
    }
}
