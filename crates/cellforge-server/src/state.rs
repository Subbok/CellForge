use crate::config::Config;
use crate::plugins::{PluginSettings, load_plugin_settings};
use crate::ws::collab::CollabState;
use cellforge_auth::db::UserDb;
use cellforge_kernel::manager::KernelManager;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tokio::sync::Mutex;

pub struct AppState {
    pub notebook_dir: PathBuf,
    pub initial_notebook: Option<PathBuf>,
    pub sessions: RwLock<HashMap<String, SessionInfo>>,
    pub kernels: Mutex<KernelManager>,
    pub notebook_kernels: Mutex<HashMap<String, String>>, // notebook_path -> kernel_id
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
