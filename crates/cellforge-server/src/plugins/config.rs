//! Global plugin settings — persisted as JSON at `~/.config/cellforge/settings.json`.
//!
//! Today this file only holds `allow_user_plugins`, but it's a natural place
//! to add more global knobs later (rate limits, plugin size caps, etc.).

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::data_dir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSettings {
    /// When false, non-admin users cannot install plugins at all — only
    /// admins can install system-wide plugins.
    #[serde(default = "default_allow_user_plugins")]
    pub allow_user_plugins: bool,
}

impl Default for PluginSettings {
    fn default() -> Self {
        Self {
            allow_user_plugins: default_allow_user_plugins(),
        }
    }
}

fn default_allow_user_plugins() -> bool {
    true
}

fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

/// Load plugin settings from disk. Returns defaults if the file doesn't
/// exist yet (first run) or can't be parsed.
pub fn load_plugin_settings() -> PluginSettings {
    let path = settings_path();
    match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<PluginSettings>(&text) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("failed to parse settings.json: {e} — using defaults");
                PluginSettings::default()
            }
        },
        Err(_) => {
            // first run: seed the file so the user can find and edit it
            let defaults = PluginSettings::default();
            let _ = save_plugin_settings(&defaults);
            defaults
        }
    }
}

/// Persist plugin settings to disk. Creates the parent directory if needed.
pub fn save_plugin_settings(settings: &PluginSettings) -> Result<()> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(settings)?;
    std::fs::write(&path, text)?;
    Ok(())
}
