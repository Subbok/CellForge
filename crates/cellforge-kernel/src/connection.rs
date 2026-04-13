use serde::{Deserialize, Serialize};

/// Parsed from the kernel's connection file (the json that ipykernel writes out).
/// We use this to know which ports to connect our zmq sockets to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub transport: String, // almost always "tcp"
    pub ip: String,
    pub shell_port: u16,
    pub iopub_port: u16,
    pub stdin_port: u16,
    pub control_port: u16,
    pub hb_port: u16,
    pub key: String,
    pub signature_scheme: String,
    #[serde(default)]
    pub kernel_name: Option<String>,
}

impl ConnectionInfo {
    pub fn endpoint(&self, port: u16) -> String {
        format!("{}://{}:{}", self.transport, self.ip, port)
    }

    pub fn shell_endpoint(&self) -> String {
        self.endpoint(self.shell_port)
    }
    pub fn iopub_endpoint(&self) -> String {
        self.endpoint(self.iopub_port)
    }
    pub fn stdin_endpoint(&self) -> String {
        self.endpoint(self.stdin_port)
    }
    pub fn control_endpoint(&self) -> String {
        self.endpoint(self.control_port)
    }
    pub fn hb_endpoint(&self) -> String {
        self.endpoint(self.hb_port)
    }
}
