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

struct RoomState {
    tx: broadcast::Sender<(u64, RoomMsg)>,
    /// Accumulated Yjs doc updates — sent to new clients for initial sync.
    updates: Vec<Vec<u8>>,
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
            });
        let tx = room.tx.clone();
        let rx = tx.subscribe();
        let stored = room.updates.clone();
        (tx, rx, stored)
    }

    async fn store_update(&self, doc_id: &str, data: Vec<u8>) {
        let mut rooms = self.rooms.lock().await;
        if let Some(room) = rooms.get_mut(doc_id) {
            room.updates.push(data);
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
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let doc_id = query.doc;
    ws.on_upgrade(move |socket| handle_collab(socket, doc_id, state))
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

    // Phase 1: send stored doc updates so the new client catches up
    for update in stored {
        if ws_tx.send(Message::Binary(update.into())).await.is_err() {
            return;
        }
    }
    if ws_tx.send(Message::Text("sync_done".into())).await.is_err() {
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
    tracing::debug!("collab: client {client_id} left {doc_id}");
}
