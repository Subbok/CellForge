use crate::analyzer::{self, CellSymbols};
use indexmap::IndexMap;
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone, Serialize)]
pub struct DagSnapshot {
    pub edges: Vec<DagEdge>,
    pub conflicts: HashMap<String, Vec<String>>, // variable_name -> cell_ids
    pub cycles: Vec<Vec<String>>,                // list of cell_ids in cycles
}

#[derive(Debug, Clone, Serialize)]
pub struct DagEdge {
    pub from: String,
    pub to: String,
    pub names: Vec<String>,
}

pub struct CellDag {
    cells: IndexMap<String, CellSymbols>,
    forward_deps: HashMap<String, HashSet<String>>,
    conflicts: HashMap<String, Vec<String>>,
    cycles: Vec<Vec<String>>,
}

impl CellDag {
    pub fn new() -> Self {
        Self {
            cells: IndexMap::new(),
            forward_deps: HashMap::new(),
            conflicts: HashMap::new(),
            cycles: Vec::new(),
        }
    }

    pub fn rebuild(&mut self, cells: &[(String, &str)]) {
        self.cells.clear();
        self.forward_deps.clear();
        self.conflicts.clear();
        self.cycles.clear();

        // 1. Analyze symbols for each cell
        for (id, source) in cells {
            self.cells.insert(id.clone(), analyzer::analyze(source));
        }

        // 2. Identify conflicts (Multiple definitions of the same name)
        let mut name_to_cells: HashMap<String, Vec<String>> = HashMap::new();
        for (id, syms) in &self.cells {
            for def in &syms.defs {
                name_to_cells
                    .entry(def.clone())
                    .or_default()
                    .push(id.clone());
            }
        }

        for (name, ids) in name_to_cells {
            if ids.len() > 1 {
                self.conflicts.insert(name, ids);
            }
        }

        // 3. Build edges (Dependencies)
        let mut provider_map = HashMap::new();
        for (id, syms) in &self.cells {
            for def in &syms.defs {
                if !self.conflicts.contains_key(def) {
                    provider_map.insert(def.clone(), id.clone());
                }
            }
        }

        for (id, syms) in &self.cells {
            let mut deps = HashSet::new();
            for r in &syms.refs {
                if let Some(provider_id) = provider_map.get(r)
                    && provider_id != id
                {
                    deps.insert(provider_id.clone());
                }
            }
            if !deps.is_empty() {
                self.forward_deps.insert(id.clone(), deps);
            }
        }

        // 4. Cycle Detection
        self.find_cycles();
    }

    fn find_cycles(&mut self) {
        let mut visited = HashSet::new();
        let mut stack = Vec::new();
        let mut on_stack = HashSet::new();

        let ids: Vec<String> = self.cells.keys().cloned().collect();
        for id in ids {
            if !visited.contains(&id) {
                Self::dfs_cycles(
                    &id,
                    &self.forward_deps,
                    &mut visited,
                    &mut stack,
                    &mut on_stack,
                    &mut self.cycles,
                );
            }
        }
    }

    fn dfs_cycles(
        u: &str,
        forward_deps: &HashMap<String, HashSet<String>>,
        visited: &mut HashSet<String>,
        stack: &mut Vec<String>,
        on_stack: &mut HashSet<String>,
        cycles: &mut Vec<Vec<String>>,
    ) {
        visited.insert(u.to_string());
        stack.push(u.to_string());
        on_stack.insert(u.to_string());

        if let Some(deps) = forward_deps.get(u) {
            for v in deps {
                if on_stack.contains(v) {
                    // Cycle detected!
                    let mut cycle = Vec::new();
                    let mut found = false;
                    for node in stack.iter() {
                        if node == v {
                            found = true;
                        }
                        if found {
                            cycle.push(node.clone());
                        }
                    }
                    cycles.push(cycle);
                } else if !visited.contains(v) {
                    Self::dfs_cycles(v, forward_deps, visited, stack, on_stack, cycles);
                }
            }
        }

        on_stack.remove(u);
        stack.pop();
    }

    pub fn stale_cells(&self, changed_id: &str) -> Vec<String> {
        let mut affected = HashSet::new();
        let mut queue = VecDeque::new();
        queue.push_back(changed_id.to_string());

        while let Some(curr) = queue.pop_front() {
            for (candidate, candidate_deps) in &self.forward_deps {
                if candidate_deps.contains(&curr) && !affected.contains(candidate) {
                    affected.insert(candidate.clone());
                    queue.push_back(candidate.clone());
                }
            }
        }

        let mut result = Vec::new();
        let mut in_degree = HashMap::new();

        for id in &affected {
            let mut count = 0;
            if let Some(deps) = self.forward_deps.get(id) {
                for dep_id in deps {
                    if affected.contains(dep_id) {
                        count += 1;
                    }
                }
            }
            in_degree.insert(id.clone(), count);
        }

        let mut sources: VecDeque<_> = in_degree
            .iter()
            .filter(|&(_, &count)| count == 0)
            .map(|(id, _)| id.clone())
            .collect();

        let mut sources_vec: Vec<_> = sources.into_iter().collect();
        self.sort_by_notebook_order(&mut sources_vec);
        sources = sources_vec.into();

        while let Some(u) = sources.pop_front() {
            result.push(u.clone());
            for (v, v_deps) in &self.forward_deps {
                if affected.contains(v)
                    && v_deps.contains(&u)
                    && let Some(degree) = in_degree.get_mut(v)
                {
                    *degree -= 1;
                    if *degree == 0 {
                        sources.push_back(v.clone());
                    }
                }
            }
        }

        result
    }

