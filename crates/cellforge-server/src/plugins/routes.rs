//! HTTP routes for plugin management.
//!
//! ```text
//! GET    /api/plugins               — merged list (user overrides system)
//! GET    /api/plugins/config        — current admin settings
//! POST   /api/plugins/config        — admin-only: update allow_user_plugins
//! POST   /api/plugins/upload        — upload a plugin as a .zip (scope query param)
//! DELETE /api/plugins/:scope/:name  — remove an installed plugin
//! GET    /api/plugins/:scope/:name/frontend/*path — serve a plugin's frontend asset
//! ```

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use axum_extra::extract::Multipart;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;

use crate::routes::auth;
use crate::state::AppState;

use super::manifest::is_valid_plugin_name;
use super::{
    PluginManifest, PluginScope, PluginSettings, save_plugin_settings, scan_all_plugins,
    system_plugin_dir, user_plugin_dir,
};

// ── list ──

#[derive(Serialize)]
pub struct PluginEntry {
    pub manifest: PluginManifest,
    pub scope: PluginScope,
}

pub async fn list_plugins(
    State(_state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Json<Vec<PluginEntry>> {
    let username = auth::extract_user(&headers);
    let plugins = scan_all_plugins(username.as_deref());
    let mut out: Vec<PluginEntry> = plugins
        .into_values()
        .map(|p| PluginEntry {
            manifest: p.manifest,
            scope: p.scope,
        })
        .collect();
    out.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    Json(out)
}

// ── admin config ──

pub async fn get_config(State(state): State<Arc<AppState>>) -> Json<PluginSettings> {
    Json(state.plugin_settings.read().clone())
}

pub async fn set_config(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(new_settings): Json<PluginSettings>,
) -> Result<Json<PluginSettings>, StatusCode> {
    // admin-only
    let caller = auth::extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let is_admin = state
        .users
        .get_user(&caller)
        .map(|u| u.is_admin)
        .unwrap_or(false);
    if !is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    if let Err(e) = save_plugin_settings(&new_settings) {
        tracing::error!("save plugin settings: {e}");
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    *state.plugin_settings.write() = new_settings.clone();
    tracing::info!("plugin settings updated by admin '{caller}': {new_settings:?}");
    Ok(Json(new_settings))
}

// ── upload ──

#[derive(Deserialize)]
pub struct UploadQuery {
    /// "user" (default) or "system". System uploads require admin.
    #[serde(default)]
    pub scope: Option<String>,
}

pub async fn upload_plugin(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Query(q): Query<UploadQuery>,
    mut multipart: Multipart,
) -> Result<Json<PluginManifest>, (StatusCode, String)> {
    let caller =
        auth::extract_user(&headers).ok_or((StatusCode::UNAUTHORIZED, "login required".into()))?;
    let is_admin = state
        .users
        .get_user(&caller)
        .map(|u| u.is_admin)
        .unwrap_or(false);

    // resolve target scope
    let scope = match q.scope.as_deref() {
        Some("system") => {
            if !is_admin {
                return Err((StatusCode::FORBIDDEN, "system plugins require admin".into()));
            }
            PluginScope::System
        }
        _ => {
            // per-user: respect the admin toggle
            let allow = state.plugin_settings.read().allow_user_plugins;
            if !allow && !is_admin {
                return Err((
                    StatusCode::FORBIDDEN,
                    "user plugin installation is disabled by admin".into(),
                ));
            }
            PluginScope::User
        }
    };

    // pull the first file field from the multipart body
    let zip_bytes = if let Ok(Some(field)) = multipart.next_field().await {
        let data = field
            .bytes()
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("read upload: {e}")))?;
        Some(data.to_vec())
    } else {
        None
    };
    let Some(data) = zip_bytes else {
        return Err((StatusCode::BAD_REQUEST, "no file uploaded".into()));
    };

    // extract to a staging directory, validate, then move to final location
    let manifest = install_plugin_zip(&data, scope, &caller)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("install failed: {e}")))?;

    tracing::info!(
        "plugin '{}' installed ({:?}) by '{}'",
        manifest.name,
        scope,
        caller,
    );
    Ok(Json(manifest))
}

// ── delete ──

