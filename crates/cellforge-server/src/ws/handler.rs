use crate::state::AppState;
use crate::ws::protocol::{self, WsMessage};
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use cellforge_kernel::bridge::SharedNamespace;
use cellforge_kernel::manager::SharedKernelState;
use cellforge_kernel::messages::JupyterMessage;
use cellforge_reactive::scheduler;
use cellforge_varexplorer::introspect;
use cellforge_varexplorer::introspect_julia;
use cellforge_varexplorer::introspect_r;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tokio::sync::{Mutex, broadcast};

#[derive(serde::Deserialize)]
pub struct WsQuery {
    kernel: Option<String>,
    notebook: Option<String>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    axum::extract::Query(query): axum::extract::Query<WsQuery>,
    headers: axum::http::HeaderMap,
    State(state): State<Arc<AppState>>,
) -> axum::response::Response {
    // Reject unauthenticated WebSocket connections — kernel access is
    // arbitrary code execution, so auth is mandatory.
    let username = crate::routes::auth::extract_user(&headers);
    if username.is_none() {
        return (
            axum::http::StatusCode::UNAUTHORIZED,
            "authentication required",
        )
            .into_response();
    }

    let kernel_name = query.kernel.unwrap_or("python3".into());
    let notebook = query.notebook;
    ws.on_upgrade(move |socket| handle_socket(socket, state, kernel_name, notebook, username))
        .into_response()
}

