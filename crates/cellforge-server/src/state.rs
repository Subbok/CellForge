use crate::config::Config;
use crate::plugins::{PluginSettings, load_plugin_settings};
use crate::ws::collab::CollabState;
use cellforge_auth::db::UserDb;
use cellforge_kernel::manager::KernelManager;
use parking_lot::{Mutex as PlMutex, RwLock};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, broadcast};

/// Notebook-scoped runtime events. Each active session for a given notebook
/// (canonical path) subscribes to a broadcast channel and reacts to these.
/// Today the only event is `KernelStarted`, which lets all collaborators on
/// the notebook auto-join a kernel that another collaborator just spawned
/// (e.g. user A runs the first R cell → user B's session subscribes to
/// that R kernel so the UI shows the new language and incoming iopub).
#[derive(Debug, Clone)]
pub enum NotebookEvent {
    KernelStarted { language: String, kernel_id: String },
}

pub struct AppState {
    pub notebook_dir: PathBuf,
    pub initial_notebook: Option<PathBuf>,
    pub sessions: RwLock<HashMap<String, SessionInfo>>,
    pub kernels: Mutex<KernelManager>,
    /// Shared kernels per (notebook, language). Outer key is the notebook's
    /// canonical absolute path; inner key is the kernel language (e.g.
    /// `"python"`, `"r"`, `"julia"`). Two users with access to the same
    /// underlying file resolve to the same outer key, and a cell in any
    /// language triggers reuse of the existing kernel for that language so
    /// every collaborator sees the same execution state, iopub stream, and
    /// variable namespace. Access is enforced at insert time by
    /// `safe_resolve`, which rejects paths outside the caller's workspace.
    pub notebook_kernels: Mutex<HashMap<String, HashMap<String, String>>>,
    /// One broadcast channel per notebook (canonical path). Sessions
    /// subscribe on connect; kernel spawns emit `KernelStarted` so every
    /// collaborator auto-joins the new language kernel. Created lazily on
    /// first subscribe or send.
    pub notebook_events: Mutex<HashMap<String, broadcast::Sender<NotebookEvent>>>,
    pub users: UserDb,
    pub collab: Arc<CollabState>,
    /// Global plugin settings loaded from ~/.config/cellforge/settings.json,
    /// mutable via admin route POST /api/plugins/config.
    pub plugin_settings: RwLock<PluginSettings>,
    pub hub_mode: bool,
    /// Failed-login counter keyed on `"{username}:{client_ip}"`. Cheap in-memory
    /// counter — see `check_login_rate` / `record_login_failure`.
    pub login_limiter: PlMutex<HashMap<String, LoginAttempts>>,
}

#[derive(Debug, Clone, Copy)]
pub struct LoginAttempts {
    pub count: u32,
    pub window_start: Instant,
}

/// Per-(username, ip) login attempt limits. 5 failures per 15 minutes before
/// we start returning 429. A successful login clears the counter for that key.
pub const LOGIN_MAX_ATTEMPTS: u32 = 5;
pub const LOGIN_WINDOW: Duration = Duration::from_secs(15 * 60);
const LOGIN_LIMITER_MAX_ENTRIES: usize = 10_000;

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
            notebook_events: Mutex::new(HashMap::new()),
            users,
            collab: Arc::new(CollabState::new()),
            plugin_settings: RwLock::new(load_plugin_settings()),
            hub_mode: config.hub,
            login_limiter: PlMutex::new(HashMap::new()),
        }
    }

    /// Get or create the broadcast sender for a notebook's runtime events.
    /// Senders live as long as any session holds a receiver — once all
    /// sessions for the notebook disconnect, the sender is dropped on the
    /// next event emit that notices an empty subscriber count.
    pub async fn notebook_event_tx(&self, canonical: &str) -> broadcast::Sender<NotebookEvent> {
        let mut map = self.notebook_events.lock().await;
        map.entry(canonical.to_string())
            .or_insert_with(|| broadcast::channel(32).0)
            .clone()
    }

    /// Check whether a login attempt for `key` (`"{user}:{ip}"`) is within
    /// the rate limit. Returns `Some(retry_after_secs)` when the caller
    /// should be rejected with 429, or `None` when the attempt may proceed.
    pub fn check_login_rate(&self, key: &str) -> Option<u64> {
        let mut map = self.login_limiter.lock();
        let now = Instant::now();

        // Opportunistic cleanup — prevents the map from growing unbounded
        // under a high-volume attack. Only runs when the map exceeds a
        // modest bound so the common path stays O(1).
        if map.len() > LOGIN_LIMITER_MAX_ENTRIES {
            map.retain(|_, a| now.duration_since(a.window_start) <= LOGIN_WINDOW);
        }

        if let Some(att) = map.get(key) {
            let elapsed = now.duration_since(att.window_start);
            if elapsed <= LOGIN_WINDOW && att.count >= LOGIN_MAX_ATTEMPTS {
                let remaining = LOGIN_WINDOW.saturating_sub(elapsed).as_secs();
                return Some(remaining.max(1));
            }
        }
        None
    }

    pub fn record_login_failure(&self, key: &str) {
        let mut map = self.login_limiter.lock();
        let now = Instant::now();
        let entry = map.entry(key.to_string()).or_insert(LoginAttempts {
            count: 0,
            window_start: now,
        });
        if now.duration_since(entry.window_start) > LOGIN_WINDOW {
            entry.count = 1;
            entry.window_start = now;
        } else {
            entry.count = entry.count.saturating_add(1);
        }
    }

    pub fn clear_login_rate(&self, key: &str) {
        self.login_limiter.lock().remove(key);
    }
}
