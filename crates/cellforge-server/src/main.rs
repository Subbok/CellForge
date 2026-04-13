mod config;
mod plugins;
mod routes;
mod state;
mod ws;

use crate::config::Config;
use crate::plugins::routes as plugin_routes;
use crate::routes::{admin, ai, auth, dashboard, export, fileops, files, git, kernels, notebooks};
use crate::state::AppState;
use crate::ws::handler::ws_handler;

use axum::Router;
use axum::routing::{delete, get};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

// When built with --features embed-frontend, the entire frontend/dist/ is
// baked into the binary so the release artifact is a single portable file.
#[cfg(feature = "embed-frontend")]
#[derive(rust_embed::Embed)]
#[folder = "../../frontend/dist"]
struct FrontendAssets;

/// Find the built frontend directory. Checks (in order):
/// 1. `frontend/dist/` relative to CWD (dev layout)
/// 2. `dist/` relative to CWD
/// 3. `dist/` next to the binary (release bundle)
///    Returns None if no dist dir found (dev mode with Vite).
#[cfg(not(feature = "embed-frontend"))]
fn find_dist_dir() -> Option<std::path::PathBuf> {
    let candidates = [
        std::path::PathBuf::from("frontend/dist"),
        std::path::PathBuf::from("dist"),
    ];
    for c in &candidates {
        if c.join("index.html").exists() {
            return Some(c.clone());
        }
    }
    // check next to binary
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        let d = dir.join("dist");
        if d.join("index.html").exists() {
            return Some(d);
        }
    }
    None
}

/// Serve embedded frontend assets (when compiled with embed-frontend feature).
#[cfg(feature = "embed-frontend")]
async fn serve_embedded(uri: axum::http::Uri) -> impl axum::response::IntoResponse {
    let path = uri.path().trim_start_matches('/');
    // try the exact path first, then fall back to index.html (SPA routing)
    let (file, serve_path) = match FrontendAssets::get(path) {
        Some(f) => (Some(f), path),
        None => (FrontendAssets::get("index.html"), "index.html"),
    };

    match file {
        Some(content) => {
            let mime = mime_guess::from_path(serve_path).first_or_octet_stream();
            (
                [(axum::http::header::CONTENT_TYPE, mime.as_ref())],
                content.data.into_owned(),
            )
                .into_response()
        }
        None => axum::http::StatusCode::NOT_FOUND.into_response(),
    }
}