/// Per-connection session state.
///
/// Supports multiple kernels (one per language) within a single notebook
/// session.  The first kernel started on connect becomes the "default".
/// Additional kernels are launched lazily when a cell targets a different
/// language.
struct Session {
    /// language -> kernel_id
    kernels: Mutex<HashMap<String, String>>,
    /// The language of the kernel that was started on initial connect.
    default_language: String,
    /// Variables shared across kernels in this session.
    shared_namespace: Arc<Mutex<SharedNamespace>>,
    ws_tx: Arc<Mutex<futures::stream::SplitSink<WebSocket, Message>>>,
    /// language -> SharedKernelState (one per running kernel)
    kernel_states: Mutex<HashMap<String, Arc<SharedKernelState>>>,
    // per-session tracking (not shared across connections)
    complete_ids: Arc<Mutex<HashSet<String>>>,
    detail_ids: Arc<Mutex<HashSet<String>>>,
    /// Handles for iopub/shell forwarding tasks (so we can abort them on disconnect).
    forwarding_handles: Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

async fn handle_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    kernel_name: String,
    notebook_path: Option<String>,
    username: Option<String>,
) {
    tracing::info!(
        "ws client connected, kernel={kernel_name}, notebook={notebook_path:?}, user={username:?}"
    );
    let (ws_tx, mut ws_rx) = socket.split();
    use futures::StreamExt;

    // resolve the per-user workspace directory — notebooks live under
    // ~/.config/cellforge/users/<username>/notebooks, NOT state.notebook_dir
    let base_dir = username
        .as_deref()
        .and_then(|name| state.users.get_user(name).ok())
        .map(|u| std::path::PathBuf::from(u.workspace_dir))
        .unwrap_or_else(|| state.notebook_dir.clone());

    // rebuild the per-user plugin pylib so `import my_plugin_helper` works
    // from kernel cells. Safe to call on every connection — fast and
    // reflects freshly installed / uninstalled plugins automatically.
    let extra_pythonpath: Vec<std::path::PathBuf> = match username.as_deref() {
        Some(name) => vec![crate::plugins::rebuild_user_kernel_pylib(name)],
        None => Vec::new(),
    };

    // ── Hub mode: enforce resource limits before starting a kernel ──
    if state.hub_mode
        && let Some(ref name) = username
    {
        if !state.users.user_is_active(name) {
            let err_msg = WsMessage {
                msg_type: protocol::ERROR.into(),
                id: "boot".into(),
                session_id: None,
                payload: serde_json::json!({
                    "ename": "AccountDisabled",
                    "evalue": "Your account has been deactivated. Contact an administrator.",
                    "traceback": []
                }),
            };
            let mut ws_tx = ws_tx;
            let _ = send_json(&mut ws_tx, &err_msg).await;
            return;
        }

        let count = state.users.kernel_count_for_user(name);
        let max = state
            .users
            .get_user_limits(name)
            .map(|l| l.max_kernels)
            .unwrap_or(0);
        if max > 0 && count >= max {
            let err_msg = WsMessage {
                msg_type: protocol::ERROR.into(),
                id: "boot".into(),
                session_id: None,
                payload: serde_json::json!({
                    "ename": "KernelLimitReached",
                    "evalue": format!("You have reached the maximum number of kernels ({max}). Stop an existing kernel to start a new one."),
                    "traceback": []
                }),
            };
            let mut ws_tx = ws_tx;
            let _ = send_json(&mut ws_tx, &err_msg).await;
            return;
        }
    }

    // resolve or start a kernel
    let nb_cwd = notebook_path
        .as_deref()
        .map(|nb| notebook_cwd(&base_dir, nb));
    let kernel_id = if let Some(ref nb) = notebook_path {
        // check if a kernel already exists for this notebook
        let existing = state.notebook_kernels.lock().await.get(nb).cloned();
        if let Some(kid) = existing {
            // verify the kernel is still alive in the manager
            let alive = state.kernels.lock().await.get(&kid).is_some();
            if alive {
                tracing::info!("reusing kernel {kid} for notebook {nb}");
                kid
            } else {
                // stale mapping, start fresh
                state.notebook_kernels.lock().await.remove(nb);
                match start_new_kernel(&state, &kernel_name, nb_cwd.as_deref(), &extra_pythonpath)
                    .await
                {
                    Ok(id) => {
                        state
                            .notebook_kernels
                            .lock()
                            .await
                            .insert(nb.clone(), id.clone());
                        id
                    }
                    Err(e) => {
                        send_boot_error(ws_tx, &e).await;
                        return;
                    }
                }
            }
        } else {
            match start_new_kernel(&state, &kernel_name, nb_cwd.as_deref(), &extra_pythonpath).await
            {
                Ok(id) => {
                    state
                        .notebook_kernels
                        .lock()
                        .await
                        .insert(nb.clone(), id.clone());
                    id
                }
                Err(e) => {
                    send_boot_error(ws_tx, &e).await;
                    return;
                }
            }
        }
    } else {
        // no notebook specified, always start a new kernel
        match start_new_kernel(&state, &kernel_name, None, &extra_pythonpath).await {
            Ok(id) => id,
            Err(e) => {
                send_boot_error(ws_tx, &e).await;
                return;
            }
        }
    };

    // subscribe to broadcast channels
    let (iopub_rx, shell_rx, shared) = {
        let km = state.kernels.lock().await;
        let k = match km.get(&kernel_id) {
            Some(k) => k,
            None => {
                tracing::error!("kernel {kernel_id} vanished before subscribe");
                return;
            }
        };
        k.ref_count.fetch_add(1, Ordering::Relaxed);
        (
            k.iopub_tx.subscribe(),
            k.shell_tx.subscribe(),
            k.shared.clone(),
        )
    };

    // determine the kernel language from the kernelspec
    let language = cellforge_kernel::launcher::discover_kernelspecs()
        .iter()
        .find(|(name, _, _)| kernel_name.starts_with(name))
        .map(|(_, _, spec)| spec.language.clone())
        .unwrap_or_else(|| "python".into());

    // Register the kernel session in the DB (for admin panel / dashboard)
    if let Some(ref name) = username {
        let nb = notebook_path.as_deref().unwrap_or("");
        if let Err(e) =
            state
                .users
                .register_kernel_session(&kernel_id, name, &kernel_name, &language, nb)
        {
            tracing::warn!("failed to register kernel session: {e}");
        }
    }

    // initialise multi-kernel maps with the default kernel
    let mut initial_kernels = HashMap::new();
    initial_kernels.insert(language.clone(), kernel_id.clone());

    let mut initial_states = HashMap::new();
    initial_states.insert(language.clone(), shared);

    let sess = Arc::new(Session {
        kernels: Mutex::new(initial_kernels),
        default_language: language.clone(),
        shared_namespace: Arc::new(Mutex::new(SharedNamespace::new())),
        ws_tx: Arc::new(Mutex::new(ws_tx)),
        kernel_states: Mutex::new(initial_states),
        complete_ids: Arc::new(Mutex::new(HashSet::new())),
        detail_ids: Arc::new(Mutex::new(HashSet::new())),
        forwarding_handles: Mutex::new(Vec::new()),
    });

    // send initial status
    {
        let mut tx = sess.ws_tx.lock().await;
        let _ = send_json(
            &mut *tx,
            &WsMessage {
                msg_type: protocol::KERNEL_STATUS.into(),
                id: "init".into(),
                session_id: Some(kernel_id.clone()),
                payload: serde_json::json!({"status": "idle"}),
            },
        )
        .await;
    }

    // task 1: iopub -> websocket (default kernel)
    let s1 = sess.clone();
    let state1 = state.clone();
    let lang1 = language.clone();
    let iopub_handle = tokio::spawn(async move {
        forward_iopub(iopub_rx, &s1, &state1, &lang1).await;
    });

    // task 2: shell reader (default kernel)
    let s2 = sess.clone();
    let state2 = state.clone();
    let lang2 = language.clone();
    let shell_handle = tokio::spawn(async move {
        shell_reader(shell_rx, &s2, &state2, &lang2).await;
    });

    // store handles so we can abort them later
    sess.forwarding_handles
        .lock()
        .await
        .extend([iopub_handle, shell_handle]);

    // main loop: read websocket messages from frontend
    loop {
        let Some(Ok(msg)) = ws_rx.next().await else {
            break;
        };
        let Message::Text(text) = msg else { continue };
        let Ok(ws_msg) = serde_json::from_str::<WsMessage>(&text) else {
            continue;
        };

        // track cell sources for dependency analysis (use default kernel's shared state)
        if ws_msg.msg_type == protocol::EXECUTE_REQUEST
            && let (Some(cid), Some(code), Some(idx)) = (
                ws_msg.payload.get("cell_id").and_then(|v| v.as_str()),
                ws_msg.payload.get("code").and_then(|v| v.as_str()),
                ws_msg.payload.get("cell_index").and_then(|v| v.as_u64()),
            )
        {
            // store cell sources in the default kernel's shared state for reactive DAG
            let states = sess.kernel_states.lock().await;
            if let Some(shared) = states.get(&sess.default_language) {
                shared
                    .cell_sources
                    .lock()
                    .await
                    .insert(cid.into(), (idx as usize, code.into()));
            }
        }

        handle_client_msg(&state, &sess, ws_msg, nb_cwd.as_deref(), &extra_pythonpath).await;
    }

    // abort all forwarding tasks
    for handle in sess.forwarding_handles.lock().await.drain(..) {
        handle.abort();
    }

    // decrement ref_count for ALL kernels in this session and stop idle ones
    let all_kernels: Vec<(String, String)> = sess
        .kernels
        .lock()
        .await
        .iter()
        .map(|(lang, kid)| (lang.clone(), kid.clone()))
        .collect();

    for (lang, kid) in &all_kernels {
        let should_stop = {
            let km = state.kernels.lock().await;
            if let Some(k) = km.get(kid) {
                let refs = k.ref_count.fetch_sub(1, Ordering::Relaxed);
                let is_busy = k.shared.status.lock().await.as_str() == "busy";
                refs <= 1 && !is_busy
            } else {
                false
            }
        };

        if should_stop {
            // only remove notebook->kernel mapping for the default kernel
            if *lang == sess.default_language
                && let Some(ref nb) = notebook_path
            {
                state.notebook_kernels.lock().await.remove(nb);
            }
            // Remove the kernel session from the DB
            if let Err(e) = state.users.remove_kernel_session(kid) {
                tracing::warn!("failed to remove kernel session {kid}: {e}");
            }
            let mut km = state.kernels.lock().await;
            let _ = km.stop(kid).await;
            tracing::info!("last client gone, kernel {kid} ({lang}) stopped");
        } else {
            tracing::info!("client disconnected, kernel {kid} ({lang}) still shared");
        }
    }
}

