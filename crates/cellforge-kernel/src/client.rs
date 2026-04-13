use crate::connection::ConnectionInfo;
use crate::messages::{JupyterHeader, JupyterMessage};
use anyhow::{Context, Result, bail};
use bytes::Bytes;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;
use zeromq::{DealerSocket, Socket, SocketRecv, SocketSend, SubSocket, ZmqMessage};

type HmacSha256 = Hmac<Sha256>;

/// Send commands to the shell task.
struct ShellCmd {
    frames: Vec<Bytes>,
    done: oneshot::Sender<()>,
}

pub struct KernelClient {
    pub session_id: String,
    shell_tx: mpsc::Sender<ShellCmd>,
    key: Vec<u8>,
}

pub struct KernelChannels {
    pub client: KernelClient,
    pub iopub_rx: mpsc::Receiver<JupyterMessage>,
    pub shell_rx: mpsc::Receiver<JupyterMessage>,
}

impl KernelClient {
    pub async fn connect(conn: &ConnectionInfo) -> Result<KernelChannels> {
        let session_id = Uuid::new_v4().to_string();
        let key_bytes = conn.key.as_bytes().to_vec();

        // single shell DEALER socket — one task owns it,
        // sends outgoing messages and reads replies
        let mut shell = DealerSocket::new();
        shell
            .connect(&conn.shell_endpoint())
            .await
            .context("shell")?;

        let mut control = DealerSocket::new();
        control
            .connect(&conn.control_endpoint())
            .await
            .context("control")?;

        let mut iopub = SubSocket::new();
        iopub
            .connect(&conn.iopub_endpoint())
            .await
            .context("iopub")?;
        iopub.subscribe("").await.context("subscribe iopub")?;

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // shell task: owns the socket, handles both send and recv
        let (cmd_tx, mut cmd_rx) = mpsc::channel::<ShellCmd>(32);
        let (reply_tx, shell_rx) = mpsc::channel::<JupyterMessage>(64);
        let shell_key = key_bytes.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    // check for outgoing messages to send
                    cmd = cmd_rx.recv() => {
                        let Some(cmd) = cmd else { break };
                        let Ok(zmq_msg) = ZmqMessage::try_from(cmd.frames) else { continue };
                        let _ = shell.send(zmq_msg).await;
                        let _ = cmd.done.send(());
                    }
                    // check for incoming replies
                    reply = shell.recv() => {
                        let Ok(raw) = reply else { break };
                        let frames: Vec<Vec<u8>> = raw.into_vec().into_iter().map(|b| b.to_vec()).collect();
                        if let Ok(msg) = parse_wire_msg(&frames, &shell_key)
                            && reply_tx.send(msg).await.is_err()
                        {
                            break;
                        }
                    }
                }
            }
        });

        // iopub reader task
        let (iopub_tx, iopub_rx) = mpsc::channel::<JupyterMessage>(256);
        let iopub_key = key_bytes.clone();
        tokio::spawn(async move {
            loop {
                match iopub.recv().await {
                    Ok(raw) => {
                        let frames: Vec<Vec<u8>> =
                            raw.into_vec().into_iter().map(|b| b.to_vec()).collect();
                        match parse_wire_msg(&frames, &iopub_key) {
                            Ok(msg) => {
                                if iopub_tx.send(msg).await.is_err() {
                                    break;
                                }
                            }
                            Err(e) => tracing::warn!("bad iopub: {e}"),
                        }
                    }
                    Err(e) => {
                        tracing::error!("iopub dead: {e}");
                        break;
                    }
                }
            }
        });

        Ok(KernelChannels {
            client: KernelClient {
                session_id,
                shell_tx: cmd_tx,
                key: key_bytes,
            },
            iopub_rx,
            shell_rx,
        })
    }

    pub async fn send_shell(
        &mut self,
        msg_type: &str,
        content: serde_json::Value,
    ) -> Result<String> {
        let msg_id = Uuid::new_v4().to_string();
        let header = JupyterHeader {
            msg_id: msg_id.clone(),
            session: self.session_id.clone(),
            username: "cellforge".into(),
            date: now_ish(),
            msg_type: msg_type.into(),
            version: "5.3".into(),
        };

        let frames = build_wire_msg(&header, &content, &self.key)?;
        let (done_tx, done_rx) = oneshot::channel();
        self.shell_tx
            .send(ShellCmd {
                frames,
                done: done_tx,
            })
            .await
            .map_err(|_| anyhow::anyhow!("shell task gone"))?;
        let _ = done_rx.await; // wait for send to complete
        Ok(msg_id)
    }

    pub async fn execute(&mut self, code: &str, silent: bool) -> Result<String> {
        self.send_shell(
            "execute_request",
            serde_json::json!({
                "code": code,
                "silent": silent,
                "store_history": !silent,
                "user_expressions": {},
                "allow_stdin": false,
                "stop_on_error": true,
            }),
        )
        .await
    }

    pub async fn kernel_info(
        &mut self,
        shell_rx: &mut mpsc::Receiver<JupyterMessage>,
    ) -> Result<JupyterMessage> {
        self.send_shell("kernel_info_request", serde_json::json!({}))
            .await?;
        shell_rx.recv().await.context("no kernel_info reply")
    }
}

