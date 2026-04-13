use crate::plugins::PluginSettings;
use crate::routes::{fileops, files, kernels, notebooks, safe_resolve};
use crate::state::AppState;
use crate::ws::collab::CollabState;

use axum::Router;
use axum::body::Body;
use axum::routing::{delete, get, post};
use cellforge_auth::db::UserDb;
use cellforge_kernel::manager::KernelManager;
use http::Request;
use http_body_util::BodyExt;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tempfile::TempDir;
use tokio::sync::Mutex;
use tower::ServiceExt;

/// Build a minimal AppState pointing at the given temp directory.
fn test_state(dir: &std::path::Path) -> Arc<AppState> {
    Arc::new(AppState {
        notebook_dir: dir.to_path_buf(),
        initial_notebook: None,
        sessions: RwLock::new(HashMap::new()),
        kernels: Mutex::new(KernelManager::new()),
        notebook_kernels: Mutex::new(HashMap::new()),
        users: UserDb::open().expect("user db"),
        collab: Arc::new(CollabState::new()),
        plugin_settings: RwLock::new(PluginSettings::default()),
        hub_mode: false,
        idle_timeout_mins: 30,
    })
}

/// Collect the full response body as bytes.
async fn body_bytes(body: Body) -> Vec<u8> {
    body.collect().await.unwrap().to_bytes().to_vec()
}

// ---------------------------------------------------------------------------
// 1. Path traversal rejection (unit test for safe_resolve)
// ---------------------------------------------------------------------------

#[test]
fn safe_resolve_blocks_traversal() {
    let tmp = TempDir::new().unwrap();
    let base = tmp.path();

    // simple traversal — parent exists so canonicalize catches it
    let result = safe_resolve(base, "../../etc/passwd");
    assert!(result.is_err(), "should reject path traversal");

    // nested traversal through an *existing* subdirectory targeting a
    // world-readable directory (so canonicalize succeeds and the check fires)
    std::fs::create_dir(base.join("subdir")).unwrap();
    let result = safe_resolve(base, "subdir/../../../tmp");
    assert!(
        result.is_err(),
        "should reject nested traversal via existing subdir"
    );

    // absolute path that escapes base
    let result = safe_resolve(base, "/etc/passwd");
    assert!(result.is_err(), "should reject absolute path");
}

#[test]
fn safe_resolve_allows_valid_paths() {
    let tmp = TempDir::new().unwrap();
    let base = tmp.path();

    // create a real file so canonicalize works
    std::fs::write(base.join("hello.txt"), "hi").unwrap();

    let result = safe_resolve(base, "hello.txt");
    assert!(result.is_ok(), "should allow simple valid path");

    // subdirectory that doesn't exist yet (mkdir case)
    let result = safe_resolve(base, "newdir");
    assert!(result.is_ok(), "should allow new child path");
}

// ---------------------------------------------------------------------------
// 2. File listing
// ---------------------------------------------------------------------------

#[tokio::test]
async fn file_listing_returns_files() {
    let tmp = TempDir::new().unwrap();
    let base = tmp.path();

    // create some files and a directory
    std::fs::write(base.join("readme.txt"), "hello").unwrap();
    std::fs::write(base.join("data.csv"), "a,b,c").unwrap();
    std::fs::create_dir(base.join("subdir")).unwrap();
    // hidden file should be excluded
    std::fs::write(base.join(".hidden"), "secret").unwrap();

    let state = test_state(base);
    let app = Router::new()
        .route("/api/files", get(files::list_root))
        .with_state(state);

    let req = Request::builder()
        .uri("/api/files")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);

    let bytes = body_bytes(resp.into_body()).await;
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();

    // should have 3 entries (subdir, data.csv, readme.txt), hidden excluded
    let names: Vec<&str> = entries.iter().filter_map(|e| e["name"].as_str()).collect();
    assert!(names.contains(&"readme.txt"), "should list readme.txt");
    assert!(names.contains(&"data.csv"), "should list data.csv");
    assert!(names.contains(&"subdir"), "should list subdir");
    assert!(!names.contains(&".hidden"), "should exclude hidden files");

    // directories sort first
    assert_eq!(
        entries[0]["name"].as_str().unwrap(),
        "subdir",
        "directory should sort first"
    );
    assert!(entries[0]["is_dir"].as_bool().unwrap());
}

// ---------------------------------------------------------------------------
// 3. Mkdir + delete
// ---------------------------------------------------------------------------

#[tokio::test]
async fn mkdir_and_delete() {
    let tmp = TempDir::new().unwrap();
    let base = tmp.path();
    let state = test_state(base);

    let app = Router::new()
        .route("/api/files/mkdir", post(fileops::mkdir))
        .route("/api/files/delete", post(fileops::delete_path))
        .with_state(state);

    // -- mkdir --
    let req = Request::builder()
        .method("POST")
        .uri("/api/files/mkdir")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"path": "my_folder"}"#))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    assert!(base.join("my_folder").is_dir(), "directory should exist");

    // -- delete --
    let req = Request::builder()
        .method("POST")
        .uri("/api/files/delete")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"path": "my_folder"}"#))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    assert!(
        !base.join("my_folder").exists(),
        "directory should be deleted"
    );
}