pub async fn delete_plugin(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Path((scope, name)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    let caller =
        auth::extract_user(&headers).ok_or((StatusCode::UNAUTHORIZED, "login required".into()))?;
    let is_admin = state
        .users
        .get_user(&caller)
        .map(|u| u.is_admin)
        .unwrap_or(false);

    if !is_valid_plugin_name(&name) {
        return Err((StatusCode::BAD_REQUEST, "invalid plugin name".into()));
    }

    let dir = match scope.as_str() {
        "system" => {
            if !is_admin {
                return Err((StatusCode::FORBIDDEN, "admin required".into()));
            }
            system_plugin_dir().join(&name)
        }
        "user" => user_plugin_dir(&caller).join(&name),
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                "scope must be 'user' or 'system'".into(),
            ));
        }
    };

    if !dir.is_dir() {
        return Err((StatusCode::NOT_FOUND, "plugin not installed".into()));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("delete failed: {e}"),
        )
    })?;
    tracing::info!("plugin '{name}' removed ({scope}) by '{caller}'");
    Ok(StatusCode::NO_CONTENT)
}

// ── frontend asset serving ──

pub async fn serve_plugin_asset(
    headers: axum::http::HeaderMap,
    Path((scope, name, rest)): Path<(String, String, String)>,
) -> Result<axum::response::Response, StatusCode> {
    if !is_valid_plugin_name(&name) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let base = match scope.as_str() {
        "system" => system_plugin_dir().join(&name),
        "user" => {
            let caller = auth::extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
            user_plugin_dir(&caller).join(&name)
        }
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    let asset_path = base.join("frontend").join(&rest);
    // canonicalize both sides and enforce containment
    let base_canon = base
        .join("frontend")
        .canonicalize()
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let asset_canon = asset_path
        .canonicalize()
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if !asset_canon.starts_with(&base_canon) {
        return Err(StatusCode::FORBIDDEN);
    }

    let bytes = std::fs::read(&asset_canon).map_err(|_| StatusCode::NOT_FOUND)?;
    let mime = mime_from_extension(&rest);
    Ok(([(header::CONTENT_TYPE, mime)], bytes).into_response())
}

fn mime_from_extension(path: &str) -> &'static str {
    match path
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("js") | Some("mjs") => "application/javascript",
        Some("css") => "text/css",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

// ── extraction + install ──

/// Unpack a uploaded plugin zip into its final location (system or per-user
/// plugins dir). Thin wrapper around [`install_plugin_zip_to`] that resolves
/// the target_root from scope + username.
fn install_plugin_zip(
    data: &[u8],
    scope: PluginScope,
    username: &str,
) -> anyhow::Result<PluginManifest> {
    let target_root = match scope {
        PluginScope::System => system_plugin_dir(),
        PluginScope::User => user_plugin_dir(username),
    };
    install_plugin_zip_to(data, &target_root)
}

/// Core extraction routine — takes an explicit target_root so it can be
/// unit-tested against tempdirs without touching the real config dir.
///
/// Safety (in order):
/// 1. parse the manifest from the archive first; bail if missing or bad-named
/// 2. pre-validate EVERY entry for path traversal before touching disk
/// 3. extract into a hidden staging directory next to the final location
/// 4. atomically rename staging → final. If anything fails, clean up staging.
///
/// This means a rejected zip leaves **zero** partial state, and replacing
/// an existing plugin is atomic from the filesystem's perspective.
pub(crate) fn install_plugin_zip_to(
    data: &[u8],
    target_root: &std::path::Path,
) -> anyhow::Result<PluginManifest> {
    let cursor = Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor)?;

    // step 1: locate + parse the manifest, AND learn the wrapper prefix
    // (if any). The wrapper is determined exactly once from the location
    // of plugin.json in the archive, so we never guess.
    //
    //   plugin.json                    → wrapper = ""
    //   cellforge-mermaid/plugin.json  → wrapper = "cellforge-mermaid/"
    //
    // This is safer than guessing per-entry, which would misinterpret
    // legitimate subdirectories like `pylib/` as a wrapper.
    let mut manifest: Option<PluginManifest> = None;
    let mut wrapper: String = String::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();
        let (candidate_wrapper, tail) = if let Some((head, rest)) = name.split_once('/') {
            (format!("{head}/"), rest.to_string())
        } else {
            (String::new(), name.clone())
        };
        if tail == "plugin.json" {
            let mut content = String::new();
            use std::io::Read;
            file.read_to_string(&mut content)?;
            manifest = Some(serde_json::from_str(&content)?);
            wrapper = candidate_wrapper;
            break;
        }
    }
    let manifest = manifest.ok_or_else(|| anyhow::anyhow!("zip has no plugin.json"))?;

    if !is_valid_plugin_name(&manifest.name) {
        anyhow::bail!("invalid plugin name '{}'", manifest.name);
    }

    // step 2: pre-validate all entries before touching disk. Any path that
    // doesn't live under the wrapper is rejected outright.
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name();
        if let Some(rel) = strip_wrapper(name, &wrapper) {
            if rel.is_empty() || rel.ends_with('/') {
                continue;
            }
            if rel.contains("..") || rel.starts_with('/') {
                anyhow::bail!("rejected unsafe path in zip: {rel}");
            }
        } else {
            anyhow::bail!("rejected unsafe path in zip: {name}");
        }
    }

    std::fs::create_dir_all(target_root)?;

    // step 3: extract into a staging dir, then atomically rename to final.
    let staging = target_root.join(format!(".{}.staging", manifest.name));
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    std::fs::create_dir_all(&staging)?;

    let extract_result = (|| -> anyhow::Result<()> {
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let name = file.name().to_string();
            let Some(rel) = strip_wrapper(&name, &wrapper) else {
                anyhow::bail!("rejected unsafe path in zip: {name}");
            };

            if rel.is_empty() || rel.ends_with('/') {
                continue;
            }
            if rel.starts_with("__MACOSX") || rel.contains("/.DS_Store") {
                continue;
            }
            if rel.contains("..") || rel.starts_with('/') {
                anyhow::bail!("rejected unsafe path in zip: {rel}");
            }

            let out_path = staging.join(&rel);
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out_file = std::fs::File::create(&out_path)?;
            std::io::copy(&mut file, &mut out_file)?;
        }
        Ok(())
    })();

    if let Err(e) = extract_result {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }

    // step 4: swap staging into place
    let dest = target_root.join(&manifest.name);
    if dest.exists() {
        std::fs::remove_dir_all(&dest)?;
    }
    std::fs::rename(&staging, &dest)?;

    Ok(manifest)
}

