//! Plugin manifest format and validation.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// The `plugin.json` file at the root of every plugin directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    /// Unique plugin id — lowercase alphanumerics and dashes only.
    /// Used as the on-disk directory name and as a key for merging/overrides.
    pub name: String,

    /// Semver or free-form version string. Informational for the UI.
    #[serde(default)]
    pub version: String,

    /// Human-readable name shown in Settings → Plugins.
    #[serde(default)]
    pub display_name: Option<String>,

    /// One-line description.
    #[serde(default)]
    pub description: Option<String>,

    /// Author display string.
    #[serde(default)]
    pub author: Option<String>,

    /// Everything the plugin brings to the table.
    #[serde(default)]
    pub contributes: PluginContributes,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginContributes {
    #[serde(default)]
    pub themes: Vec<ThemeContribution>,
    #[serde(default)]
    pub widgets: Vec<WidgetContribution>,
    #[serde(default)]
    pub pylib: Vec<String>,
    #[serde(default)]
    pub toolbar_buttons: Vec<serde_json::Value>,
    #[serde(default)]
    pub sidebar_panels: Vec<serde_json::Value>,
    #[serde(default)]
    pub cell_actions: Vec<serde_json::Value>,
    #[serde(default)]
    pub keybindings: Vec<serde_json::Value>,
    #[serde(default)]
    pub export_formats: Vec<serde_json::Value>,
    #[serde(default)]
    pub status_bar_items: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeContribution {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    /// Map of CSS variable name → value. e.g. "--color-accent" → "#ff6600".
    #[serde(default)]
    pub vars: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetContribution {
    /// Custom element tag name. Must start with a letter and contain a dash
    /// (Web Components spec requirement).
    pub tag_name: String,
    /// Path to the ESM bundle inside the plugin's frontend/ directory.
    pub module: String,
    /// Whether this widget has a value that syncs back to Python (input) or
    /// is one-way render-only output.
    #[serde(default)]
    pub stateful: bool,
}

/// Where a plugin was installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginScope {
    System,
    User,
}

/// A scanned, validated plugin on disk.
#[derive(Debug, Clone, Serialize)]
pub struct ResolvedPlugin {
    pub manifest: PluginManifest,
    pub scope: PluginScope,
    /// Absolute path to the plugin directory.
    #[serde(skip)]
    pub root: PathBuf,
}

impl ResolvedPlugin {
    pub fn pylib_dir(&self) -> PathBuf {
        self.root.join("pylib")
    }
    #[allow(dead_code)] // used by plugin routes for asset serving via explicit path building
    pub fn frontend_dir(&self) -> PathBuf {
        self.root.join("frontend")
    }
}

/// Regex-free name validation: lowercase letters, digits, dashes.
/// Refuses empty names, leading/trailing dashes, and anything that could
/// be a path component traversal attempt.
pub fn is_valid_plugin_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 {
        return false;
    }
    if name.starts_with('-') || name.ends_with('-') {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_names() {
        assert!(is_valid_plugin_name("foo"));
        assert!(is_valid_plugin_name("foo-bar"));
        assert!(is_valid_plugin_name("a1b2"));
        assert!(is_valid_plugin_name("solarized-dark"));
        assert!(is_valid_plugin_name("cellforge-mermaid-v2"));
        assert!(is_valid_plugin_name("z"));
        // 64 chars exactly — the upper bound
        assert!(is_valid_plugin_name(&"a".repeat(64)));
    }

    #[test]
    fn invalid_names() {
        // empty
        assert!(!is_valid_plugin_name(""));
        // leading / trailing dash
        assert!(!is_valid_plugin_name("-foo"));
        assert!(!is_valid_plugin_name("foo-"));
        assert!(!is_valid_plugin_name("-"));
        // uppercase
        assert!(!is_valid_plugin_name("Foo"));
        assert!(!is_valid_plugin_name("SOLARIZED"));
        // underscores and spaces not allowed
        assert!(!is_valid_plugin_name("foo_bar"));
        assert!(!is_valid_plugin_name("foo bar"));
        // traversal attempts
        assert!(!is_valid_plugin_name(".."));
        assert!(!is_valid_plugin_name("../etc"));
        assert!(!is_valid_plugin_name("./foo"));
        // path separators
        assert!(!is_valid_plugin_name("foo/bar"));
        assert!(!is_valid_plugin_name("foo\\bar"));
        // over the length cap
        assert!(!is_valid_plugin_name(&"a".repeat(65)));
    }

    #[test]
    fn manifest_parses_minimal_json() {
        let json = r#"{"name": "foo"}"#;
        let m: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.name, "foo");
        assert_eq!(m.version, "");
        assert!(m.display_name.is_none());
        assert!(m.contributes.themes.is_empty());
    }

    #[test]
    fn manifest_parses_full_json() {
        let json = r##"{
            "name": "cellforge-mermaid",
            "version": "0.2.1",
            "display_name": "Mermaid",
            "description": "Render mermaid diagrams",
            "author": "someone",
            "contributes": {
                "themes": [
                    {"id": "warm", "name": "Warm", "vars": {"--color-accent": "#ff6600"}}
                ],
                "widgets": [
                    {"tag_name": "cellforge-mermaid", "module": "frontend/plugin.js", "stateful": false}
                ],
                "pylib": ["mermaid.py"]
            }
        }"##;
        let m: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.name, "cellforge-mermaid");
        assert_eq!(m.version, "0.2.1");
        assert_eq!(m.author.as_deref(), Some("someone"));
        assert_eq!(m.contributes.themes.len(), 1);
        assert_eq!(m.contributes.themes[0].id, "warm");
        assert_eq!(
            m.contributes.themes[0]
                .vars
                .get("--color-accent")
                .map(String::as_str),
            Some("#ff6600"),
        );
        assert_eq!(m.contributes.widgets.len(), 1);
        assert_eq!(m.contributes.widgets[0].tag_name, "cellforge-mermaid");
        assert_eq!(m.contributes.pylib, vec!["mermaid.py"]);
    }

    #[test]
    fn manifest_missing_name_field_fails() {
        let json = r#"{"version": "1.0"}"#;
        assert!(serde_json::from_str::<PluginManifest>(json).is_err());
    }

    #[test]
    fn plugin_scope_serde_lowercase() {
        let s: PluginScope = serde_json::from_str("\"system\"").unwrap();
        assert_eq!(s, PluginScope::System);
        let u: PluginScope = serde_json::from_str("\"user\"").unwrap();
        assert_eq!(u, PluginScope::User);
        assert!(serde_json::from_str::<PluginScope>("\"System\"").is_err());
    }
}
