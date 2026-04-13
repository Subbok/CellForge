//! Scan plugin directories and resolve a merged view.

use super::manifest::{PluginManifest, PluginScope, ResolvedPlugin, is_valid_plugin_name};
use super::{system_plugin_dir, user_plugin_dir};
use std::collections::HashMap;
use std::path::Path;

/// Scan both the system plugin dir and the given user's plugin dir.
///
/// Returns a map `name -> ResolvedPlugin`. When a name collides, the
/// **user-scoped** plugin wins for that user — mirrors the dotfile
/// override pattern (user config shadows system config).
///
/// Plugins with invalid names or unparseable manifests are skipped and
/// logged, not fatal — one bad plugin shouldn't nuke the whole registry.
pub fn scan_all_plugins(username: Option<&str>) -> HashMap<String, ResolvedPlugin> {
    let system = system_plugin_dir();
    let user = username.map(user_plugin_dir);
    scan_all_plugins_in(&system, user.as_deref())
}

/// Same as [`scan_all_plugins`] but with explicit directory paths. Used by
/// tests so we can build isolated plugin trees in tempdirs.
pub fn scan_all_plugins_in(
    system_dir: &Path,
    user_dir: Option<&Path>,
) -> HashMap<String, ResolvedPlugin> {
    let mut out: HashMap<String, ResolvedPlugin> = HashMap::new();

    for plugin in scan_dir(system_dir, PluginScope::System) {
        out.insert(plugin.manifest.name.clone(), plugin);
    }

    if let Some(user) = user_dir {
        for plugin in scan_dir(user, PluginScope::User) {
            out.insert(plugin.manifest.name.clone(), plugin);
        }
    }

    out
}

