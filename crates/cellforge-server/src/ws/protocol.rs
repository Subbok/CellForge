use serde::{Deserialize, Serialize};

/// Every message over the websocket looks like this.
/// The `type` field tells you what kind it is, `payload` carries the data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub payload: serde_json::Value,
}

// these are just string constants so we don't typo message types everywhere.
// not using an enum because the protocol is still evolving and we want to be
// able to forward unknown types without dying.

// client -> server
pub const EXECUTE_REQUEST: &str = "execute_request";
pub const INTERRUPT: &str = "interrupt";
pub const RESTART_KERNEL: &str = "restart_kernel";
pub const COMPLETE_REQUEST: &str = "complete_request";
pub const VARIABLE_DETAIL: &str = "variable_detail";
pub const WIDGET_UPDATE: &str = "widget_update";
/// Signals the server to prune state for a deleted cell (cell_sources,
/// execution tracking). Payload: `{ "cell_id": "..." }`.
pub const CELL_DELETED: &str = "cell_deleted";

// server -> client
pub const EXECUTE_RESULT: &str = "execute_result";
pub const STREAM: &str = "stream";
pub const DISPLAY_DATA: &str = "display_data";
pub const EXECUTE_REPLY: &str = "execute_reply";
pub const KERNEL_STATUS: &str = "kernel_status";
pub const ERROR: &str = "error";
pub const VARIABLES_UPDATE: &str = "variables_update";
pub const DEPENDENCY_UPDATE: &str = "dependency_update";
pub const COMPLETE_REPLY: &str = "complete_reply";
pub const CLEAR_OUTPUT: &str = "clear_output";
pub const UPDATE_DISPLAY_DATA: &str = "update_display_data";