#[cfg(feature = "embed-frontend")]
use axum::response::IntoResponse;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("cellforge=debug".parse()?))
        .init();

    let config = Config::parse();
    let state = Arc::new(AppState::new(&config));

    // non-blocking update check
    if !config.no_update_check {
        tokio::spawn(async {
            check_for_updates().await;
        });
    }

    // all the api routes live under /api
    let api = Router::new()
        // auth — no JWT required
        .route("/auth/status", get(auth::status))
        .route("/auth/login", axum::routing::post(auth::login))
        .route("/auth/register", axum::routing::post(auth::register))
        .route("/auth/me", get(auth::me))
        .route("/auth/logout", axum::routing::post(auth::logout))
        .route("/auth/users", get(auth::list_users))
        .route(
            "/auth/users/{username}",
            axum::routing::delete(auth::delete_user),
        )
        .route(
            "/auth/change-password",
            axum::routing::post(auth::change_password),
        )
        // everything below needs auth (enforced by frontend for now)
        .route("/config", get(routes::config))
        .route("/notebooks", get(notebooks::list).post(notebooks::create))
        .route("/notebooks/open", axum::routing::post(notebooks::open_path))
        .route("/notebooks/rename", axum::routing::post(notebooks::rename))
        .route(
            "/notebooks/{*path}",
            get(notebooks::read)
                .put(notebooks::save)
                .delete(notebooks::remove),
        )
        .route("/kernelspecs", get(kernels::list_specs))
        .route(
            "/sessions",
            get(kernels::list_sessions).post(kernels::create_session),
        )
        .route("/sessions/{id}", delete(kernels::delete_session))
        .route("/export/pdf", axum::routing::post(export::export_pdf))
        .route(
            "/templates",
            get(export::list_templates).post(export::upload_template),
        )
        .route(
            "/templates/{name}",
            axum::routing::delete(export::delete_template),
        )
        .route(
            "/templates/{name}/assets",
            axum::routing::post(export::upload_template_assets),
        )
        .route("/files/upload", axum::routing::post(fileops::upload))
        .route("/files/mkdir", axum::routing::post(fileops::mkdir))
        .route("/files/delete", axum::routing::post(fileops::delete_path))
        .route("/files/rename", axum::routing::post(fileops::rename_path))
        .route(
            "/files/download",
            axum::routing::post(fileops::download_file),
        )
        .route(
            "/files/download-zip",
            axum::routing::post(fileops::download_zip),
        )
        .route(
            "/files/extract-zip",
            axum::routing::post(fileops::extract_zip_file),
        )
        .route("/files/history", axum::routing::post(fileops::file_history))
        .route("/files/history/{id}", get(fileops::history_snapshot))
        .route("/files/share", axum::routing::post(fileops::share_file))
        .route("/files/unshare", axum::routing::post(fileops::unshare_file))
        .route("/files/shared", get(fileops::shared_files))
        .route("/files/share-users", get(fileops::share_users))
        .route("/files", get(files::list_root))
        .route("/files/{*path}", get(files::list))
        // plugin management
        .route("/plugins", get(plugin_routes::list_plugins))
        .route(
            "/plugins/config",
            get(plugin_routes::get_config).post(plugin_routes::set_config),
        )
        .route(
            "/plugins/upload",
            axum::routing::post(plugin_routes::upload_plugin),
        )
        .route(
            "/plugins/{scope}/{name}",
            delete(plugin_routes::delete_plugin),
        )
        .route(
            "/plugins/{scope}/{name}/frontend/{*rest}",
            get(plugin_routes::serve_plugin_asset),
        )
        // Dashboard
        .route("/dashboard", get(dashboard::dashboard))
        .route("/dashboard/kernels", get(dashboard::dashboard_kernels))
        .route(
            "/kernels/{id}/stop",
            axum::routing::post(dashboard::stop_kernel),
        )
        // Admin
        .route("/admin/stats", get(admin::stats))
        .route("/admin/users", get(admin::list_users))
        .route(
            "/admin/users/{username}",
            axum::routing::put(admin::update_user),
        )
        .route(
            "/admin/groups",
            get(admin::list_groups).post(admin::create_group),
        )
        .route(
            "/admin/groups/{name}",
            axum::routing::put(admin::update_group).delete(admin::delete_group),
        )
        .route("/admin/kernels", get(admin::all_kernels))
        .route(
            "/admin/kernels/{id}/stop",
            axum::routing::post(admin::stop_kernel),
        )
        .route(
            "/admin/kernels/stop-idle",
            axum::routing::post(admin::stop_all_idle),
        )
        // AI proxy
        .route("/ai/chat", axum::routing::post(ai::chat))
        // Update check
        .route("/update-check", get(update_check_handler))
        // Git
        .route("/git/status", get(git::status))
        .route("/ws", get(ws_handler))
        .route("/collab", get(crate::ws::collab::collab_handler));

    // background reaper: every 30s, kill any idle kernels that have no connected clients
    let app_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            let mut km = app_state.kernels.lock().await;
            let killed = km.cleanup_idle().await;
            if killed > 0 {
                tracing::info!("reaper: killed {killed} idle kernels");
            }
        }
    });

    // Serve the frontend. Priority:
    // 1. Embedded assets (when built with --features embed-frontend)
    // 2. Filesystem dist/ dir (dev mode or old-style release bundle)
    let mut app = Router::new().nest("/api", api);

    #[cfg(feature = "embed-frontend")]
    {
        tracing::info!(
            "serving embedded frontend ({} files)",
            FrontendAssets::iter().count()
        );
        app = app.fallback(serve_embedded);
    }

    #[cfg(not(feature = "embed-frontend"))]
    {
        let dist_dir = find_dist_dir();
        if let Some(ref dist) = dist_dir {
            tracing::info!("serving frontend from {}", dist.display());
            app =
                app.fallback_service(tower_http::services::ServeDir::new(dist).not_found_service(
                    tower_http::services::ServeFile::new(dist.join("index.html")),
                ));
        }
    }

    let app = app
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    tracing::info!("starting at http://{addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

async fn update_check_handler() -> axum::Json<serde_json::Value> {
    let info = fetch_latest_release().await;
    axum::Json(info)
}

async fn fetch_latest_release() -> serde_json::Value {
    let url = "https://api.github.com/repos/Subbok/cellforge/releases/latest";
    let client = reqwest::Client::builder()
        .user_agent("cellforge-update-check")
        .timeout(std::time::Duration::from_secs(5))
        .build();
    let Ok(client) = client else {
        return serde_json::json!({ "current": CURRENT_VERSION, "has_update": false });
    };
    let Ok(resp) = client.get(url).send().await else {
        return serde_json::json!({ "current": CURRENT_VERSION, "has_update": false });
    };
    let Ok(body) = resp.json::<serde_json::Value>().await else {
        return serde_json::json!({ "current": CURRENT_VERSION, "has_update": false });
    };
    let tag = body.get("tag_name").and_then(|v| v.as_str()).unwrap_or("");
    let latest = tag.trim_start_matches('v');
    let has_update = !latest.is_empty() && latest != CURRENT_VERSION && latest > CURRENT_VERSION;
    let download_url = body
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://github.com/Subbok/cellforge/releases/latest");

    serde_json::json!({
        "current": CURRENT_VERSION,
        "latest": latest,
        "has_update": has_update,
        "download_url": download_url,
    })
}

async fn check_for_updates() {
    let info = fetch_latest_release().await;
    if info
        .get("has_update")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let latest = info.get("latest").and_then(|v| v.as_str()).unwrap_or("?");
        tracing::info!(
            "new version available: v{latest} (current: v{CURRENT_VERSION}). Download at https://github.com/Subbok/cellforge/releases/latest"
        );
    }
}
