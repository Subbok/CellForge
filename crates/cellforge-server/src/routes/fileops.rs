use crate::routes::{auth, safe_resolve, user_notebook_dir};
use crate::state::AppState;
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use std::io::{Cursor, Write};
use std::sync::Arc;

/// Upload files (multipart) — supports folders via relative paths.
pub async fn upload(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut multipart: axum_extra::extract::Multipart,
) -> Result<StatusCode, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);

    while let Ok(Some(field)) = multipart.next_field().await {
        let file_name = field.file_name().unwrap_or("unnamed").to_string();
        let data = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;

        // support subfolder paths like "folder/file.ipynb"
        let dest = safe_resolve(&dir, &file_name)?;
        if let Some(parent) = dest.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        // if it's a zip, extract it
        if file_name.ends_with(".zip") {
            extract_zip(&data, &dir).map_err(|e| {
                tracing::error!("extract zip: {e}");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        } else {
            std::fs::write(&dest, &data).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
    }

    Ok(StatusCode::OK)
}

/// Create folder.
#[derive(Deserialize)]
pub struct MkdirReq {
    path: String,
}

pub async fn mkdir(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<MkdirReq>,
) -> Result<StatusCode, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let resolved = safe_resolve(&dir, &req.path)?;
    std::fs::create_dir_all(resolved).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

/// Write a text file (create or overwrite). Used by the Typst document editor.
#[derive(Deserialize)]
pub struct WriteReq {
    path: String,
    content: String,
}

pub async fn write_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<WriteReq>,
) -> Result<StatusCode, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let full = safe_resolve(&dir, &req.path)?;
    if let Some(parent) = full.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&full, req.content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

/// Delete file or folder.
#[derive(Deserialize)]
pub struct DeleteReq {
    path: String,
}

pub async fn delete_path(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<DeleteReq>,
) -> Result<StatusCode, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let full = safe_resolve(&dir, &req.path)?;

    // collect canonical paths of ALL files before deleting
    // (so we can clean up symlinks pointing to them)
    let mut file_paths = vec![];
    if full.is_dir() {
        collect_files_recursive(&full, &mut file_paths);
    } else if let Ok(p) = std::fs::canonicalize(&full) {
        file_paths.push(p);
    }

    // delete
    if full.is_dir() {
        std::fs::remove_dir_all(&full).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        std::fs::remove_file(&full).map_err(|_| StatusCode::NOT_FOUND)?;
    }

    // clean up symlinks in other users' workspaces
    if !file_paths.is_empty()
        && let Some(users_dir) = dir.parent().and_then(|p| p.parent())
    {
        cleanup_symlinks(users_dir, &file_paths);
    }

    Ok(StatusCode::OK)
}

fn collect_files_recursive(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_files_recursive(&p, out);
        } else if let Ok(canon) = std::fs::canonicalize(&p) {
            out.push(canon);
        }
    }
}

fn cleanup_symlinks(users_dir: &std::path::Path, targets: &[std::path::PathBuf]) {
    let Ok(entries) = std::fs::read_dir(users_dir) else {
        return;
    };
    for user in entries.flatten() {
        let nb = user.path().join("notebooks");
        cleanup_symlinks_in_dir(&nb, targets);
    }
}

fn cleanup_symlinks_in_dir(dir: &std::path::Path, targets: &[std::path::PathBuf]) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for f in entries.flatten() {
        let p = f.path();
        if p.is_dir() && !p.is_symlink() {
            cleanup_symlinks_in_dir(&p, targets);
        } else if p.is_symlink()
            && let Ok(target) = std::fs::read_link(&p)
            && targets.contains(&target)
        {
            let _ = std::fs::remove_file(&p);
        }
    }
}

/// Rename file or folder.
#[derive(Deserialize)]
pub struct RenamePathReq {
    old_path: String,
    new_name: String,
}

pub async fn rename_path(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<RenamePathReq>,
) -> Result<StatusCode, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let old = safe_resolve(&dir, &req.old_path)?;
    let new_path = safe_resolve(&dir, &{
        let parent = old
            .strip_prefix(&dir)
            .ok()
            .and_then(|p| p.parent())
            .unwrap_or(std::path::Path::new(""));
        parent.join(&req.new_name).to_string_lossy().to_string()
    })?;
    std::fs::rename(&old, &new_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // update symlinks for shared files when a file is renamed
    if let Some(username) = auth::extract_user(&headers) {
        let old_name = old
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        state
            .users
            .update_shared_file_rename(&username, &old_name, &req.new_name, &new_path);
    }

    Ok(StatusCode::OK)
}

