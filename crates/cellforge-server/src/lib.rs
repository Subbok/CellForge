mod config;
mod plugins;
mod routes;
mod state;
mod ws;

pub use config::Config;

use crate::plugins::routes as plugin_routes;
use crate::routes::{admin, ai, auth, dashboard, export, fileops, files, git, kernels, notebooks};
use crate::state::AppState;
use crate::ws::handler::ws_handler;

use axum::Router;
use axum::routing::{delete, get};
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

// When built with --features embed-frontend, the entire frontend/dist/ is
// baked into the binary so the release artifact is a single portable file.
#[cfg(feature = "embed-frontend")]
use rust_embed::Embed;

#[cfg(feature = "embed-frontend")]
#[derive(Embed)]
#[folder = "../../frontend/dist"]
struct FrontendAssets;

/// Serve embedded frontend assets (when compiled with embed-frontend feature).
#[cfg(feature = "embed-frontend")]
async fn serve_embedded(uri: axum::http::Uri) -> impl axum::response::IntoResponse {
    use axum::response::IntoResponse;

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

/// Allowed origins for the origin_check middleware and CorsLayer. Reads the
/// comma-separated `CELLFORGE_ALLOWED_ORIGINS` env var, falling back to the
/// localhost development set. Parsed once on first access and cached.
/// Stored lowercased so comparisons are case-insensitive on scheme+host.
fn allowed_origins() -> &'static [String] {
    use std::sync::OnceLock;
    static ORIGINS: OnceLock<Vec<String>> = OnceLock::new();
    ORIGINS
        .get_or_init(|| match std::env::var("CELLFORGE_ALLOWED_ORIGINS") {
            Ok(s) if !s.trim().is_empty() => s
                .split(',')
                .map(|o| o.trim().to_lowercase())
                .filter(|o| !o.is_empty())
                .collect(),
            _ => vec![
                // Vite dev server — `scripts/dev.sh` runs the frontend on :3000
                // (port pinned in frontend/vite.config.ts); :5173 is the vite
                // default for anyone overriding the config.
                "http://localhost:3000".into(),
                "http://localhost:5173".into(),
                "http://localhost:8888".into(),
                "http://127.0.0.1:3000".into(),
                "http://127.0.0.1:5173".into(),
                "http://127.0.0.1:8888".into(),
            ],
        })
        .as_slice()
}

/// Middleware: reject requests whose JWT belongs to a disabled account or
/// to an account whose token_version has been bumped (password change,
/// deactivation, admin-role demotion). Runs on every request — unauth'd
/// requests pass through without a DB lookup.
async fn active_user_check(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    if let Some(claims) = crate::routes::auth::extract_claims(req.headers()) {
        let name = &claims.sub;
        if state.users.user_is_disabled(name) {
            return (
                axum::http::StatusCode::UNAUTHORIZED,
                "account disabled",
            )
                .into_response();
        }
        let current_tv = state.users.user_token_version(name);
        if claims.tv < current_tv {
            return (
                axum::http::StatusCode::UNAUTHORIZED,
                "session invalidated — please log in again",
            )
                .into_response();
        }
    }
    next.run(req).await
}

/// Origin-header check middleware. State-changing requests (POST/PUT/DELETE/PATCH)
/// must either (a) be same-origin with the server (Origin's host:port matches
/// the request's `Host` header) OR (b) come from one of the configured
/// allowed origins. Combined with SameSite=Strict cookies this blocks CSRF
/// without needing an explicit token scheme. GET is allowed without an
/// Origin check (browsers don't always send Origin on same-site GETs).
/// Same-origin auto-allow covers the desktop app (binds a random port) and
/// custom-port Docker deployments without requiring operators to set
/// `CELLFORGE_ALLOWED_ORIGINS` per-port. An attacker on a different host
/// cannot forge a matching `Host` header — browsers set Host to the URL
/// they're fetching, which is controlled by the attacker's own script.
async fn origin_check(
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::http::Method;
    use axum::response::IntoResponse;
    let is_state_changing = matches!(
        req.method(),
        &Method::POST | &Method::PUT | &Method::DELETE | &Method::PATCH
    );
    if is_state_changing {
        let origin = req.headers().get("origin").and_then(|v| v.to_str().ok());
        let host = req.headers().get("host").and_then(|v| v.to_str().ok());
        let allowed = match origin {
            Some(o) => {
                // Strip scheme from Origin to get host:port; compare to Host
                // header case-insensitively (RFC 3986: host is case-insensitive).
                let origin_hostport = o
                    .split_once("://")
                    .map(|(_, rest)| rest)
                    .unwrap_or(o);
                let same_origin = host
                    .map(|h| origin_hostport.eq_ignore_ascii_case(h))
                    .unwrap_or(false);
                if same_origin {
                    true
                } else {
                    let lo = o.to_lowercase();
                    allowed_origins().iter().any(|a| a == &lo)
                }
            }
            // Missing Origin header on a state-changing request — this happens
            // for server-side tools (curl, tests) but browsers always send it
            // on fetch/XHR. Allow it only if there's no Cookie either (i.e. no
            // ambient auth) — prevents CSRF-via-cookies, still works for CLI.
            None => req.headers().get("cookie").is_none(),
        };
        if !allowed {
            return (axum::http::StatusCode::FORBIDDEN, "origin check failed").into_response();
        }
    }
    next.run(req).await
}