const DELIM: &[u8] = b"<IDS|MSG>";

fn build_wire_msg(
    header: &JupyterHeader,
    content: &serde_json::Value,
    key: &[u8],
) -> Result<Vec<Bytes>> {
    let h = serde_json::to_vec(header)?;
    let p = b"{}".to_vec();
    let m = b"{}".to_vec();
    let c = serde_json::to_vec(content)?;

    let sig = if key.is_empty() {
        String::new()
    } else {
        let mut mac = HmacSha256::new_from_slice(key).context("hmac key")?;
        mac.update(&h);
        mac.update(&p);
        mac.update(&m);
        mac.update(&c);
        hex::encode(mac.finalize().into_bytes())
    };

    Ok(vec![
        Bytes::from_static(DELIM),
        Bytes::from(sig),
        Bytes::from(h),
        Bytes::from(p),
        Bytes::from(m),
        Bytes::from(c),
    ])
}

fn parse_wire_msg(frames: &[Vec<u8>], key: &[u8]) -> Result<JupyterMessage> {
    let delim_pos = frames
        .iter()
        .position(|f| f.as_slice() == DELIM)
        .context("no <IDS|MSG> delimiter")?;

    let rest = &frames[delim_pos + 1..];
    if rest.len() < 5 {
        bail!("truncated: {} frames", rest.len());
    }

    let (sig, h, p, m, c) = (&rest[0], &rest[1], &rest[2], &rest[3], &rest[4]);

    if !key.is_empty() {
        let mut mac = HmacSha256::new_from_slice(key).context("hmac key")?;
        mac.update(h);
        mac.update(p);
        mac.update(m);
        mac.update(c);
        let expected = hex::encode(mac.finalize().into_bytes());
        if expected != String::from_utf8_lossy(sig) {
            bail!("HMAC mismatch");
        }
    }

    Ok(JupyterMessage {
        header: serde_json::from_slice(h).context("parse header")?,
        parent_header: serde_json::from_slice(p).unwrap_or_default(),
        metadata: serde_json::from_slice(m).unwrap_or_default(),
        content: serde_json::from_slice(c).context("parse content")?,
        buffers: rest[5..].to_vec(),
    })
}

