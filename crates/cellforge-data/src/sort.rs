//! Row-level sorting shared by the CSV / JSONL / Parquet readers. Lives in
//! its own module so a new format adapter can pull `sort_rows` without
//! taking a dependency on the CSV crate.

use crate::schema::{RowValue, SortDir, SortKey};

pub fn sort_rows(rows: &mut [Vec<RowValue>], key: SortKey) {
    let col = key.column;
    rows.sort_by(|a, b| {
        let lhs = a.get(col);
        let rhs = b.get(col);
        let ord = compare_values(lhs, rhs);
        match key.dir {
            SortDir::Asc => ord,
            SortDir::Desc => ord.reverse(),
        }
    });
}

fn compare_values(a: Option<&RowValue>, b: Option<&RowValue>) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    match (a, b) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Less,
        (Some(_), None) => Ordering::Greater,
        (Some(x), Some(y)) => match (x, y) {
            // Null sorts first so missing data clusters at the top of an
            // ascending sort — matches pandas/Polars and the convention
            // most analysts expect.
            (RowValue::Null, RowValue::Null) => Ordering::Equal,
            (RowValue::Null, _) => Ordering::Less,
            (_, RowValue::Null) => Ordering::Greater,
            (RowValue::Int(p), RowValue::Int(q)) => p.cmp(q),
            (RowValue::Float(p), RowValue::Float(q)) => p.partial_cmp(q).unwrap_or(Ordering::Equal),
            (RowValue::Int(p), RowValue::Float(q)) => {
                (*p as f64).partial_cmp(q).unwrap_or(Ordering::Equal)
            }
            (RowValue::Float(p), RowValue::Int(q)) => {
                p.partial_cmp(&(*q as f64)).unwrap_or(Ordering::Equal)
            }
            (RowValue::Bool(p), RowValue::Bool(q)) => p.cmp(q),
            (RowValue::String(p), RowValue::String(q)) => p.cmp(q),
            // Mixed types: fall back to lexical comparison of the rendered
            // form. Rare in well-formed inputs and not worth a full
            // type-coercion ladder for the preview tab.
            (p, q) => format!("{:?}", p).cmp(&format!("{:?}", q)),
        },
    }
}