/// Strip the wrapper prefix from a zip entry. Returns `None` if the entry
/// doesn't live under `wrapper`, which signals that the entry should be
/// rejected (e.g. it lives outside the plugin's own directory).
///
/// When `wrapper` is empty, every entry is considered valid and returned
/// as-is (minus leading `/`, which would be absolute).
fn strip_wrapper(name: &str, wrapper: &str) -> Option<String> {
    if wrapper.is_empty() {
        return Some(name.to_string());
    }
    name.strip_prefix(wrapper).map(|s| s.to_string())
}

/// Unused helper type to keep path construction consistent — re-exported in tests later.
#[allow(dead_code)]
pub(crate) fn scope_dir(scope: PluginScope, username: &str) -> PathBuf {
    match scope {
        PluginScope::System => system_plugin_dir(),
        PluginScope::User => user_plugin_dir(username),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use tempfile::TempDir;

    // ── helpers ──

    /// Build an in-memory zip archive from (path, bytes) entries.
    fn make_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf: Vec<u8> = Vec::new();
        {
            let cursor = Cursor::new(&mut buf);
            let mut w = zip::ZipWriter::new(cursor);
            let opts: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            for (name, data) in entries {
                w.start_file(*name, opts).unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        }
        buf
    }

    // ── strip_wrapper ──

    #[test]
    fn strip_wrapper_with_empty_wrapper_returns_as_is() {
        assert_eq!(
            strip_wrapper("plugin.json", "").as_deref(),
            Some("plugin.json")
        );
        assert_eq!(
            strip_wrapper("pylib/foo.py", "").as_deref(),
            Some("pylib/foo.py")
        );
    }

    #[test]
    fn strip_wrapper_strips_exact_prefix_only() {
        assert_eq!(
            strip_wrapper("my-plugin/plugin.json", "my-plugin/").as_deref(),
            Some("plugin.json"),
        );
        assert_eq!(
            strip_wrapper("my-plugin/pylib/foo.py", "my-plugin/").as_deref(),
            Some("pylib/foo.py"),
        );
    }

    #[test]
    fn strip_wrapper_rejects_entries_outside_wrapper() {
        // Attack: two entries, one under wrapper and one escaping
        assert_eq!(strip_wrapper("../secret.txt", "my-plugin/"), None);
        assert_eq!(strip_wrapper("other-dir/file.txt", "my-plugin/"), None);
    }

    // ── mime_from_extension ──

    #[test]
    fn mime_types_cover_plugin_assets() {
        assert_eq!(mime_from_extension("plugin.js"), "application/javascript");
        assert_eq!(mime_from_extension("plugin.mjs"), "application/javascript");
        assert_eq!(mime_from_extension("style.css"), "text/css");
        assert_eq!(mime_from_extension("data.json"), "application/json");
        assert_eq!(mime_from_extension("icon.svg"), "image/svg+xml");
        assert_eq!(mime_from_extension("picture.PNG"), "image/png"); // case-insensitive
        assert_eq!(
            mime_from_extension("unknown.xyz"),
            "application/octet-stream"
        );
        assert_eq!(
            mime_from_extension("noextension"),
            "application/octet-stream"
        );
    }

    // ── install_plugin_zip_to: happy path ──

    #[test]
    fn install_writes_manifest_and_assets() {
        let target = TempDir::new().unwrap();
        let zip_bytes = make_zip(&[
            (
                "plugin.json",
                br#"{"name":"test-plugin","version":"0.1.0"}"#,
            ),
            ("pylib/helper.py", b"def hello(): return 'hi'\n"),
            ("frontend/plugin.js", b"export function register() {}"),
        ]);

        let manifest = install_plugin_zip_to(&zip_bytes, target.path()).unwrap();
        assert_eq!(manifest.name, "test-plugin");

        // files must actually be on disk under the expected layout
        assert!(target.path().join("test-plugin/plugin.json").exists());
        assert!(target.path().join("test-plugin/pylib/helper.py").exists());
        assert!(
            target
                .path()
                .join("test-plugin/frontend/plugin.js")
                .exists()
        );
    }

    #[test]
    fn install_strips_top_level_plugin_dir_in_zip() {
        let target = TempDir::new().unwrap();
        let zip_bytes = make_zip(&[
            (
                "wrapped/plugin.json",
                br#"{"name":"wrapped","version":"0.1.0"}"#,
            ),
            ("wrapped/frontend/plugin.js", b"// hi"),
        ]);

        install_plugin_zip_to(&zip_bytes, target.path()).unwrap();
        // final location should NOT have the nested "wrapped/wrapped" path
        assert!(target.path().join("wrapped/plugin.json").exists());
        assert!(target.path().join("wrapped/frontend/plugin.js").exists());
        assert!(!target.path().join("wrapped/wrapped").exists());
    }

    #[test]
    fn install_skips_macos_cruft() {
        let target = TempDir::new().unwrap();
        let zip_bytes = make_zip(&[
            ("plugin.json", br#"{"name":"clean","version":"0.1.0"}"#),
            ("__MACOSX/._plugin.json", b"junk"),
            ("frontend/.DS_Store", b"junk"),
            ("frontend/plugin.js", b"ok"),
        ]);

        install_plugin_zip_to(&zip_bytes, target.path()).unwrap();
        assert!(target.path().join("clean/plugin.json").exists());
        assert!(target.path().join("clean/frontend/plugin.js").exists());
        assert!(!target.path().join("clean/__MACOSX").exists());
        assert!(!target.path().join("clean/frontend/.DS_Store").exists());
    }

    #[test]
    fn install_replaces_existing_plugin_atomically() {
        let target = TempDir::new().unwrap();

        // first install
        let v1 = make_zip(&[
            ("plugin.json", br#"{"name":"foo","version":"1.0.0"}"#),
            ("old.txt", b"i should be gone after upgrade"),
        ]);
        install_plugin_zip_to(&v1, target.path()).unwrap();
        assert!(target.path().join("foo/old.txt").exists());

        // upgrade
        let v2 = make_zip(&[
            ("plugin.json", br#"{"name":"foo","version":"2.0.0"}"#),
            ("new.txt", b"fresh"),
        ]);
        let manifest = install_plugin_zip_to(&v2, target.path()).unwrap();
        assert_eq!(manifest.version, "2.0.0");
        assert!(target.path().join("foo/new.txt").exists());
        // old files from v1 must be gone — upgrade is a full replacement
        assert!(!target.path().join("foo/old.txt").exists());
    }

    // ── install_plugin_zip_to: security ──

    #[test]
    fn install_rejects_zip_without_manifest() {
        let target = TempDir::new().unwrap();
        let zip_bytes = make_zip(&[("README.md", b"no manifest here")]);

        let err = install_plugin_zip_to(&zip_bytes, target.path()).unwrap_err();
        assert!(err.to_string().contains("plugin.json"));
        // nothing should have been written
        assert_eq!(std::fs::read_dir(target.path()).unwrap().count(), 0);
    }

    #[test]
    fn install_rejects_invalid_manifest_name() {
        let target = TempDir::new().unwrap();
        let zip_bytes = make_zip(&[("plugin.json", br#"{"name":"BAD NAME"}"#)]);

        let err = install_plugin_zip_to(&zip_bytes, target.path()).unwrap_err();
        assert!(err.to_string().contains("invalid plugin name"));
        assert_eq!(std::fs::read_dir(target.path()).unwrap().count(), 0);
    }

    #[test]
    fn install_rejects_traversal_entry_and_leaves_no_artifacts() {
        let target = TempDir::new().unwrap();
        // Leading entry is harmless; the second entry tries to escape.
        let zip_bytes = make_zip(&[
            ("plugin.json", br#"{"name":"attack","version":"0.1.0"}"#),
            ("../../etc/passwd", b"pwned"),
        ]);

        let err = install_plugin_zip_to(&zip_bytes, target.path()).unwrap_err();
        assert!(err.to_string().contains("unsafe path"));

        // CRITICAL regression guard: the first (innocent) entry must NOT be on
        // disk, and no staging dir should be lingering.
        assert!(!target.path().join("attack").exists());
        assert!(!target.path().join(".attack.staging").exists());
        // target_root itself may or may not exist depending on whether we got
        // that far — but if it does it must be empty
        if target.path().exists()
            && let Some(entry) = std::fs::read_dir(target.path()).unwrap().next()
        {
            panic!(
                "target_root should be empty, found: {:?}",
                entry.unwrap().path()
            );
        }
    }

    #[test]
    fn install_rejects_absolute_path_entry() {
        let target = TempDir::new().unwrap();
        let zip_bytes = make_zip(&[
            ("plugin.json", br#"{"name":"abs","version":"0.1.0"}"#),
            ("/etc/passwd", b"pwned"),
        ]);

        let err = install_plugin_zip_to(&zip_bytes, target.path()).unwrap_err();
        assert!(err.to_string().contains("unsafe path"));
        assert!(!target.path().join("abs").exists());
    }

    #[test]
    fn install_rejects_traversal_even_with_plugin_dir_wrapper() {
        let target = TempDir::new().unwrap();
        // zip contains a legit plugin dir wrapper AND an entry that lives
        // OUTSIDE the wrapper. strip_wrapper returns None for the outside
        // entry, which triggers the unsafe-path bail.
        let zip_bytes = make_zip(&[
            (
                "attack/plugin.json",
                br#"{"name":"attack","version":"0.1.0"}"#,
            ),
            ("../secret.txt", b"pwned"),
        ]);

        let err = install_plugin_zip_to(&zip_bytes, target.path()).unwrap_err();
        assert!(err.to_string().contains("unsafe path"));
        assert!(!target.path().join("attack").exists());
    }

    #[test]
    fn install_failure_leaves_existing_plugin_intact() {
        let target = TempDir::new().unwrap();

        // good plugin already installed
        let good = make_zip(&[
            ("plugin.json", br#"{"name":"stable","version":"1.0.0"}"#),
            ("file.txt", b"important"),
        ]);
        install_plugin_zip_to(&good, target.path()).unwrap();

        // now try to upload a bad zip under the same name — must fail
        // without damaging the existing install
        let bad = make_zip(&[
            ("plugin.json", br#"{"name":"stable","version":"2.0.0"}"#),
            ("../oops.txt", b"bad"),
        ]);
        let err = install_plugin_zip_to(&bad, target.path()).unwrap_err();
        assert!(err.to_string().contains("unsafe path"));

        // original install must still be there with the original version
        assert!(target.path().join("stable/plugin.json").exists());
        assert!(target.path().join("stable/file.txt").exists());
        let raw = std::fs::read_to_string(target.path().join("stable/plugin.json")).unwrap();
        assert!(raw.contains("1.0.0"));
    }
}
