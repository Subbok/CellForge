//! Git integration — exposes basic git info for the sidebar panel.
//! Works on the user's notebook workspace directory.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Serialize;
use std::process::Command;
use std::sync::Arc;

use crate::routes::user_notebook_dir;
use crate::state::AppState;

#[derive(Serialize)]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: String,
    pub changed: Vec<GitFile>,
    pub log: Vec<GitCommit>,
}

#[derive(Serialize)]
pub struct GitFile {
    pub status: String, // "M", "A", "D", "??"
    pub path: String,
}

#[derive(Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

pub async fn status(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Json<GitStatus>, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);

    // check if it's a git repo
    let is_repo = Command::new("git")
        .args(["rev-parse", "--git-dir"])
        .current_dir(&dir)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !is_repo {
        return Ok(Json(GitStatus {
            is_repo: false,
            branch: String::new(),
            changed: vec![],
            log: vec![],
        }));
    }

    // branch
    let branch =
        run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|| "unknown".into());

    // changed files
    let status_out = run_git(&dir, &["status", "--porcelain"]).unwrap_or_default();
    let changed: Vec<GitFile> = status_out
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| {
            let (st, path) = l.split_at(3.min(l.len()));
            GitFile {
                status: st.trim().to_string(),
                path: path.trim().to_string(),
            }
        })
        .collect();

    // recent commits
    let log_out =
        run_git(&dir, &["log", "--oneline", "--format=%h|%s|%an|%ar", "-10"]).unwrap_or_default();
    let log: Vec<GitCommit> = log_out
        .lines()
        .filter_map(|l| {
            let parts: Vec<&str> = l.splitn(4, '|').collect();
            if parts.len() < 4 {
                return None;
            }
            Some(GitCommit {
                hash: parts[0].to_string(),
                message: parts[1].to_string(),
                author: parts[2].to_string(),
                date: parts[3].to_string(),
            })
        })
        .collect();

    Ok(Json(GitStatus {
        is_repo: true,
        branch,
        changed,
        log,
    }))
}

fn run_git(dir: &std::path::Path, args: &[&str]) -> Option<String> {
    Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}
