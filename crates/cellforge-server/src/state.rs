use crate::config::Config;
use crate::plugins::{PluginSettings, load_plugin_settings};
use crate::ws::collab::CollabState;
use cellforge_auth::db::UserDb;
use cellforge_kernel::manager::KernelManager;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Build the composite key used for `AppState.notebook_kernels`.
///
/// Previously this map was keyed purely by the notebook's path relative to
/// the user workspace. Because every user has the same workspace layout,
/// user A opening `Untitled.ipynb` would collide with user B opening the
/// same-named file and attach them to the same kernel (cross-user kernel
/// hijack). Namespacing the key with the username keeps per-user kernels
/// isolated.
///
/// Unauthenticated callers fall back to `"anonymous"` in call sites, though
/// the WS handler currently rejects unauthenticated connections entirely —
/// the fallback exists only to avoid accidental collision if that guard is
/// ever relaxed.
pub fn notebook_kernel_key(username: &str, notebook_path: &str) -> String {
    format!("{username}::{notebook_path}")
}

pub struct AppState {
    pub notebook_dir: PathBuf,
    pub initial_notebook: Option<PathBuf>,
    pub sessions: RwLock<HashMap<String, SessionInfo>>,
    pub kernels: Mutex<KernelManager>,
    /// `"{username}::{notebook_path}" -> kernel_id`. Built via
    /// [`notebook_kernel_key`] — never key by the raw notebook path alone,
    /// that allows cross-user kernel hijack.
    pub notebook_kernels: Mutex<HashMap<String, String>>,
    pub users: UserDb,
    pub collab: Arc<CollabState>,
    /// Global plugin settings loaded from ~/.config/cellforge/settings.json,
    /// mutable via admin route POST /api/plugins/config.
    pub plugin_settings: RwLock<PluginSettings>,
    pub hub_mode: bool,
    #[allow(dead_code)] // will be used for hub idle reaper
    pub idle_timeout_mins: u64,
}

pub struct SessionInfo {
    pub id: String,
    pub notebook_path: PathBuf,
    pub kernel_name: String,
    pub _kernel_id: Option<String>,
}

impl AppState {
    pub fn new(config: &Config) -> Self {
        let notebook_dir = config
            .notebook_dir
            .canonicalize()
            .unwrap_or(config.notebook_dir.clone());

        let users = UserDb::open().expect("failed to open user database");

        Self {
            notebook_dir,
            initial_notebook: config.notebook.clone(),
            sessions: RwLock::new(HashMap::new()),
            kernels: Mutex::new(KernelManager::new()),
            notebook_kernels: Mutex::new(HashMap::new()),
            users,
            collab: Arc::new(CollabState::new()),
            plugin_settings: RwLock::new(load_plugin_settings()),
            hub_mode: config.hub,
            idle_timeout_mins: config.idle_timeout,
        }
    }
}
