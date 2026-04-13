use crate::dag::CellDag;
use serde::Serialize;

/// Reactive execution result — tells the frontend which cells went stale
/// and what the current dependency graph looks like.
#[derive(Debug, Clone, Serialize)]
pub struct ReactiveUpdate {
    pub stale_cells: Vec<String>,
    pub dag: crate::dag::DagSnapshot,
}

/// Analyze all cells, find what's stale after the given cell executed.
/// This is the main entry point that the server calls after each execution.
pub fn compute_reactive_update(cells: &[(String, &str)], executed_cell_id: &str) -> ReactiveUpdate {
    let mut dag = CellDag::new();
    dag.rebuild(cells);

    let stale = dag.stale_cells(executed_cell_id);
    let snapshot = dag.snapshot();

    ReactiveUpdate {
        stale_cells: stale,
        dag: snapshot,
    }
}