// ---------------------------------------------------------------------------
// 4. Notebook CRUD
// ---------------------------------------------------------------------------

#[tokio::test]
async fn notebook_crud() {
    let tmp = TempDir::new().unwrap();
    let base = tmp.path();
    let state = test_state(base);

    let app = Router::new()
        .route(
            "/api/notebooks",
            get(notebooks::list).post(notebooks::create),
        )
        .route(
            "/api/notebooks/{*path}",
            get(notebooks::read)
                .put(notebooks::save)
                .delete(notebooks::remove),
        )
        .with_state(state);

    // -- create --
    let req = Request::builder()
        .method("POST")
        .uri("/api/notebooks")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"name": "test.ipynb"}"#))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);

    let bytes = body_bytes(resp.into_body()).await;
    let entry: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(entry["name"].as_str().unwrap(), "test.ipynb");
    assert!(base.join("test.ipynb").exists());

    // -- read --
    let req = Request::builder()
        .uri("/api/notebooks/test.ipynb")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);

    let bytes = body_bytes(resp.into_body()).await;
    let nb: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(nb["nbformat"].as_u64().unwrap(), 4);
    assert!(nb["cells"].as_array().is_some());

    // -- save (modify and PUT) --
    // Add a markdown cell to the notebook
    let mut modified = nb.clone();
    let cells = modified["cells"].as_array_mut().unwrap();
    cells.push(serde_json::json!({
        "cell_type": "markdown",
        "id": "test-cell-1",
        "source": "# Hello from test",
        "metadata": {}
    }));

    let req = Request::builder()
        .method("PUT")
        .uri("/api/notebooks/test.ipynb")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&modified).unwrap()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);

    // verify the saved notebook has 2 cells
    let req = Request::builder()
        .uri("/api/notebooks/test.ipynb")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    let bytes = body_bytes(resp.into_body()).await;
    let nb2: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(nb2["cells"].as_array().unwrap().len(), 2);

    // -- list --
    let req = Request::builder()
        .uri("/api/notebooks")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    let bytes = body_bytes(resp.into_body()).await;
    let list: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["name"].as_str().unwrap(), "test.ipynb");

    // -- delete --
    let req = Request::builder()
        .method("DELETE")
        .uri("/api/notebooks/test.ipynb")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 204);
    assert!(!base.join("test.ipynb").exists());
}

// -- duplicate creation returns CONFLICT --
#[tokio::test]
async fn notebook_create_conflict() {
    let tmp = TempDir::new().unwrap();
    let base = tmp.path();
    let state = test_state(base);

    let app = Router::new()
        .route("/api/notebooks", post(notebooks::create))
        .with_state(state);

    // create once
    let req = Request::builder()
        .method("POST")
        .uri("/api/notebooks")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"name": "dup.ipynb"}"#))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);

    // create again => 409
    let req = Request::builder()
        .method("POST")
        .uri("/api/notebooks")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"name": "dup.ipynb"}"#))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 409);
}

// ---------------------------------------------------------------------------
// 5. Kernel listing
// ---------------------------------------------------------------------------

#[tokio::test]
async fn kernel_listing_returns_json_array() {
    let tmp = TempDir::new().unwrap();
    let state = test_state(tmp.path());

    let app = Router::new()
        .route("/api/kernelspecs", get(kernels::list_specs))
        .with_state(state);

    let req = Request::builder()
        .uri("/api/kernelspecs")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);

    let bytes = body_bytes(resp.into_body()).await;
    let specs: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(specs.is_array(), "kernelspecs should return a JSON array");
}

// ---------------------------------------------------------------------------
// 6. Session CRUD (bonus: exercises session routes)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn session_create_list_delete() {
    let tmp = TempDir::new().unwrap();
    let state = test_state(tmp.path());

    let app = Router::new()
        .route(
            "/api/sessions",
            get(kernels::list_sessions).post(kernels::create_session),
        )
        .route("/api/sessions/{id}", delete(kernels::delete_session))
        .with_state(state);

    // create session
    let req = Request::builder()
        .method("POST")
        .uri("/api/sessions")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"notebook_path": "test.ipynb", "kernel_name": "python3"}"#,
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    let bytes = body_bytes(resp.into_body()).await;
    let session: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let session_id = session["id"].as_str().unwrap().to_string();
    assert!(!session_id.is_empty());

    // list sessions
    let req = Request::builder()
        .uri("/api/sessions")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
    let bytes = body_bytes(resp.into_body()).await;
    let sessions: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(sessions.len(), 1);

    // delete session
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/sessions/{session_id}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 204);

    // list should be empty now
    let req = Request::builder()
        .uri("/api/sessions")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let bytes = body_bytes(resp.into_body()).await;
    let sessions: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
    assert!(sessions.is_empty());
}