fn build_api_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/health", get(health_handler))
        // auth -- no JWT required
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
        .route("/files/shares-by-me", get(fileops::shares_by_me))
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
        .route("/collab", get(crate::ws::collab::collab_handler))
}

/// Start the CellForge server on the given listener with the provided config.
pub async fn run_server(listener: tokio::net::TcpListener, config: Config) -> anyhow::Result<()> {
    let state = Arc::new(AppState::new(&config));

    // non-blocking update check
    if !config.no_update_check {
        tokio::spawn(async {
            check_for_updates().await;
        });
    }

    let api = build_api_router();

    // background reaper: every 30s, kill any idle kernels that have no connected clients.
    // Snapshot the IDs under the lock, then stop kernels one-at-a-time so the
    // lock is released between teardowns — otherwise 2s-per-kernel wait stacks
    // up and blocks every WS handler during the sweep.
    let app_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            let idle: Vec<String> = {
                let km = app_state.kernels.lock().await;
                km.idle_kernel_ids()
            };
            let mut killed = 0;
            for id in idle {
                let mut km = app_state.kernels.lock().await;
                // recheck refs under the lock — a client may have re-attached
                // between snapshot and this iteration
                let still_idle = km
                    .get(&id)
                    .map(|k| k.ref_count.load(std::sync::atomic::Ordering::Relaxed) == 0)
                    .unwrap_or(false);
                if still_idle && km.stop(&id).await.is_ok() {
                    killed += 1;
                    // Drop the kernel_sessions row so dashboard queries
                    // don't keep showing the dead kernel. WS handler does
                    // this on the normal close path; the reaper needs to
                    // do it too for kernels that went idle without a
                    // clean disconnect.
                    let _ = app_state.users.remove_kernel_session(&id);
                }
            }
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

    // Allowed origins for CORS + Origin-header check middleware.
    // Any state-changing request (POST/PUT/DELETE/PATCH) whose `Origin` is
    // absent or not in this list is rejected — combined with SameSite=Strict
    // cookies, this gives us CSRF protection without a token scheme.
    tracing::info!("allowed origins: {:?}", allowed_origins());
    let cors_origins: Vec<axum::http::HeaderValue> = allowed_origins()
        .iter()
        .filter_map(|s| axum::http::HeaderValue::from_str(s).ok())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(cors_origins))
        .allow_credentials(true)
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::DELETE,
            axum::http::Method::PATCH,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::COOKIE,
            axum::http::header::AUTHORIZATION,
        ]);

    // Raise the axum default body limit (2 MiB) to match the notebook-size
    // cap in cellforge-notebook::io::MAX_NOTEBOOK_SIZE. Anything bigger is
    // rejected at the HTTP layer before hitting the JSON extractor, and
    // read_notebook stat-checks the on-disk size on its own path
    //. Plugin uploads stay tighter
    let body_limit =
        axum::extract::DefaultBodyLimit::max(cellforge_notebook::io::MAX_NOTEBOOK_SIZE as usize);

    let app = app
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            active_user_check,
        ))
        .layer(axum::middleware::from_fn(origin_check))
        .layer(cors)
        .layer(body_limit)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    axum::serve(listener, app).await?;
    Ok(())
}

async fn health_handler() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "version": VERSION,
    }))
}

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
        return serde_json::json!({ "current": VERSION, "has_update": false });
    };
    let Ok(resp) = client.get(url).send().await else {
        return serde_json::json!({ "current": VERSION, "has_update": false });
    };
    let Ok(body) = resp.json::<serde_json::Value>().await else {
        return serde_json::json!({ "current": VERSION, "has_update": false });
    };
    let tag = body.get("tag_name").and_then(|v| v.as_str()).unwrap_or("");
    let latest = tag.trim_start_matches('v');
    let has_update = !latest.is_empty() && latest != VERSION && latest > VERSION;
    let download_url = body
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://github.com/Subbok/cellforge/releases/latest");

    serde_json::json!({
        "current": VERSION,
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
            "new version available: v{latest} (current: v{VERSION}). Download at https://github.com/Subbok/cellforge/releases/latest"
        );
    }
}