/// Walk a single plugin root dir and return every plugin we can parse.
fn scan_dir(root: &Path, scope: PluginScope) -> Vec<ResolvedPlugin> {
    let mut out = Vec::new();

    let Ok(entries) = std::fs::read_dir(root) else {
        // missing dir is fine, just return empty
        return out;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let dir_name = match entry.file_name().to_str().map(|s| s.to_string()) {
            Some(n) => n,
            None => continue,
        };

        // enforce the same name rules on the directory as on the manifest —
        // prevents "../../etc" and friends from sneaking in
        if !is_valid_plugin_name(&dir_name) {
            tracing::warn!("plugin scanner: skipping invalid dir name '{dir_name}'");
            continue;
        }

        let manifest_path = path.join("plugin.json");
        if !manifest_path.exists() {
            continue;
        }

        let text = match std::fs::read_to_string(&manifest_path) {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!(
                    "plugin scanner: can't read {}: {e}",
                    manifest_path.display()
                );
                continue;
            }
        };

        let manifest: PluginManifest = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!(
                    "plugin scanner: bad manifest at {}: {e}",
                    manifest_path.display()
                );
                continue;
            }
        };

        // cross-check: manifest.name must match its on-disk directory name
        if !is_valid_plugin_name(&manifest.name) {
            tracing::warn!("plugin scanner: invalid manifest name '{}'", manifest.name);
            continue;
        }
        if manifest.name != dir_name {
            tracing::warn!(
                "plugin scanner: manifest name '{}' doesn't match dir '{}' — skipping",
                manifest.name,
                dir_name,
            );
            continue;
        }

        out.push(ResolvedPlugin {
            manifest,
            scope,
            root: path,
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Write a plugin to `<root>/<dir_name>/plugin.json` with the given manifest.
    fn write_plugin(root: &Path, dir_name: &str, manifest_json: &str) {
        let dir = root.join(dir_name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("plugin.json"), manifest_json).unwrap();
    }

    #[test]
    fn scan_empty_dir_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let plugins = scan_all_plugins_in(tmp.path(), None);
        assert!(plugins.is_empty());
    }

    #[test]
    fn scan_missing_dir_is_not_an_error() {
        // Neither dir exists — must degrade to empty, not panic.
        let tmp = TempDir::new().unwrap();
        let nope = tmp.path().join("does-not-exist");
        let plugins = scan_all_plugins_in(&nope, Some(&nope));
        assert!(plugins.is_empty());
    }

    #[test]
    fn scan_reads_single_system_plugin() {
        let sys = TempDir::new().unwrap();
        write_plugin(sys.path(), "foo", r#"{"name":"foo","version":"0.1.0"}"#);

        let plugins = scan_all_plugins_in(sys.path(), None);
        assert_eq!(plugins.len(), 1);
        let p = plugins.get("foo").expect("foo not found");
        assert_eq!(p.scope, PluginScope::System);
        assert_eq!(p.manifest.version, "0.1.0");
    }

    #[test]
    fn scan_user_plugin_overrides_system_on_name_collision() {
        let sys = TempDir::new().unwrap();
        let usr = TempDir::new().unwrap();
        write_plugin(
            sys.path(),
            "foo",
            r#"{"name":"foo","version":"0.1.0-system"}"#,
        );
        write_plugin(
            usr.path(),
            "foo",
            r#"{"name":"foo","version":"0.2.0-user"}"#,
        );

        let plugins = scan_all_plugins_in(sys.path(), Some(usr.path()));
        let foo = plugins.get("foo").unwrap();
        assert_eq!(foo.scope, PluginScope::User);
        assert_eq!(foo.manifest.version, "0.2.0-user");
    }

    #[test]
    fn scan_merges_distinct_plugins_from_both_scopes() {
        let sys = TempDir::new().unwrap();
        let usr = TempDir::new().unwrap();
        write_plugin(sys.path(), "one", r#"{"name":"one"}"#);
        write_plugin(usr.path(), "two", r#"{"name":"two"}"#);

        let plugins = scan_all_plugins_in(sys.path(), Some(usr.path()));
        assert_eq!(plugins.len(), 2);
        assert_eq!(plugins.get("one").unwrap().scope, PluginScope::System);
        assert_eq!(plugins.get("two").unwrap().scope, PluginScope::User);
    }

    #[test]
    fn scan_skips_plugin_with_mismatched_manifest_name() {
        let sys = TempDir::new().unwrap();
        // directory is "foo" but manifest claims to be "bar"
        write_plugin(sys.path(), "foo", r#"{"name":"bar"}"#);

        let plugins = scan_all_plugins_in(sys.path(), None);
        assert!(
            plugins.is_empty(),
            "mismatched plugin should have been skipped"
        );
    }

    #[test]
    fn scan_skips_plugin_with_invalid_dir_name() {
        let sys = TempDir::new().unwrap();
        // uppercase dir name = invalid, scanner refuses to even read manifest
        std::fs::create_dir_all(sys.path().join("BadName")).unwrap();
        std::fs::write(
            sys.path().join("BadName/plugin.json"),
            r#"{"name":"BadName"}"#,
        )
        .unwrap();

        let plugins = scan_all_plugins_in(sys.path(), None);
        assert!(plugins.is_empty());
    }

    #[test]
    fn scan_skips_plugin_with_unparseable_manifest() {
        let sys = TempDir::new().unwrap();
        write_plugin(sys.path(), "broken", "this is not json");
        // a valid sibling still gets picked up
        write_plugin(sys.path(), "working", r#"{"name":"working"}"#);

        let plugins = scan_all_plugins_in(sys.path(), None);
        assert_eq!(plugins.len(), 1);
        assert!(plugins.contains_key("working"));
        assert!(!plugins.contains_key("broken"));
    }

    #[test]
    fn scan_skips_dir_without_manifest() {
        let sys = TempDir::new().unwrap();
        // random file, no plugin.json
        std::fs::create_dir_all(sys.path().join("foo")).unwrap();
        std::fs::write(sys.path().join("foo/README.md"), "hi").unwrap();

        let plugins = scan_all_plugins_in(sys.path(), None);
        assert!(plugins.is_empty());
    }
}