async fn start_new_kernel(
    state: &AppState,
    kernel_name: &str,
    cwd: Option<&std::path::Path>,
    extra_pythonpath: &[std::path::PathBuf],
) -> Result<String, String> {
    let mut km = state.kernels.lock().await;
    match km.start(kernel_name, cwd, extra_pythonpath).await {
        Ok(id) => {
            tracing::info!("kernel up: {id}");
            Ok(id)
        }
        Err(e) => {
            tracing::error!("kernel failed: {e}");
            Err(format!("{e}"))
        }
    }
}

/// Find the kernelspec name for a given language (e.g. "python" -> "python3",
/// "r" -> "ir", "julia" -> "julia-1.x"). Returns the first matching spec.
fn find_spec_for_language(language: &str) -> Option<String> {
    let specs = cellforge_kernel::launcher::discover_kernelspecs();
    let lang_lower = language.to_lowercase();
    specs
        .iter()
        .find(|(_, _, spec)| spec.language.to_lowercase() == lang_lower)
        .map(|(name, _, _)| name.clone())
}

/// Ensure a kernel for the requested language is running in this session.
/// Returns the kernel_id. If none exists yet, finds the appropriate kernelspec
/// and starts a new kernel, subscribing to its iopub/shell channels.
async fn ensure_kernel_for_language(
    sess: &Arc<Session>,
    state: &Arc<AppState>,
    language: &str,
    cwd: Option<&std::path::Path>,
    extra_pythonpath: &[std::path::PathBuf],
) -> Result<String, String> {
    // fast path: kernel already running for this language
    {
        let kernels = sess.kernels.lock().await;
        if let Some(id) = kernels.get(language) {
            return Ok(id.clone());
        }
    }

    // find a kernelspec that matches this language
    let spec_name = find_spec_for_language(language)
        .ok_or_else(|| format!("no kernelspec found for language '{language}'"))?;

    tracing::info!("starting new kernel for language={language}, spec={spec_name}");

    // start the kernel
    let kernel_id = start_new_kernel(state, &spec_name, cwd, extra_pythonpath).await?;

    // subscribe to broadcast channels
    let (iopub_rx, shell_rx, shared) = {
        let km = state.kernels.lock().await;
        let k = km
            .get(&kernel_id)
            .ok_or_else(|| format!("kernel {kernel_id} vanished after start"))?;
        k.ref_count.fetch_add(1, Ordering::Relaxed);
        (
            k.iopub_tx.subscribe(),
            k.shell_tx.subscribe(),
            k.shared.clone(),
        )
    };

    // register in session maps
    sess.kernels
        .lock()
        .await
        .insert(language.to_string(), kernel_id.clone());
    sess.kernel_states
        .lock()
        .await
        .insert(language.to_string(), shared);

    // spawn forwarding tasks for the new kernel
    let s1 = sess.clone();
    let state1 = state.clone();
    let lang1 = language.to_string();
    let iopub_handle = tokio::spawn(async move {
        forward_iopub(iopub_rx, &s1, &state1, &lang1).await;
    });

    let s2 = sess.clone();
    let state2 = state.clone();
    let lang2 = language.to_string();
    let shell_handle = tokio::spawn(async move {
        shell_reader(shell_rx, &s2, &state2, &lang2).await;
    });

    sess.forwarding_handles
        .lock()
        .await
        .extend([iopub_handle, shell_handle]);

    // send kernel_status idle for the new kernel
    {
        let mut tx = sess.ws_tx.lock().await;
        let _ = send_json(
            &mut *tx,
            &WsMessage {
                msg_type: protocol::KERNEL_STATUS.into(),
                id: "init".into(),
                session_id: Some(kernel_id.clone()),
                payload: serde_json::json!({"status": "idle", "language": language}),
            },
        )
        .await;
    }

    Ok(kernel_id)
}

