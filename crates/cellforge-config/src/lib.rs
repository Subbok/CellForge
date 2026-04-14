//! Centralized config path helpers for CellForge.
//!
//! All paths derive from a single root:
//! - Linux: `$XDG_CONFIG_HOME/cellforge/` (default `~/.config/cellforge/`)
//! - macOS: `~/Library/Application Support/cellforge/`
//! - Windows: `%APPDATA%\cellforge\`

use std::path::PathBuf;

/// Root config directory — `~/.config/cellforge/` on Linux.
pub fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".config"))
        .join("cellforge")
}

/// `<config>/users/` — per-user data root.
pub fn users_dir() -> PathBuf {
    config_dir().join("users")
}

/// `<config>/users/<username>/notebooks/` — user workspace.
pub fn user_workspace_dir(username: &str) -> PathBuf {
    users_dir().join(username).join("notebooks")
}

/// `<config>/users/<username>/plugins/` — per-user plugins.
pub fn user_plugins_dir(username: &str) -> PathBuf {
    users_dir().join(username).join("plugins")
}

/// `<config>/users/<username>/kernel-pylib/` — merged kernel pylib.
pub fn user_kernel_pylib_dir(username: &str) -> PathBuf {
    users_dir().join(username).join("kernel-pylib")
}

/// `<config>/templates/` — Typst export templates.
pub fn templates_dir() -> PathBuf {
    config_dir().join("templates")
}

/// `<config>/plugins/` — system-wide (admin-managed) plugins.
pub fn plugins_dir() -> PathBuf {
    config_dir().join("plugins")
}

/// `<config>/pylib/` — built-in Python modules.
pub fn pylib_dir() -> PathBuf {
    config_dir().join("pylib")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_dir_ends_with_cellforge() {
        let dir = config_dir();
        assert_eq!(dir.file_name().unwrap(), "cellforge");
    }

    #[test]
    fn user_workspace_dir_structure() {
        let dir = user_workspace_dir("alice");
        assert!(dir.ends_with("users/alice/notebooks"));
    }

    #[test]
    fn templates_dir_under_config() {
        let dir = templates_dir();
        assert!(dir.starts_with(config_dir()));
        assert!(dir.ends_with("templates"));
    }

    #[test]
    fn plugins_dir_under_config() {
        let dir = plugins_dir();
        assert!(dir.starts_with(config_dir()));
        assert!(dir.ends_with("plugins"));
    }
}
