use crate::state::AppState;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{Mutex, broadcast};

static NEXT_CLIENT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
enum RoomMsg {
    Binary(Vec<u8>),
    Text(String),
}

/// Cap on stored updates before we drop older ones. See `store_update`.
const UPDATES_SOFT_CAP: usize = 1000;
/// How many recent updates to retain after a cap trim.
const UPDATES_RETAIN: usize = 500;

struct RoomState {
    tx: broadcast::Sender<(u64, RoomMsg)>,
    /// Accumulated Yjs doc updates — sent to new clients for initial sync.
    updates: Vec<Vec<u8>>,
    /// Number of currently connected clients in this room. When this hits
    /// zero in `leave_room`, the entire room entry is removed from `rooms`
    /// so empty rooms don't leak memory forever.
    clients: usize,
}

/// Shared state for collaboration rooms — one broadcast channel per document.
pub struct CollabState {
    rooms: Mutex<HashMap<String, RoomState>>,
}

impl CollabState {
    pub fn new() -> Self {
        Self {
            rooms: Mutex::new(HashMap::new()),
        }
    }

    async fn join_room(
        &self,
        doc_id: &str,
    ) -> (
        broadcast::Sender<(u64, RoomMsg)>,
        broadcast::Receiver<(u64, RoomMsg)>,
        Vec<Vec<u8>>,
    ) {
        let mut rooms = self.rooms.lock().await;
        let room = rooms
            .entry(doc_id.to_string())
            .or_insert_with(|| RoomState {
                tx: broadcast::channel(256).0,
                updates: Vec::new(),
                clients: 0,
            });
        room.clients += 1;
        let tx = room.tx.clone();
        let rx = tx.subscribe();
        let stored = room.updates.clone();
        (tx, rx, stored)
    }

    /// Called exactly once per successful `join_room`. Decrements the
    /// client count and removes the room when the last client leaves so
    /// `rooms` doesn't grow without bound.
    async fn leave_room(&self, doc_id: &str) {
        let mut rooms = self.rooms.lock().await;
        if let Some(room) = rooms.get_mut(doc_id) {
            room.clients = room.clients.saturating_sub(1);
            if room.clients == 0 {
                rooms.remove(doc_id);
            }
        }
    }

    async fn store_update(&self, doc_id: &str, data: Vec<u8>) {
        let mut rooms = self.rooms.lock().await;
        if let Some(room) = rooms.get_mut(doc_id) {
            room.updates.push(data);
            // Stop-gap bound on the replay log: when it grows past
            // UPDATES_SOFT_CAP entries, drop the oldest and keep only the
            // most recent UPDATES_RETAIN. This is crude — new joiners miss
            // older ops that haven't been folded into a snapshot yet, which
            // Yjs mostly tolerates because peers re-sync on connect. The
            // proper fix (v1.1 TODO) is to pull in the `yrs` crate and
            // periodically compact `updates` into a single encoded state
            // vector via `Doc::encode_state_as_update_v1`, which preserves
            // full history in a bounded size.
            if room.updates.len() > UPDATES_SOFT_CAP {
                let drop_n = room.updates.len() - UPDATES_RETAIN;
                room.updates.drain(..drop_n);
            }
        }
    }
}

#[derive(serde::Deserialize)]
pub struct CollabQuery {
    doc: String,
}

pub async fn collab_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<CollabQuery>,
    headers: axum::http::HeaderMap,
    State(state): State<Arc<AppState>>,
) -> axum::response::Response {
    // Reject unauthenticated collab connections and namespace the room by
    // username so two users with a `Untitled.ipynb` can't share (or snoop
    // on) each other's Yjs doc state. The client-supplied `doc` has the
    // same cross-user collision problem as `notebook_kernels` had.
    let username = match crate::routes::auth::extract_user(&headers) {
        Some(n) => n,
        None => {
            return (
                axum::http::StatusCode::UNAUTHORIZED,
                "authentication required",
            )
                .into_response();
        }
    };
    // Same `{username}::{path}` scheme used everywhere else that caches
    // per-notebook state. Kept in this module (not re-exported from state)
    // because the format is an internal implementation detail of CollabState.
    let doc_id = format!("{username}::{}", query.doc);
    ws.on_upgrade(move |socket| handle_collab(socket, doc_id, state))
        .into_response()
}

async fn handle_collab(socket: WebSocket, doc_id: String, state: Arc<AppState>) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    use futures::SinkExt;
    use futures::StreamExt;

    let client_id = NEXT_CLIENT.fetch_add(1, Ordering::Relaxed);
    let (tx, mut rx, stored) = state.collab.join_room(&doc_id).await;

    tracing::debug!(
        "collab: client {client_id} joined {doc_id} ({} stored updates)",
        stored.len()
    );

    // Phase 1: send stored doc updates so the new client catches up.
    // If the client went away mid-sync we still need to run `leave_room`
    // below, otherwise the join increment leaks a slot in the room.
    let mut early_exit = false;
    for update in stored {
        if ws_tx.send(Message::Binary(update.into())).await.is_err() {
            early_exit = true;
            break;
        }
    }
    if !early_exit && ws_tx.send(Message::Text("sync_done".into())).await.is_err() {
        early_exit = true;
    }
    if early_exit {
        state.collab.leave_room(&doc_id).await;
        return;
    }

    // Phase 2: forward live broadcasts to this client (skip own messages)
    let send_task = tokio::spawn(async move {
        while let Ok((sender, msg)) = rx.recv().await {
            if sender == client_id {
                continue;
            }
            let frame = match msg {
                RoomMsg::Binary(data) => Message::Binary(data.into()),
                RoomMsg::Text(text) => Message::Text(text.into()),
            };
            if ws_tx.send(frame).await.is_err() {
                break;
            }
        }
    });

    // Read from client
    let doc_ref = doc_id.clone();
    let state_ref = state.clone();
    let mut yjs_client_id: Option<u64> = None;

    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Binary(data) => {
                let bytes = data.to_vec();
                state_ref.collab.store_update(&doc_ref, bytes.clone()).await;
                let _ = tx.send((client_id, RoomMsg::Binary(bytes)));
            }
            Message::Text(text) => {
                let s = text.to_string();
                if let Some(stripped) = s.strip_prefix("id:") {
                    // client registers its Yjs clientID
                    yjs_client_id = stripped.parse().ok();
                } else if s.starts_with("aw:") || s.starts_with("evt:") {
                    // awareness + events: forward, don't store
                    let _ = tx.send((client_id, RoomMsg::Text(s)));
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Client disconnected — broadcast departure so others remove the cursor
    if let Some(yid) = yjs_client_id {
        let _ = tx.send((client_id, RoomMsg::Text(format!("left:{yid}"))));
    }

    send_task.abort();

    // Drop our room membership. When this is the last client the room is
    // removed from `CollabState.rooms` so we don't leak an entry per doc
    // that was ever opened.
    state.collab.leave_room(&doc_id).await;

    tracing::debug!("collab: client {client_id} left {doc_id}");
}