/// Resolve the directory a kernel should run in, given a notebook path
/// relative to the user's workspace root.
///
/// Refuses anything that escapes `base` (path traversal guard).
/// Canonicalizes `base` first so the starts_with check also works through symlinks.
fn notebook_cwd(base: &std::path::Path, notebook_rel: &str) -> std::path::PathBuf {
    let base_canon = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let joined = base_canon.join(notebook_rel);

    if let Some(parent) = joined.parent() {
        if let Ok(canon) = parent.canonicalize() {
            if canon.starts_with(&base_canon) {
                tracing::info!(
                    "kernel cwd resolved: {} (notebook={}, base={})",
                    canon.display(),
                    notebook_rel,
                    base_canon.display()
                );
                return canon;
            } else {
                tracing::warn!(
                    "notebook {} escapes workspace {}, falling back",
                    canon.display(),
                    base_canon.display()
                );
            }
        } else {
            tracing::debug!(
                "could not canonicalize parent of {} (file may not exist yet)",
                joined.display()
            );
        }
    }

    // fallback: the workspace root itself
    tracing::info!("kernel cwd fallback to workspace: {}", base_canon.display());
    base_canon
}

async fn send_boot_error(ws_tx: futures::stream::SplitSink<WebSocket, Message>, error: &str) {
    let mut ws_tx = ws_tx;
    let _ = send_json(
        &mut ws_tx,
        &WsMessage {
            msg_type: protocol::ERROR.into(),
            id: "boot".into(),
            session_id: None,
            payload: serde_json::json!({"error": error}),
        },
    )
    .await;
}

