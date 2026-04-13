// maps notebook paths to kernel ids.
// for now this is trivial but it'll get more interesting when we
// support multiple notebooks open at once.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub struct SessionMap {
    // notebook path -> kernel id
    by_path: HashMap<PathBuf, String>,
}

impl SessionMap {
    pub fn new() -> Self {
        Self {
            by_path: HashMap::new(),
        }
    }

    pub fn bind(&mut self, notebook: &Path, kernel_id: String) {
        self.by_path.insert(notebook.to_path_buf(), kernel_id);
    }

    pub fn kernel_for(&self, notebook: &Path) -> Option<&str> {
        self.by_path.get(notebook).map(|s| s.as_str())
    }

    pub fn unbind(&mut self, notebook: &Path) {
        self.by_path.remove(notebook);
    }
}

impl Default for SessionMap {
    fn default() -> Self {
        Self::new()
    }
}