/// Move a file or folder to a new location (e.g. drag-and-drop into a folder).
/// Unlike `rename_path` (same-directory only), `dest` is a full path relative
/// to the user workspace, so this also moves across folders.
#[derive(Deserialize)]
pub struct MoveReq {
    src: String,
    dest: String,
}

pub async fn move_path(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<MoveReq>,
) -> Result<StatusCode, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let src = safe_resolve(&dir, &req.src)?;
    let dest = safe_resolve(&dir, &req.dest)?;

    if dest.exists() {
        return Err(StatusCode::CONFLICT);
    }
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // fs::rename rejects moving a directory into its own subtree, which is the
    // main invalid case — surface it as a 400 rather than a generic 500.
    std::fs::rename(&src, &dest).map_err(|e| {
        tracing::warn!("move {} -> {}: {e}", req.src, req.dest);
        StatusCode::BAD_REQUEST
    })?;
    Ok(StatusCode::OK)
}

/// Download selected files as ZIP.
#[derive(Deserialize)]
pub struct ZipReq {
    paths: Vec<String>,
}

/// Build a ZIP archive from `paths` (relative to `dir`). Files are added at
/// their requested path; directories are walked recursively and every
/// contained file is added at its path relative to `dir` (structure preserved).
/// Returns the archive bytes and a suggested download filename.
fn build_zip_archive(
    dir: &std::path::Path,
    paths: &[String],
) -> Result<(Vec<u8>, String), StatusCode> {
    let dir_canon = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());

    let mut buf = Vec::new();
    {
        let cursor = Cursor::new(&mut buf);
        let mut zip = zip::ZipWriter::new(cursor);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for path in paths {
            let full = safe_resolve(dir, path)?;
            if full.is_file() {
                zip.start_file(path.clone(), options)
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                let data = std::fs::read(&full).map_err(|_| StatusCode::NOT_FOUND)?;
                zip.write_all(&data)
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            } else if full.is_dir() {
                let mut files = Vec::new();
                collect_files_recursive(&full, &mut files);
                for file in files {
                    let name = file
                        .strip_prefix(&dir_canon)
                        .ok()
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_else(|| {
                            file.file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string()
                        });
                    zip.start_file(name, options)
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                    let data = std::fs::read(&file).map_err(|_| StatusCode::NOT_FOUND)?;
                    zip.write_all(&data)
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                }
            }
        }
        zip.finish()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    // Single folder selected -> "<folder>.zip"; otherwise "files.zip".
    let filename = if paths.len() == 1 {
        let full = safe_resolve(dir, &paths[0])?;
        if full.is_dir() {
            full.file_name()
                .map(|n| format!("{}.zip", n.to_string_lossy()))
                .filter(|n| n != ".zip")
                .unwrap_or_else(|| "files.zip".to_string())
        } else {
            "files.zip".to_string()
        }
    } else {
        "files.zip".to_string()
    };

    Ok((buf, filename))
}

pub async fn download_zip(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<ZipReq>,
) -> Result<Response, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let (buf, filename) = build_zip_archive(&dir, &req.paths)?;
    let content_disposition = format!("attachment; filename=\"{filename}\"");

    Ok((
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (header::CONTENT_DISPOSITION, content_disposition),
        ],
        buf,
    )
        .into_response())
}

/// Extract an existing zip file in workspace.
#[derive(Deserialize)]
pub struct ExtractReq {
    path: String,
}