fn now_ish() -> String {
    "2025-01-01T00:00:00.000Z".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_header(msg_type: &str) -> JupyterHeader {
        JupyterHeader {
            msg_id: "test-id-001".into(),
            session: "test-session".into(),
            username: "cellforge".into(),
            date: "2025-01-01T00:00:00.000Z".into(),
            msg_type: msg_type.into(),
            version: "5.3".into(),
        }
    }

    #[test]
    fn build_wire_msg_produces_correct_frame_count() {
        let header = test_header("execute_request");
        let content = serde_json::json!({"code": "1+1"});
        let key = b"secret-key";

        let frames = build_wire_msg(&header, &content, key).expect("build should succeed");
        // should produce 6 frames: delimiter, signature, header, parent, metadata, content
        assert_eq!(frames.len(), 6);
        // first frame is the delimiter
        assert_eq!(frames[0].as_ref(), DELIM);
    }

    #[test]
    fn build_wire_msg_empty_key_produces_empty_signature() {
        let header = test_header("kernel_info_request");
        let content = serde_json::json!({});
        let key = b"";

        let frames = build_wire_msg(&header, &content, key).expect("build");
        assert_eq!(frames.len(), 6);
        // signature frame should be empty when key is empty
        assert!(
            frames[1].is_empty(),
            "signature should be empty with no key"
        );
    }

    #[test]
    fn build_wire_msg_signature_is_hex() {
        let header = test_header("execute_request");
        let content = serde_json::json!({"code": "print('hi')"});
        let key = b"my-hmac-key";

        let frames = build_wire_msg(&header, &content, key).unwrap();
        let sig = std::str::from_utf8(&frames[1]).expect("sig should be utf8");
        // HMAC-SHA256 produces 64 hex chars
        assert_eq!(sig.len(), 64, "signature should be 64 hex chars");
        assert!(
            sig.chars().all(|c| c.is_ascii_hexdigit()),
            "signature should be hex: {sig}"
        );
    }

    #[test]
    fn roundtrip_build_then_parse() {
        let header = test_header("execute_request");
        let content = serde_json::json!({"code": "x = 42", "silent": false});
        let key = b"roundtrip-key";

        let frames = build_wire_msg(&header, &content, key).expect("build");
        // convert Bytes to Vec<u8> for parse_wire_msg
        let raw: Vec<Vec<u8>> = frames.iter().map(|b| b.to_vec()).collect();

        let msg = parse_wire_msg(&raw, key).expect("parse should succeed");
        assert_eq!(msg.header.msg_id, "test-id-001");
        assert_eq!(msg.header.msg_type, "execute_request");
        assert_eq!(msg.content["code"].as_str().unwrap(), "x = 42");
    }

    #[test]
    fn roundtrip_with_empty_key() {
        let header = test_header("kernel_info_request");
        let content = serde_json::json!({});
        let key = b"";

        let frames = build_wire_msg(&header, &content, key).unwrap();
        let raw: Vec<Vec<u8>> = frames.iter().map(|b| b.to_vec()).collect();
        let msg = parse_wire_msg(&raw, key).expect("parse with empty key");
        assert_eq!(msg.header.msg_type, "kernel_info_request");
    }

    #[test]
    fn parse_rejects_wrong_key() {
        let header = test_header("execute_request");
        let content = serde_json::json!({"code": "1"});
        let key = b"correct-key";

        let frames = build_wire_msg(&header, &content, key).unwrap();
        let raw: Vec<Vec<u8>> = frames.iter().map(|b| b.to_vec()).collect();

        let wrong_key = b"wrong-key";
        let result = parse_wire_msg(&raw, wrong_key);
        assert!(result.is_err(), "should reject message with wrong HMAC key");
        assert!(
            result.unwrap_err().to_string().contains("HMAC mismatch"),
            "error should mention HMAC mismatch"
        );
    }

    #[test]
    fn parse_rejects_truncated_message() {
        // only 2 frames — not enough after delimiter
        let frames = vec![DELIM.to_vec(), b"sig".to_vec()];
        let result = parse_wire_msg(&frames, b"");
        assert!(result.is_err(), "should reject truncated message");
    }

    #[test]
    fn parse_rejects_missing_delimiter() {
        let frames: Vec<Vec<u8>> = vec![
            b"not-a-delimiter".to_vec(),
            b"".to_vec(),
            b"{}".to_vec(),
            b"{}".to_vec(),
            b"{}".to_vec(),
            b"{}".to_vec(),
        ];
        let result = parse_wire_msg(&frames, b"");
        assert!(result.is_err(), "should reject message without delimiter");
    }

    #[test]
    fn build_wire_msg_header_is_valid_json() {
        let header = test_header("complete_request");
        let content = serde_json::json!({"code": "imp", "cursor_pos": 3});
        let key = b"k";

        let frames = build_wire_msg(&header, &content, key).unwrap();
        // frame[2] is the header JSON
        let h: JupyterHeader =
            serde_json::from_slice(&frames[2]).expect("header frame should be valid JSON");
        assert_eq!(h.msg_type, "complete_request");
        // frame[5] is the content JSON
        let c: serde_json::Value =
            serde_json::from_slice(&frames[5]).expect("content frame should be valid JSON");
        assert_eq!(c["cursor_pos"], 3);
    }
}