    fn sort_by_notebook_order(&self, ids: &mut [String]) {
        let order: HashMap<_, _> = self
            .cells
            .keys()
            .enumerate()
            .map(|(i, id)| (id, i))
            .collect();
        ids.sort_by_key(|id| order.get(id).unwrap_or(&usize::MAX));
    }

    pub fn snapshot(&self) -> DagSnapshot {
        let mut edges = vec![];
        for (to_id, from_ids) in &self.forward_deps {
            let to_refs = &self.cells[to_id].refs;
            for from_id in from_ids {
                let from_defs = &self.cells[from_id].defs;
                let names: Vec<_> = to_refs.intersection(from_defs).cloned().collect();
                edges.push(DagEdge {
                    from: from_id.clone(),
                    to: to_id.clone(),
                    names,
                });
            }
        }
        DagSnapshot {
            edges,
            conflicts: self.conflicts.clone(),
            cycles: self.cycles.clone(),
        }
    }
}

impl Default for CellDag {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cells<'a>(pairs: &'a [(&str, &'a str)]) -> Vec<(String, &'a str)> {
        pairs
            .iter()
            .map(|(id, src)| (id.to_string(), *src))
            .collect()
    }

    #[test]
    fn linear_dependency() {
        let mut dag = CellDag::new();
        dag.rebuild(&cells(&[
            ("a", "x = 1"),
            ("b", "y = x + 1"),
            ("c", "z = y + 1"),
        ]));
        let stale = dag.stale_cells("a");
        assert!(stale.contains(&"b".to_string()));
        assert!(stale.contains(&"c".to_string()));
    }

    #[test]
    fn no_dependency_no_stale() {
        let mut dag = CellDag::new();
        dag.rebuild(&cells(&[("a", "x = 1"), ("b", "y = 2")]));
        let stale = dag.stale_cells("a");
        assert!(stale.is_empty(), "independent cells should not go stale");
    }

    #[test]
    fn diamond_dependency() {
        // a defines x, b and c both use x, d uses both b's and c's outputs
        let mut dag = CellDag::new();
        dag.rebuild(&cells(&[
            ("a", "x = 1"),
            ("b", "b_val = x + 10"),
            ("c", "c_val = x + 20"),
            ("d", "result = b_val + c_val"),
        ]));
        let stale = dag.stale_cells("a");
        assert!(stale.contains(&"b".to_string()));
        assert!(stale.contains(&"c".to_string()));
        assert!(stale.contains(&"d".to_string()));
    }

    #[test]
    fn conflict_detection() {
        let mut dag = CellDag::new();
        dag.rebuild(&cells(&[("a", "x = 1"), ("b", "x = 2")]));
        let snap = dag.snapshot();
        assert!(
            snap.conflicts.contains_key("x"),
            "x defined in two cells should be a conflict"
        );
        assert_eq!(snap.conflicts["x"].len(), 2);
    }

    #[test]
    fn cycle_detection() {
        // a defines x using y, b defines y using x
        let mut dag = CellDag::new();
        dag.rebuild(&cells(&[("a", "x = y + 1"), ("b", "y = x + 1")]));
        let snap = dag.snapshot();
        assert!(
            !snap.cycles.is_empty(),
            "mutual dependency should detect a cycle"
        );
    }

    #[test]
    fn snapshot_edges() {
        let mut dag = CellDag::new();
        dag.rebuild(&cells(&[("a", "x = 1"), ("b", "y = x + 1")]));
        let snap = dag.snapshot();
        assert_eq!(snap.edges.len(), 1);
        assert_eq!(snap.edges[0].from, "a");
        assert_eq!(snap.edges[0].to, "b");
        assert!(snap.edges[0].names.contains(&"x".to_string()));
    }

    #[test]
    fn stale_order_respects_notebook_order() {
        let mut dag = CellDag::new();
        dag.rebuild(&cells(&[
            ("a", "x = 1"),
            ("b", "y = x + 1"),
            ("c", "z = x + 2"),
        ]));
        let stale = dag.stale_cells("a");
        // b appears before c in notebook order, so should be first
        let b_pos = stale.iter().position(|s| s == "b");
        let c_pos = stale.iter().position(|s| s == "c");
        assert!(b_pos.is_some() && c_pos.is_some());
        assert!(
            b_pos.unwrap() < c_pos.unwrap(),
            "stale cells should follow notebook order"
        );
    }

    #[test]
    fn import_creates_dependency() {
        let mut dag = CellDag::new();
        dag.rebuild(&cells(&[
            ("a", "import pandas as pd"),
            ("b", "df = pd.read_csv('x.csv')"),
        ]));
        let stale = dag.stale_cells("a");
        assert!(stale.contains(&"b".to_string()));
    }
}
