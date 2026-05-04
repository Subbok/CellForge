//! Per-column statistics computed once on demand.
//!
//! The viewer asks for these via a separate `/stats` route so a heavy column
//! summary doesn't slow down ordinary pagination. We do one pass over the
//! file, accumulating count / null / distinct / min / max / mean per column;
//! distinct is capped at `MAX_DISTINCT` to bound memory on high-cardinality
//! columns (URLs, GUIDs) where the exact count isn't useful anyway.

use crate::DataReader;
use crate::schema::{ColumnSchema, ColumnStats, ColumnType, RowValue, StatsResponse};
use anyhow::Result;
use std::collections::HashSet;

/// Past this many distinct values we stop tracking the set and report
/// `None` — the viewer renders that as "—" rather than a misleading capped
/// number.
const MAX_DISTINCT: usize = 10_000;

pub fn compute(reader: &mut dyn DataReader) -> Result<StatsResponse> {
    let schema: Vec<ColumnSchema> = reader.schema().to_vec();
    // Pull *all* rows. For the data crate's current scale (CSV/JSONL up to
    // a few hundred MB, Parquet usually smaller) this is acceptable; if a
    // gigabyte file appears the route caps response size before we get here
    // — we'd revisit then with a streaming aggregator.
    let preview = reader.preview(0, usize::MAX, None)?;
    let total = preview.rows.len();

    let mut accum: Vec<ColumnAccum> = (0..schema.len()).map(|_| ColumnAccum::new()).collect();
    for row in &preview.rows {
        for (i, val) in row.iter().enumerate() {
            if let Some(a) = accum.get_mut(i) {
                a.observe(val);
            }
        }
    }

    let stats = accum
        .into_iter()
        .enumerate()
        .map(|(i, a)| a.finish(i, schema.get(i).map(|c| c.ty).unwrap_or(ColumnType::String)))
        .collect();

    Ok(StatsResponse {
        schema,
        stats,
        total,
    })
}

struct ColumnAccum {
    count: usize,
    null_count: usize,
    /// Population sum / numeric count for the mean. Kept as f64 to handle
    /// `Int` and `Float` uniformly without a second branch on finish.
    num_sum: f64,
    num_count: usize,
    min_num: Option<f64>,
    max_num: Option<f64>,
    min_str: Option<String>,
    max_str: Option<String>,
    distinct: Option<HashSet<String>>,
}

impl ColumnAccum {
    fn new() -> Self {
        Self {
            count: 0,
            null_count: 0,
            num_sum: 0.0,
            num_count: 0,
            min_num: None,
            max_num: None,
            min_str: None,
            max_str: None,
            distinct: Some(HashSet::new()),
        }
    }

    fn observe(&mut self, v: &RowValue) {
        self.count += 1;
        match v {
            RowValue::Null => {
                self.null_count += 1;
            }
            RowValue::Int(n) => {
                self.observe_num(*n as f64);
                self.observe_str(n.to_string());
            }
            RowValue::Float(n) => {
                self.observe_num(*n);
                self.observe_str(n.to_string());
            }
            RowValue::Bool(b) => {
                self.observe_str(b.to_string());
            }
            RowValue::String(s) => {
                self.observe_str(s.clone());
            }
        }
    }

    fn observe_num(&mut self, n: f64) {
        self.num_sum += n;
        self.num_count += 1;
        self.min_num = Some(self.min_num.map_or(n, |m| m.min(n)));
        self.max_num = Some(self.max_num.map_or(n, |m| m.max(n)));
    }

    fn observe_str(&mut self, s: String) {
        self.min_str = Some(match self.min_str.take() {
            None => s.clone(),
            Some(prev) => {
                if s < prev {
                    s.clone()
                } else {
                    prev
                }
            }
        });
        self.max_str = Some(match self.max_str.take() {
            None => s.clone(),
            Some(prev) => {
                if s > prev {
                    s.clone()
                } else {
                    prev
                }
            }
        });
        if let Some(d) = self.distinct.as_mut() {
            d.insert(s);
            if d.len() > MAX_DISTINCT {
                self.distinct = None;
            }
        }
    }

    fn finish(self, column: usize, ty: ColumnType) -> ColumnStats {
        let is_numeric = matches!(ty, ColumnType::Int | ColumnType::Float);
        let mean = if is_numeric && self.num_count > 0 {
            Some(self.num_sum / self.num_count as f64)
        } else {
            None
        };
        let (min, max) = if is_numeric {
            (
                self.min_num.and_then(num_to_value),
                self.max_num.and_then(num_to_value),
            )
        } else {
            (
                self.min_str.map(serde_json::Value::String),
                self.max_str.map(serde_json::Value::String),
            )
        };
        ColumnStats {
            column,
            count: self.count,
            null_count: self.null_count,
            distinct: self.distinct.map(|d| d.len()),
            min,
            max,
            mean,
        }
    }
}

fn num_to_value(n: f64) -> Option<serde_json::Value> {
    serde_json::Number::from_f64(n).map(serde_json::Value::Number)
}
