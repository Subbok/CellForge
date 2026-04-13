use crate::client::KernelClient;
use crate::connection::ConnectionInfo;
use crate::launcher;
use crate::messages::JupyterMessage;
use anyhow::{Context, Result};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::AtomicUsize;
use tokio::process::Child;
use tokio::sync::broadcast;

pub struct KernelManager {
    kernels: HashMap<String, RunningKernel>,
}

/// State shared across all WS handlers connected to the same kernel.
pub struct SharedKernelState {
    pub msg_to_cell: tokio::sync::Mutex<HashMap<String, String>>,
    pub introspect_ids: tokio::sync::Mutex<HashSet<String>>,
    pub cell_sources: tokio::sync::Mutex<HashMap<String, (usize, String)>>,
    pub exec_start: tokio::sync::Mutex<HashMap<String, std::time::Instant>>,
    pub status: tokio::sync::Mutex<String>,
}

pub struct RunningKernel {
    pub client: KernelClient,
    pub iopub_tx: broadcast::Sender<JupyterMessage>,
    pub shell_tx: broadcast::Sender<JupyterMessage>,
    pub shared: Arc<SharedKernelState>,
    pub conn: ConnectionInfo,
    pub cwd: Option<std::path::PathBuf>,
    /// Extra directories prepended to PYTHONPATH at spawn time
    /// (e.g. per-user plugin pylibs). Preserved so restart uses the same set.
    pub extra_pythonpath: Vec<std::path::PathBuf>,
    pub ref_count: Arc<AtomicUsize>,
    child: Child,
}

impl KernelManager {
    pub fn new() -> Self {
        Self {
            kernels: HashMap::new(),
        }
    }

    pub async fn start(
        &mut self,
        spec_name: &str,
        cwd: Option<&std::path::Path>,
        extra_pythonpath: &[std::path::PathBuf],
    ) -> Result<String> {
        let (conn, child) = launcher::launch_kernel(spec_name, cwd, extra_pythonpath).await?;

        let mut channels = crate::client::KernelClient::connect(&conn)
            .await
            .context("connecting to kernel")?;

        // verify the kernel is alive (uses mpsc receivers directly, before broadcast)
        let info = channels
            .client
            .kernel_info(&mut channels.shell_rx)
            .await
            .context("kernel_info handshake failed")?;

        tracing::info!(
            "kernel ready: {}",
            info.content
                .get("banner")
                .and_then(|v| v.as_str())
                .unwrap_or("(no banner)")
                .lines()
                .next()
                .unwrap_or("")
        );

        // create broadcast channels and relay from mpsc -> broadcast
        let (iopub_tx, _) = broadcast::channel(512);
        let (shell_tx, _) = broadcast::channel(128);

        let iopub_relay = iopub_tx.clone();
        let mut iopub_mpsc = channels.iopub_rx;
        tokio::spawn(async move {
            while let Some(msg) = iopub_mpsc.recv().await {
                let _ = iopub_relay.send(msg);
            }
        });

        let shell_relay = shell_tx.clone();
        let mut shell_mpsc = channels.shell_rx;
        tokio::spawn(async move {
            while let Some(msg) = shell_mpsc.recv().await {
                let _ = shell_relay.send(msg);
            }
        });

        let shared = Arc::new(SharedKernelState {
            msg_to_cell: tokio::sync::Mutex::new(HashMap::new()),
            introspect_ids: tokio::sync::Mutex::new(HashSet::new()),
            cell_sources: tokio::sync::Mutex::new(HashMap::new()),
            exec_start: tokio::sync::Mutex::new(HashMap::new()),
            status: tokio::sync::Mutex::new("idle".into()),
        });

        let id = channels.client.session_id.clone();
        self.kernels.insert(
            id.clone(),
            RunningKernel {
                client: channels.client,
                iopub_tx,
                shell_tx,
                shared,
                conn,
                cwd: cwd.map(|p| p.to_path_buf()),
                extra_pythonpath: extra_pythonpath.to_vec(),
                ref_count: Arc::new(AtomicUsize::new(0)),
                child,
            },
        );

        Ok(id)
    }

    pub fn get(&self, id: &str) -> Option<&RunningKernel> {
        self.kernels.get(id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut RunningKernel> {
        self.kernels.get_mut(id)
    }

    pub async fn cleanup_idle(&mut self) -> usize {
        let mut to_stop = Vec::new();
        for (id, kernel) in &self.kernels {
            let refs = kernel.ref_count.load(std::sync::atomic::Ordering::Relaxed);
            if refs == 0 {
                // check status
                if let Ok(status) = kernel.shared.status.try_lock()
                    && status.as_str() == "idle"
                {
                    to_stop.push(id.clone());
                }
            }
        }

        let count = to_stop.len();
        for id in to_stop {
            let _ = self.stop(&id).await;
        }
        count
    }

    pub async fn stop(&mut self, id: &str) -> Result<()> {
        let Some(mut kernel) = self.kernels.remove(id) else {
            anyhow::bail!("no kernel with id {id}");
        };

        let _ = kernel
            .client
            .send_shell("shutdown_request", serde_json::json!({"restart": false}))
            .await;

        let killed =
            tokio::time::timeout(std::time::Duration::from_secs(2), kernel.child.wait()).await;

        if killed.is_err() {
            tracing::warn!("kernel {id} didn't exit gracefully, killing");
            let _ = kernel.child.kill().await;
        }

        Ok(())
    }

    pub async fn restart(&mut self, id: &str) -> Result<String> {
        let (spec_name, cwd, extras) = match self.kernels.get(id) {
            Some(k) => (
                k.conn.kernel_name.clone().unwrap_or("python3".into()),
                k.cwd.clone(),
                k.extra_pythonpath.clone(),
            ),
            None => ("python3".into(), None, Vec::new()),
        };
        self.stop(id).await?;
        self.start(&spec_name, cwd.as_deref(), &extras).await
    }

    pub async fn interrupt(&mut self, id: &str) -> Result<()> {
        let kernel = self.kernels.get_mut(id).context("no such kernel")?;
        if let Some(pid) = kernel.child.id() {
            #[cfg(unix)]
            unsafe {
                libc::kill(pid as i32, libc::SIGINT);
            }

            #[cfg(windows)]
            {
                unsafe extern "system" {
                    fn GenerateConsoleCtrlEvent(event: u32, group: u32) -> i32;
                }
                // Send Ctrl+C event to the kernel's console group.
                // If that fails, fall back to killing the process.
                if unsafe {
                    GenerateConsoleCtrlEvent(0 /* CTRL_C_EVENT */, pid)
                } == 0
                {
                    let _ = kernel.child.kill().await;
                }
            }
        }
        Ok(())
    }
}

impl Default for KernelManager {
    fn default() -> Self {
        Self::new()
    }
}