/// Helper: resolve the kernel_id for a given language in this session.
/// Returns the default kernel's id when the language matches the default.
async fn kernel_id_for_language(sess: &Session, language: &str) -> Option<String> {
    sess.kernels.lock().await.get(language).cloned()
}

/// Helper: resolve the SharedKernelState for a given language.
async fn shared_for_language(sess: &Session, language: &str) -> Option<Arc<SharedKernelState>> {
    sess.kernel_states.lock().await.get(language).cloned()
}

/// Handle incoming WS messages from the frontend.
async fn handle_client_msg(
    state: &Arc<AppState>,
    sess: &Arc<Session>,
    msg: WsMessage,
    cwd: Option<&std::path::Path>,
    extra_pythonpath: &[std::path::PathBuf],
) {
    match msg.msg_type.as_str() {
        protocol::EXECUTE_REQUEST => {
            let code = msg
                .payload
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let cell_id = msg
                .payload
                .get("cell_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            // Task 10: extract optional language field, default to session default
            let language = msg
                .payload
                .get("language")
                .and_then(|v| v.as_str())
                .unwrap_or(&sess.default_language)
                .to_string();

            if code.is_empty() {
                return;
            }

            // ensure a kernel is running for this language (lazy start)
            let kernel_id = if language == sess.default_language {
                // fast path: use the default kernel
                match kernel_id_for_language(sess, &language).await {
                    Some(id) => id,
                    None => return,
                }
            } else {
                // need a different-language kernel — lazy start
                match ensure_kernel_for_language(sess, state, &language, cwd, extra_pythonpath)
                    .await
                {
                    Ok(id) => id,
                    Err(e) => {
                        tracing::error!("failed to start kernel for {language}: {e}");
                        let mut tx = sess.ws_tx.lock().await;
                        let _ = send_json(
                            &mut *tx,
                            &WsMessage {
                                msg_type: protocol::ERROR.into(),
                                id: msg.id,
                                session_id: None,
                                payload: serde_json::json!({
                                    "cell_id": cell_id,
                                    "error": format!("No kernel for language '{language}': {e}"),
                                }),
                            },
                        )
                        .await;
                        return;
                    }
                }
            };

            let shared = match shared_for_language(sess, &language).await {
                Some(s) => s,
                None => return,
            };

            // If executing in a non-default language, inject shared variables first
            if language != sess.default_language {
                let ns = sess.shared_namespace.lock().await;
                let injections = ns.injection_code_for(&language);
                if !injections.is_empty() {
                    let inject_code = injections.join("\n");
                    let mut km = state.kernels.lock().await;
                    if let Some(k) = km.get_mut(&kernel_id)
                        && let Err(e) = k.client.execute(&inject_code, true).await
                    {
                        tracing::warn!("variable injection failed for {language}: {e}");
                    }
                }
            }

            let mut km = state.kernels.lock().await;
            if let Some(k) = km.get_mut(&kernel_id) {
                match k.client.execute(code, false).await {
                    Ok(mid) => {
                        tracing::debug!("exec {cell_id} -> {mid} (lang={language})");
                        shared
                            .msg_to_cell
                            .lock()
                            .await
                            .insert(mid.clone(), cell_id.into());
                        shared
                            .exec_start
                            .lock()
                            .await
                            .insert(mid, std::time::Instant::now());
                    }
                    Err(e) => tracing::error!("exec fail: {e}"),
                }
            }
        }
        protocol::INTERRUPT => {
            // interrupt the default kernel (future: could accept language field)
            let kid = kernel_id_for_language(sess, &sess.default_language).await;
            if let Some(ref kid) = kid {
                let mut km = state.kernels.lock().await;
                let _ = km.interrupt(kid).await;
            }
        }
        protocol::RESTART_KERNEL => {
            let kid = kernel_id_for_language(sess, &sess.default_language).await;
            if let Some(ref kid) = kid {
                let mut km = state.kernels.lock().await;
                let _ = km.restart(kid).await;
            }
        }
        protocol::COMPLETE_REQUEST => {
            let code = msg
                .payload
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let cursor_pos = msg
                .payload
                .get("cursor_pos")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let language = msg
                .payload
                .get("language")
                .and_then(|v| v.as_str())
                .unwrap_or(&sess.default_language);

            let kid = kernel_id_for_language(sess, language).await;
            if let Some(ref kid) = kid {
                let mut km = state.kernels.lock().await;
                if let Some(k) = km.get_mut(kid) {
                    let content = serde_json::json!({
                        "code": code,
                        "cursor_pos": cursor_pos,
                    });
                    if let Ok(mid) = k.client.send_shell("complete_request", content).await {
                        sess.complete_ids.lock().await.insert(mid);
                    }
                }
            }
        }
        protocol::VARIABLE_DETAIL => {
            let name = msg
                .payload
                .get("var_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if name.is_empty() {
                return;
            }
            let language = msg
                .payload
                .get("language")
                .and_then(|v| v.as_str())
                .unwrap_or(&sess.default_language);

            let code = match language {
                "r" | "R" => introspect_r::dataframe_preview_code(name),
                "julia" => introspect_julia::dataframe_preview_code(name),
                _ => introspect::dataframe_preview_code(name),
            };
            let kid = kernel_id_for_language(sess, language).await;
            if let Some(ref kid) = kid {
                let mut km = state.kernels.lock().await;
                if let Some(k) = km.get_mut(kid)
                    && let Ok(mid) = k.client.execute(&code, true).await
                {
                    sess.detail_ids.lock().await.insert(mid);
                }
            }
        }
        protocol::WIDGET_UPDATE => {
            let id = msg.payload.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let value = msg.payload.get("value").unwrap_or(&serde_json::Value::Null);
            let cell_id = msg
                .payload
                .get("cell_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if id.is_empty() {
                return;
            }

            // Convert JSON value to valid Python literal:
            // - JSON true/false → Python True/False
            // - JSON null → Python None
            // - strings get proper quoting via serde
            let py_value = match value {
                serde_json::Value::Bool(true) => "True".to_string(),
                serde_json::Value::Bool(false) => "False".to_string(),
                serde_json::Value::Null => "None".to_string(),
                serde_json::Value::String(s) => {
                    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
                }
                other => other.to_string(),
            };

            let code = format!(
                "import cellforge_ui\nif '{}' in cellforge_ui._WIDGETS:\n    cellforge_ui._WIDGETS['{}']._value = {}\n",
                id, id, py_value
            );

            // widgets are always python (default kernel)
            let kid = kernel_id_for_language(sess, &sess.default_language).await;
            let shared = shared_for_language(sess, &sess.default_language).await;
            if let (Some(ref kid), Some(ref shared)) = (kid, shared) {
                let mut km = state.kernels.lock().await;
                if let Some(k) = km.get_mut(kid)
                    && let Ok(mid) = k.client.execute(&code, true).await
                    && !cell_id.is_empty()
                {
                    shared.msg_to_cell.lock().await.insert(mid, cell_id.into());
                }
            }
        }
        _ => {}
    }
}

/// Background task: reads shell replies from the broadcast channel.
///
/// `language` identifies which kernel this reader is attached to, so we can
/// look up the correct kernel_id and SharedKernelState from the session maps.
async fn shell_reader(
    mut shell_rx: broadcast::Receiver<JupyterMessage>,
    sess: &Session,
    state: &AppState,
    language: &str,
) {
    // resolve the kernel_id and shared state for this language
    let kernel_id = match sess.kernels.lock().await.get(language).cloned() {
        Some(id) => id,
        None => return,
    };
    let shared = match sess.kernel_states.lock().await.get(language).cloned() {
        Some(s) => s,
        None => return,
    };

    while let Ok(reply) = shell_rx.recv().await {
        let parent_id = reply
            .parent_header
            .get("msg_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // handle complete_reply -- forward to frontend
        if reply.header.msg_type == "complete_reply" {
            let is_ours = sess.complete_ids.lock().await.remove(&parent_id);
            if is_ours {
                let mut tx = sess.ws_tx.lock().await;
                let _ = send_json(
                    &mut *tx,
                    &WsMessage {
                        msg_type: protocol::COMPLETE_REPLY.into(),
                        id: reply.header.msg_id,
                        session_id: Some(kernel_id.clone()),
                        payload: serde_json::json!({"content": reply.content}),
                    },
                )
                .await;
            }
            continue;
        }

        if reply.header.msg_type != "execute_reply" {
            continue;
        }

        let status = reply
            .content
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        // is this a reply to our introspection?
        {
            let ids = shared.introspect_ids.lock().await;
            if ids.contains(&parent_id) {
                continue; // don't forward introspection replies
            }
        }

        // find the cell and compute timing
        let cell_id = shared
            .msg_to_cell
            .lock()
            .await
            .get(&parent_id)
            .cloned()
            .unwrap_or_default();
        let elapsed_ms = shared
            .exec_start
            .lock()
            .await
            .remove(&parent_id)
            .map(|t| t.elapsed().as_millis() as u64);

        if cell_id.is_empty() {
            continue;
        }

        tracing::debug!("cell {cell_id} done: {status} in {elapsed_ms:?}ms (lang={language})");

        // send execute_reply to frontend
        let ws_msg = WsMessage {
            msg_type: protocol::EXECUTE_REPLY.into(),
            id: reply.header.msg_id,
            session_id: Some(kernel_id.clone()),
            payload: serde_json::json!({
                "cell_id": cell_id,
                "content": reply.content,
                "elapsed_ms": elapsed_ms,
            }),
        };
        {
            let mut tx = sess.ws_tx.lock().await;
            let _ = send_json(&mut *tx, &ws_msg).await;
        }

        // trigger variable introspection + reactive analysis
        if status == "ok" {
            // only trigger introspection once per execute (first handler wins)
            let already_triggered = {
                let mut ids = shared.introspect_ids.lock().await;
                !ids.insert(format!("trigger-{parent_id}"))
            };

            if !already_triggered {
                {
                    let inspect_code = match language {
                        "r" | "R" => introspect_r::INSPECT_VARIABLES,
                        "julia" => introspect_julia::INSPECT_VARIABLES,
                        _ => introspect::INSPECT_VARIABLES,
                    };
                    let mut km = state.kernels.lock().await;
                    if let Some(k) = km.get_mut(&kernel_id)
                        && let Ok(mid) = k.client.execute(inspect_code, true).await
                    {
                        shared.introspect_ids.lock().await.insert(mid);
                    }
                }
                // remove the trigger guard now that we've issued the request
                shared
                    .introspect_ids
                    .lock()
                    .await
                    .remove(&format!("trigger-{parent_id}"));
            }

            // reactive deps — only run from the default language's shell reader
            // to avoid duplicate updates from multiple kernels
            if language == sess.default_language {
                let cells = shared.cell_sources.lock().await;
                if !cells.is_empty() {
                    let mut ordered: Vec<_> = cells
                        .iter()
                        .map(|(id, (idx, src))| (*idx, id.clone(), src.clone()))
                        .collect();
                    ordered.sort_by_key(|(idx, _, _)| *idx);

                    let cell_data: Vec<(String, &str)> = ordered
                        .iter()
                        .map(|(_, id, src)| (id.clone(), src.as_str()))
                        .collect();

                    let update = scheduler::compute_reactive_update(&cell_data, &cell_id);

                    let mut tx = sess.ws_tx.lock().await;
                    let _ = send_json(
                        &mut *tx,
                        &WsMessage {
                            msg_type: protocol::DEPENDENCY_UPDATE.into(),
                            id: uuid::Uuid::new_v4().to_string(),
                            session_id: Some(kernel_id.clone()),
                            payload: serde_json::json!({
                                "stale_cells": update.stale_cells,
                                "dag": update.dag,
                            }),
                        },
                    )
                    .await;
                }
            }
        }
    }
}

/// Forwards iopub messages to the websocket in real time.
/// Introspection output is intercepted and sent as variables_update instead.
///
/// `language` identifies which kernel this forwarder is attached to.
async fn forward_iopub(
    mut rx: broadcast::Receiver<JupyterMessage>,
    sess: &Session,
    _state: &AppState,
    language: &str,
) {
    // resolve the kernel_id and shared state for this language
    let kernel_id = match sess.kernels.lock().await.get(language).cloned() {
        Some(id) => id,
        None => return,
    };
    let shared = match sess.kernel_states.lock().await.get(language).cloned() {
        Some(s) => s,
        None => return,
    };

    while let Ok(jmsg) = rx.recv().await {
        let msg_type = &jmsg.header.msg_type;
        let parent_id = jmsg
            .parent_header
            .get("msg_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // check if this is from our silent introspection
        let is_introspect = {
            let ids = shared.introspect_ids.lock().await;
            ids.contains(&parent_id)
        };

        if is_introspect {
            if msg_type == "stream"
                && let Some(text) = jmsg.content.get("text").and_then(|v| v.as_str())
                && let Ok(vars) = serde_json::from_str::<serde_json::Value>(text)
            {
                // Feed introspection results into the shared namespace
                // so other kernels can access these variables
                {
                    let mut ns = sess.shared_namespace.lock().await;
                    let _ = ns.update_from_kernel(language, text);
                }

                let mut tx = sess.ws_tx.lock().await;
                let _ = send_json(
                    &mut *tx,
                    &WsMessage {
                        msg_type: protocol::VARIABLES_UPDATE.into(),
                        id: jmsg.header.msg_id,
                        session_id: Some(kernel_id.clone()),
                        payload: serde_json::json!({"variables": vars, "language": language}),
                    },
                )
                .await;
            }
            if msg_type == "status"
                && let Some("idle") = jmsg.content.get("execution_state").and_then(|v| v.as_str())
            {
                shared.introspect_ids.lock().await.remove(&parent_id);
            }
            continue;
        }

        // check if this is a variable_detail (dataframe preview) response
        let is_detail = {
            let ids = sess.detail_ids.lock().await;
            ids.contains(&parent_id)
        };
        if is_detail {
            if msg_type == "stream"
                && let Some(text) = jmsg.content.get("text").and_then(|v| v.as_str())
                && let Ok(preview) = serde_json::from_str::<serde_json::Value>(text)
            {
                let mut tx = sess.ws_tx.lock().await;
                let _ = send_json(
                    &mut *tx,
                    &WsMessage {
                        msg_type: "variable_detail".into(),
                        id: jmsg.header.msg_id,
                        session_id: Some(kernel_id.clone()),
                        payload: serde_json::json!({"preview": preview}),
                    },
                )
                .await;
            }
            if msg_type == "status"
                && let Some("idle") = jmsg.content.get("execution_state").and_then(|v| v.as_str())
            {
                sess.detail_ids.lock().await.remove(&parent_id);
            }
            continue;
        }

        // translate to our WS message type, skip stuff we don't care about
        let ws_type = match msg_type.as_str() {
            "stream" => protocol::STREAM,
            "execute_result" => protocol::EXECUTE_RESULT,
            "display_data" => protocol::DISPLAY_DATA,
            "update_display_data" => protocol::UPDATE_DISPLAY_DATA,
            "clear_output" => protocol::CLEAR_OUTPUT,
            "error" => protocol::ERROR,
            "execute_input" => "execute_input",
            "status" => {
                if let Some(st) = jmsg.content.get("execution_state").and_then(|v| v.as_str()) {
                    *shared.status.lock().await = st.to_string();
                }
                protocol::KERNEL_STATUS
            }
            _ => continue,
        };

        let cell_id = {
            let map = shared.msg_to_cell.lock().await;
            map.get(&parent_id).cloned().unwrap_or_default()
        };

        // `transient` (containing display_id) lives INSIDE `content` in
        // the Jupyter protocol. Pull it up to top-level of our payload so
        // the frontend can access it without digging into content.
        let transient = jmsg
            .content
            .get("transient")
            .cloned()
            .unwrap_or(serde_json::Value::Null);

        let mut tx = sess.ws_tx.lock().await;
        let _ = send_json(
            &mut *tx,
            &WsMessage {
                msg_type: ws_type.into(),
                id: jmsg.header.msg_id,
                session_id: Some(kernel_id.clone()),
                payload: serde_json::json!({
                    "cell_id": cell_id,
                    "content": jmsg.content,
                    "transient": transient,
                }),
            },
        )
        .await;
    }
}

async fn send_json<S>(sink: &mut S, msg: &WsMessage) -> Result<(), ()>
where
    S: futures::Sink<Message> + Unpin,
{
    use futures::SinkExt;
    let json = serde_json::to_string(msg).map_err(|_| ())?;
    sink.send(Message::Text(json.into())).await.map_err(|_| ())
}