pub async fn extract_zip_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<ExtractReq>,
) -> Result<StatusCode, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let zip_path = safe_resolve(&dir, &req.path)?;
    if !zip_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let data = std::fs::read(&zip_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    extract_zip(&data, &dir).map_err(|e| {
        tracing::error!("extract zip: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(StatusCode::OK)
}

/// Share file with another user.
#[derive(Deserialize)]
pub struct ShareReq {
    file_path: String,
    to_user: String,
}

pub async fn share_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<ShareReq>,
) -> Result<impl IntoResponse, StatusCode> {
    let from = auth::extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let dir = user_notebook_dir(&state, &headers);
    let src = safe_resolve(&dir, &req.file_path)?;

    if !src.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    // only owner can share — symlinks (files shared by others) can't be re-shared
    if src.is_symlink() {
        return Err(StatusCode::FORBIDDEN);
    }

    let file_name = src
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    state
        .users
        .share_file(&from, &req.to_user, &file_name, &src)
        .map_err(|e| {
            tracing::error!("share: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// List files shared with current user.
pub async fn shared_files(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let username = auth::extract_user(&headers).unwrap_or_default();
    Json(state.users.shared_with(&username))
}

/// GET /api/files/shares-by-me?file_name=foo.ipynb — list users this user
/// has shared the given file with. Used by the share dialog to render
/// the "already shared with" list with unshare buttons.
#[derive(Deserialize)]
pub struct SharesByMeQuery {
    file_name: String,
}

pub async fn shares_by_me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    axum::extract::Query(q): axum::extract::Query<SharesByMeQuery>,
) -> impl IntoResponse {
    let from = auth::extract_user(&headers).unwrap_or_default();
    Json(state.users.shares_by_me_of(&from, &q.file_name))
}

/// Remove a share.
#[derive(Deserialize)]
pub struct UnshareReq {
    share_id: i64,
}

pub async fn unshare_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<UnshareReq>,
) -> Result<impl IntoResponse, StatusCode> {
    let _username = auth::extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    state
        .users
        .unshare_file(req.share_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// List all users (for share picker).
pub async fn share_users(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let me = auth::extract_user(&headers).unwrap_or_default();
    let users: Vec<_> = state
        .users
        .list_users()
        .into_iter()
        .filter(|u| u.username != me)
        .map(|u| serde_json::json!({"username": u.username, "display_name": u.display_name}))
        .collect();
    Json(users)
}

/// Download a single file.
#[derive(Deserialize)]
pub struct DownloadReq {
    path: String,
}

pub async fn download_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<DownloadReq>,
) -> Result<Response, StatusCode> {
    let dir = user_notebook_dir(&state, &headers);
    let full = safe_resolve(&dir, &req.path)?;
    if !full.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    let data = std::fs::read(&full).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let name = full
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (
                header::CONTENT_DISPOSITION,
                &format!("attachment; filename=\"{name}\""),
            ),
        ],
        data,
    )
        .into_response())
}

// -- history --

#[derive(Deserialize)]
pub struct HistoryReq {
    path: String,
}

pub async fn file_history(
    State(state): State<Arc<AppState>>,
    Json(req): Json<HistoryReq>,
) -> impl IntoResponse {
    Json(state.users.get_history(&req.path, 50))
}

pub async fn history_snapshot(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<i64>,
) -> Result<impl IntoResponse, StatusCode> {
    state
        .users
        .get_snapshot(id)
        .map_err(|_| StatusCode::NOT_FOUND)
}

fn extract_zip(data: &[u8], dest: &std::path::Path) -> anyhow::Result<()> {
    let cursor = Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor)?;
    let dest_canon = std::fs::canonicalize(dest).unwrap_or_else(|_| dest.to_path_buf());

    const MAX_FILE_SIZE: u64 = 100 * 1024 * 1024; // 100 MB per file

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();

        // skip directories and hidden files
        if name.ends_with('/') || name.starts_with("__MACOSX") || name.contains("/.") {
            continue;
        }

        // reject path traversal in zip entries
        if name.contains("..") || name.starts_with('/') {
            anyhow::bail!("rejected unsafe path in zip: {name}");
        }

        // reject zip bomb
        if file.size() > MAX_FILE_SIZE {
            anyhow::bail!(
                "file too large in zip: {name} ({} bytes, max {})",
                file.size(),
                MAX_FILE_SIZE
            );
        }

        let out_path = dest.join(&name);
        // double-check containment after join
        let out_canon = if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
            let parent_canon =
                std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
            parent_canon.join(out_path.file_name().unwrap_or_default())
        } else {
            out_path.clone()
        };
        if !out_canon.starts_with(&dest_canon) {
            anyhow::bail!("zip entry escapes destination: {name}");
        }

        let mut out_file = std::fs::File::create(&out_path)?;
        std::io::copy(&mut file, &mut out_file)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn zip_includes_nested_folder_files() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        fs::create_dir_all(dir.join("myfolder/sub")).unwrap();
        fs::write(dir.join("myfolder/a.txt"), b"hello").unwrap();
        fs::write(dir.join("myfolder/sub/b.txt"), b"world").unwrap();

        let (bytes, filename) =
            build_zip_archive(dir, &["myfolder".to_string()]).unwrap();

        assert!(!bytes.is_empty(), "archive should not be empty");
        assert_eq!(filename, "myfolder.zip");

        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.contains(&"myfolder/a.txt".to_string()), "names={names:?}");
        assert!(names.contains(&"myfolder/sub/b.txt".to_string()), "names={names:?}");
    }

    #[test]
    fn zip_name_is_files_for_multiple_selection() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        fs::write(dir.join("a.txt"), b"a").unwrap();
        fs::write(dir.join("b.txt"), b"b").unwrap();

        let (_, filename) = build_zip_archive(
            dir,
            &["a.txt".to_string(), "b.txt".to_string()],
        )
        .unwrap();
        assert_eq!(filename, "files.zip");
    }
}
