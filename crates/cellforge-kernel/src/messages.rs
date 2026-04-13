use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Header that appears on every jupyter message.
/// See https://jupyter-client.readthedocs.io/en/latest/messaging.html#general-message-format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JupyterHeader {
    pub msg_id: String,
    pub session: String,
    pub username: String,
    pub date: String,
    pub msg_type: String,
    pub version: String,
}

/// A full jupyter wire protocol message. The actual content depends on msg_type,
/// so we keep it as a generic Value and parse it on demand.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JupyterMessage {
    pub header: JupyterHeader,
    pub parent_header: serde_json::Value,
    pub metadata: serde_json::Value,
    pub content: serde_json::Value,
    #[serde(skip)]
    pub buffers: Vec<Vec<u8>>,
}

// -- typed content structs for messages we actually construct or parse --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteRequest {
    pub code: String,
    #[serde(default)]
    pub silent: bool,
    #[serde(default = "yes")]
    pub store_history: bool,
    #[serde(default)]
    pub user_expressions: HashMap<String, String>,
    #[serde(default = "yes")]
    pub allow_stdin: bool,
    #[serde(default)]
    pub stop_on_error: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteReply {
    pub status: String, // "ok" or "error"
    pub execution_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelInfoReply {
    pub protocol_version: String,
    pub implementation: String,
    pub implementation_version: String,
    pub language_info: serde_json::Value,
    pub banner: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusContent {
    pub execution_state: String, // busy / idle / starting
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_header() -> JupyterHeader {
        JupyterHeader {
            msg_id: "test-msg-001".into(),
            session: "test-session-001".into(),
            username: "cellforge".into(),
            date: "2025-01-01T00:00:00.000Z".into(),
            msg_type: "execute_request".into(),
            version: "5.3".into(),
        }
    }

    #[test]
    fn header_serialize_roundtrip() {
        let h = sample_header();
        let json = serde_json::to_string(&h).expect("serialize header");
        let back: JupyterHeader = serde_json::from_str(&json).expect("deserialize header");
        assert_eq!(back.msg_id, "test-msg-001");
        assert_eq!(back.msg_type, "execute_request");
        assert_eq!(back.version, "5.3");
    }

    #[test]
    fn header_deserialize_from_json() {
        let json = r#"{
            "msg_id": "abc-123",
            "session": "sess-456",
            "username": "user",
            "date": "2025-06-01T12:00:00Z",
            "msg_type": "kernel_info_request",
            "version": "5.4"
        }"#;
        let h: JupyterHeader = serde_json::from_str(json).expect("parse");
        assert_eq!(h.msg_id, "abc-123");
        assert_eq!(h.msg_type, "kernel_info_request");
    }

    #[test]
    fn jupyter_message_serialize_roundtrip() {
        let msg = JupyterMessage {
            header: sample_header(),
            parent_header: serde_json::json!({}),
            metadata: serde_json::json!({"some": "meta"}),
            content: serde_json::json!({"code": "print('hello')", "silent": false}),
            buffers: vec![],
        };

        let json = serde_json::to_string(&msg).expect("serialize msg");
        let back: JupyterMessage = serde_json::from_str(&json).expect("deserialize msg");
        assert_eq!(back.header.msg_id, "test-msg-001");
        assert_eq!(back.content["code"].as_str().unwrap(), "print('hello')");
        assert_eq!(back.metadata["some"].as_str().unwrap(), "meta");
        // buffers are #[serde(skip)] so they should be empty
        assert!(back.buffers.is_empty());
    }

    #[test]
    fn jupyter_message_buffers_not_serialized() {
        let msg = JupyterMessage {
            header: sample_header(),
            parent_header: serde_json::Value::Null,
            metadata: serde_json::Value::Null,
            content: serde_json::json!({}),
            buffers: vec![vec![1, 2, 3], vec![4, 5, 6]],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(
            !json.contains("buffers"),
            "buffers should be skipped in serialization"
        );
    }

    #[test]
    fn execute_request_serde() {
        let req = ExecuteRequest {
            code: "x = 1 + 2".into(),
            silent: false,
            store_history: true,
            user_expressions: HashMap::new(),
            allow_stdin: false,
            stop_on_error: true,
        };
        let json = serde_json::to_string(&req).expect("serialize");
        let back: ExecuteRequest = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.code, "x = 1 + 2");
        assert!(!back.silent);
        assert!(back.store_history);
        assert!(back.stop_on_error);
    }

    #[test]
    fn execute_request_defaults() {
        // minimal JSON — default fields should fill in
        let json = r#"{"code":"hello"}"#;
        let req: ExecuteRequest = serde_json::from_str(json).expect("parse");
        assert_eq!(req.code, "hello");
        assert!(!req.silent); // default false
        assert!(req.store_history); // default true (via `yes()`)
        assert!(req.allow_stdin); // default true (via `yes()`)
        assert!(!req.stop_on_error); // default false
    }

    #[test]
    fn execute_reply_serde() {
        let json = r#"{"status":"ok","execution_count":5}"#;
        let reply: ExecuteReply = serde_json::from_str(json).expect("parse");
        assert_eq!(reply.status, "ok");
        assert_eq!(reply.execution_count, Some(5));
    }

    #[test]
    fn execute_reply_error_status() {
        let json = r#"{"status":"error","execution_count":null}"#;
        let reply: ExecuteReply = serde_json::from_str(json).expect("parse");
        assert_eq!(reply.status, "error");
        assert_eq!(reply.execution_count, None);
    }

    #[test]
    fn status_content_serde() {
        let json = r#"{"execution_state":"busy"}"#;
        let status: StatusContent = serde_json::from_str(json).expect("parse");
        assert_eq!(status.execution_state, "busy");

        for state in &["idle", "starting"] {
            let j = format!(r#"{{"execution_state":"{state}"}}"#);
            let s: StatusContent = serde_json::from_str(&j).unwrap();
            assert_eq!(s.execution_state, *state);
        }
    }

    #[test]
    fn kernel_info_reply_serde() {
        let json = r#"{
            "protocol_version": "5.3",
            "implementation": "ipython",
            "implementation_version": "8.0",
            "language_info": {"name": "python", "version": "3.11"},
            "banner": "Python 3.11"
        }"#;
        let reply: KernelInfoReply = serde_json::from_str(json).expect("parse");
        assert_eq!(reply.protocol_version, "5.3");
        assert_eq!(reply.implementation, "ipython");
        assert_eq!(reply.banner, "Python 3.11");
    }
}
