//! Plugin subsystem.
//!
//! Plugins are directories on disk, either installed **system-wide**
//! (`~/.config/cellforge/plugins/`, admin-managed) or **per-user**
//! (`~/.config/cellforge/users/<name>/plugins/`, self-managed when allowed).
//!
//! A plugin directory contains:
//! ```text
//! <plugin-name>/
//!   plugin.json     — manifest (required)
//!   pylib/          — Python modules auto-added to kernel PYTHONPATH (optional)
//!   frontend/       — bundled ESM + CSS served over HTTP (optional)
//! ```
//!
//! The admin can toggle `allow_user_plugins` in the global settings; when
//! that flag is `false`, only admins can install plugins (system-wide only).

pub mod config;
pub mod manifest;
pub mod routes;
pub mod scanner;

pub use config::{PluginSettings, load_plugin_settings, save_plugin_settings};
#[allow(unused_imports)]
pub use manifest::ResolvedPlugin;
pub use manifest::{PluginManifest, PluginScope};
pub use scanner::scan_all_plugins;

use std::path::PathBuf;

/// Rebuild the merged per-user kernel pylib directory from every plugin
/// currently visible to `username` (system + user scope, user wins on conflict).
///
/// Returns the merged dir so it can be appended to the kernel's PYTHONPATH.
/// Safe to call on every kernel launch — it wipes and rewrites the contents
/// so deletes / version changes propagate without restarting the server.
pub fn rebuild_user_kernel_pylib(username: &str) -> PathBuf {
    let dir = user_kernel_pylib_dir(username);

    // wipe and recreate — cheap because plugin pylibs are small text files
    let _ = std::fs::remove_dir_all(&dir);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        tracing::warn!("could not create kernel pylib dir {}: {e}", dir.display());
        return dir;
    }

    let plugins = scan_all_plugins(Some(username));
    for plugin in plugins.values() {
        let src = plugin.pylib_dir();
        if !src.is_dir() {
            continue;
        }
        if let Err(e) = copy_dir_recursive(&src, &dir) {
            tracing::warn!("copy plugin pylib {}: {e}", src.display());
        }
    }

    dir
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            std::fs::create_dir_all(&to)?;
            copy_dir_recursive(&from, &to)?;
        } else if file_type.is_file() {
            std::fs::copy(&from, &to)?;
        }
        // symlinks skipped on purpose — plugin sandbox discipline
    }
    Ok(())
}

/// Root directory for system-wide plugins (admin-installed).
pub fn system_plugin_dir() -> PathBuf {
    data_dir().join("plugins")
}

/// Root directory for a given user's personal plugins.
pub fn user_plugin_dir(username: &str) -> PathBuf {
    data_dir().join("users").join(username).join("plugins")
}

/// Root directory for the merged kernel pylib (built-ins + enabled plugins),
/// one per user so plugin resolution stays isolated between accounts.
pub fn user_kernel_pylib_dir(username: &str) -> PathBuf {
    data_dir().join("users").join(username).join("kernel-pylib")
}

/// `~/.config/cellforge/` — same root used by auth, templates, pylib.
pub fn data_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".config"))
        .join("cellforge")
}
