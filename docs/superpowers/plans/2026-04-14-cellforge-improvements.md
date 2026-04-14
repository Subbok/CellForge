# CellForge v0.4 Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a batch of improvements: centralize config paths, add SQLite migrations, add health endpoint, clean up BlissLab remnants, create a desktop app wrapper, add i18n with Polish translation, fix docs, and update the release workflow.

**Architecture:** The backend is a Rust workspace (Axum HTTP server) with 7 crates. Frontend is React 19 + TypeScript + Vite + Tailwind v4. A new `cellforge-config` crate will replace all duplicated `data_dir()` helpers. A new `cellforge-app` crate wraps the server in a native window via wry/tao. Frontend gets i18next for translations.

**Tech Stack:** Rust 2024 / Axum 0.8 / rusqlite 0.39 / wry 0.47 / tao 0.30 / React 19 / TypeScript 6 / i18next / react-i18next

---

## File Map

### New files
- `crates/cellforge-config/Cargo.toml`
- `crates/cellforge-config/src/lib.rs`
- `crates/cellforge-app/Cargo.toml`
- `crates/cellforge-app/src/main.rs`
- `frontend/src/lib/i18n.ts`
- `frontend/src/locales/en.json`
- `frontend/src/locales/pl.json`
- `examples/plugins/cellforge-demo/plugin.json`
- `examples/plugins/cellforge-demo/frontend/plugin.js`
- `examples/plugins/cellforge-demo/pylib/cellforge_demo.py`
- `examples/plugins/cellforge-mermaid/plugin.json`
- `examples/plugins/cellforge-mermaid/frontend/plugin.js`
- `examples/plugins/cellforge-mermaid/pylib/cellforge_mermaid.py`

### Modified files
- `Cargo.toml` (workspace members)
- `.gitignore`
- `crates/cellforge-auth/Cargo.toml`
- `crates/cellforge-auth/src/db.rs`
- `crates/cellforge-auth/src/jwt.rs`
- `crates/cellforge-kernel/Cargo.toml`
- `crates/cellforge-kernel/src/launcher.rs`
- `crates/cellforge-export/Cargo.toml`
- `crates/cellforge-export/src/templates.rs`
- `crates/cellforge-export/src/compile.rs`
- `crates/cellforge-server/Cargo.toml`
- `crates/cellforge-server/src/main.rs`
- `crates/cellforge-server/src/plugins/mod.rs`
- `crates/cellforge-server/src/plugins/manifest.rs`
- `crates/cellforge-server/src/plugins/routes.rs`
- `crates/cellforge-varexplorer/src/introspect.rs`
- `crates/cellforge-varexplorer/src/introspect_r.rs`
- `crates/cellforge-varexplorer/src/introspect_julia.rs`
- `frontend/src/services/formatCode.ts`
- `frontend/src/services/exportHtml.ts`
- `frontend/src/plugins/builtins.ts`
- `frontend/src/main.tsx`
- `frontend/src/App.tsx`
- `frontend/src/stores/uiStore.ts`
- `frontend/src/components/LoginPage.tsx`
- `frontend/src/components/HomeDashboard.tsx`
- `frontend/src/components/Settings.tsx`
- `frontend/src/components/SaveModal.tsx`
- `frontend/src/components/KernelPicker.tsx`
- `frontend/src/components/ExportModal.tsx`
- `frontend/src/components/ShortcutHelp.tsx`
- `frontend/src/components/Dashboard.tsx`
- `frontend/src/components/AdminPanel.tsx`
- `frontend/src/components/UpdateNotice.tsx`
- `frontend/src/components/ErrorBoundary.tsx`
- `frontend/src/components/ModalDialog.tsx`
- `frontend/src/components/layout/StatusBar.tsx`
- `frontend/src/components/sidebar/VariableExplorer.tsx`
- `frontend/package.json`
- `docs/Build in liblary.md` (rename to `docs/Built-in Library.md`)
- `docs/writing plugins.md`
- `docs/writing templates.md`
- `.github/workflows/release.yml`

### Deleted files
- `examples/plugins/bliss-demo/` (entire directory)
- `examples/plugins/bliss-mermaid/` (entire directory)

---

## Task 1: Quick fixes — .gitignore and GET /health

**Files:**
- Modify: `.gitignore`
- Modify: `crates/cellforge-server/src/main.rs`

- [ ] **Step 1: Add `__pycache__` to .gitignore**

Add this line to `.gitignore` after the `# Debug` section:

```
# Python
__pycache__/
*.pyc
```

- [ ] **Step 2: Add GET /health endpoint**

In `crates/cellforge-server/src/main.rs`, add a handler function after the `CURRENT_VERSION` const (line 279):

```rust
async fn health_handler() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "version": CURRENT_VERSION,
    }))
}
```

Then add the route to the `api` router, right after the `.route("/auth/status", ...)` line (line 100). Add it BEFORE the auth routes since it needs no auth:

```rust
        .route("/health", get(health_handler))
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check -p cellforge-server`
Expected: success with no errors

- [ ] **Step 4: Commit**

```bash
git add .gitignore crates/cellforge-server/src/main.rs
git commit -m "feat: add GET /health endpoint, add __pycache__ to .gitignore"
```

---

## Task 2: BlissLab remnants cleanup — varexplorer

**Files:**
- Modify: `crates/cellforge-varexplorer/src/introspect.rs`
- Modify: `crates/cellforge-varexplorer/src/introspect_r.rs`
- Modify: `crates/cellforge-varexplorer/src/introspect_julia.rs`

These files contain Python/R/Julia code that runs inside the kernel. Variable prefixes `__bliss_` must be renamed to `__cf_` (short, avoids namespace collisions).

- [ ] **Step 1: Rename Python introspection prefixes**

In `crates/cellforge-varexplorer/src/introspect.rs`, do a global find-and-replace:
- `__bliss_` → `__cf_`

The comment on line 6 should change from:
```
/// We prefix everything with __bliss_ to avoid polluting the user's namespace,
```
to:
```
/// We prefix everything with __cf_ to avoid polluting the user's namespace,
```

- [ ] **Step 2: Rename R introspection prefixes**

In `crates/cellforge-varexplorer/src/introspect_r.rs`, do a global find-and-replace:
- `.bliss_` → `.cf_`

- [ ] **Step 3: Rename Julia introspection prefixes**

In `crates/cellforge-varexplorer/src/introspect_julia.rs`, do a global find-and-replace:
- `_bliss_` → `_cf_`

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p cellforge-varexplorer`
Expected: success

- [ ] **Step 5: Commit**

```bash
git add crates/cellforge-varexplorer/
git commit -m "fix: rename bliss variable prefixes to cf in introspection scripts"
```

---

## Task 3: BlissLab remnants cleanup — frontend services

**Files:**
- Modify: `frontend/src/services/formatCode.ts`
- Modify: `frontend/src/services/exportHtml.ts`
- Modify: `frontend/src/plugins/builtins.ts`

- [ ] **Step 1: Rename formatCode.ts prefixes**

In `frontend/src/services/formatCode.ts`, do global find-and-replace:
- `__bliss_fmt:` → `__cf_fmt:`
- `__bliss_code` → `__cf_code`
- `__bliss_r` → `__cf_r`

- [ ] **Step 2: Rename exportHtml.ts selectors**

In `frontend/src/services/exportHtml.ts`, do global find-and-replace:
- `bliss-mermaid` → `cf-mermaid`

- [ ] **Step 3: Rename builtins.ts references**

In `frontend/src/plugins/builtins.ts`:
- Change the comment `// ── Viz helpers (bliss_mo) ──` to `// ── Viz helpers ──`
- Change `` `bliss-mermaid-${++mermaidCounter}` `` to `` `cf-mermaid-${++mermaidCounter}` ``
- Change `// bliss_mo visualizations` to `// CellForge visualizations`
- Change `Unknown bliss_mo kind` to `Unknown viz kind`

- [ ] **Step 4: Verify frontend type-checks**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: success

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/formatCode.ts frontend/src/services/exportHtml.ts frontend/src/plugins/builtins.ts
git commit -m "fix: rename bliss references to cf/cellforge in frontend"
```

---

## Task 4: BlissLab remnants cleanup — backend comments and tests

**Files:**
- Modify: `crates/cellforge-kernel/src/launcher.rs`
- Modify: `crates/cellforge-export/src/compile.rs`
- Modify: `crates/cellforge-server/src/plugins/manifest.rs`
- Modify: `crates/cellforge-server/src/plugins/routes.rs`

- [ ] **Step 1: Fix launcher.rs comment**

In `crates/cellforge-kernel/src/launcher.rs:12`, change:
```rust
/// exposed via PYTHONPATH so `import cellforge_ui` / `import bliss_mermaid`
```
to:
```rust
/// exposed via PYTHONPATH so `import cellforge_ui` / `import cellforge_mermaid`
```

- [ ] **Step 2: Fix compile.rs test function names**

In `crates/cellforge-export/src/compile.rs`, rename:
- `fn bliss_world_missing_file_returns_not_found()` → `fn cf_world_missing_file_returns_not_found()`
- `fn bliss_world_source_returns_main()` → `fn cf_world_source_returns_main()`

- [ ] **Step 3: Fix manifest.rs test data**

In `crates/cellforge-server/src/plugins/manifest.rs`, update test data:
- Change `"bliss-mermaid"` → `"cellforge-mermaid"` in test assertions and JSON literals (lines 131, 175, 185, 191, 204)
- Keep the `is_valid_plugin_name` test input — it's testing the name validation logic, the actual string doesn't matter for that test, but for consistency change `"bliss-mermaid-v2"` → `"cellforge-mermaid-v2"`

- [ ] **Step 4: Fix routes.rs comment**

In `crates/cellforge-server/src/plugins/routes.rs:302`, change:
```rust
//   bliss-mermaid/plugin.json      → wrapper = "bliss-mermaid/"
```
to:
```rust
//   cellforge-mermaid/plugin.json  → wrapper = "cellforge-mermaid/"
```

- [ ] **Step 5: Verify all tests pass**

Run: `cargo test --workspace`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add crates/cellforge-kernel/src/launcher.rs crates/cellforge-export/src/compile.rs crates/cellforge-server/src/plugins/
git commit -m "fix: rename remaining bliss references in backend comments and tests"
```

---

## Task 5: Rename example plugins

**Files:**
- Delete: `examples/plugins/bliss-demo/`
- Delete: `examples/plugins/bliss-mermaid/`
- Create: `examples/plugins/cellforge-demo/`
- Create: `examples/plugins/cellforge-mermaid/`

- [ ] **Step 1: Rename bliss-demo → cellforge-demo**

```bash
cd /home/suddoku/Documents/CellForge
cp -r examples/plugins/bliss-demo examples/plugins/cellforge-demo
rm -rf examples/plugins/bliss-demo
```

In `examples/plugins/cellforge-demo/plugin.json`: replace all `bliss-demo` → `cellforge-demo`, `bliss_demo` → `cellforge_demo`.

Rename `examples/plugins/cellforge-demo/pylib/bliss_demo.py` → `cellforge_demo.py`. Inside it, replace `bliss_demo` → `cellforge_demo` and `bliss-demo` → `cellforge-demo`.

In `examples/plugins/cellforge-demo/frontend/plugin.js`: replace all `bliss-demo` → `cellforge-demo`.

- [ ] **Step 2: Rename bliss-mermaid → cellforge-mermaid**

```bash
cp -r examples/plugins/bliss-mermaid examples/plugins/cellforge-mermaid
rm -rf examples/plugins/bliss-mermaid
```

In `examples/plugins/cellforge-mermaid/plugin.json`: replace all `bliss-mermaid` → `cellforge-mermaid`, `bliss_mermaid` → `cellforge_mermaid`.

Rename `examples/plugins/cellforge-mermaid/pylib/bliss_mermaid.py` → `cellforge_mermaid.py`. Inside it, replace `bliss_mermaid` → `cellforge_mermaid`.

In `examples/plugins/cellforge-mermaid/frontend/plugin.js`: replace `bliss-mermaid` → `cellforge-mermaid`.

- [ ] **Step 3: Verify no bliss remnants remain**

Run: `grep -r "bliss\|BlissLab" --include='*.rs' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.py' --include='*.js' --include='*.md' . | grep -v target/ | grep -v node_modules/ | grep -v '.git/'`

Expected: no output (zero matches)

- [ ] **Step 4: Commit**

```bash
git add examples/plugins/ crates/ frontend/
git commit -m "fix: complete BlissLab → CellForge rebrand in all source files"
```

---

## Task 6: Doc fixes

**Files:**
- Rename: `docs/Build in liblary.md` → `docs/Built-in Library.md`
- Modify: `docs/writing plugins.md`
- Modify: `docs/writing templates.md`

- [ ] **Step 1: Fix filename typo**

```bash
cd /home/suddoku/Documents/CellForge
mv "docs/Build in liblary.md" "docs/Built-in Library.md"
```

- [ ] **Step 2: Fix broken link in writing plugins.md**

In `docs/writing plugins.md`, line 55 has:
```markdown
See [Writing Themes](Writing-Themes.md) for full details.
```
Change to:
```markdown
See [Writing Themes](writing%20themes.md) for full details.
```

- [ ] **Step 3: Add plugin update behavior to writing plugins.md**

After the "Plugin pylib injection" section (before "## Tips"), add:

```markdown
## Updating plugins

When you upload a newer version of an installed plugin (e.g. 1.0.0 → 2.0.0),
CellForge replaces the existing plugin directory atomically:

1. The new ZIP is extracted to a staging directory
2. The manifest is validated (name must match the existing plugin)
3. The old plugin directory is removed
4. The staging directory is renamed into place

If extraction or validation fails, the old version stays intact — no
partial upgrades.

**Reload required:** After updating a plugin that has frontend
contributions, refresh the page to load the new JavaScript module.
Python modules (`pylib`) are re-synced on the next kernel launch.

## Plugin crash behavior

If a plugin's JavaScript module throws an error during `register()`:

- The error is logged to the browser console with `[plugins]` prefix
- The plugin's contributions are skipped (no toolbar buttons, no
  sidebar panels, etc. from that plugin)
- All other plugins and the rest of CellForge continue to work normally
- The plugin still appears in Settings → Plugins so it can be removed

A crashing plugin cannot break the notebook editor or other plugins.
```

- [ ] **Step 4: Document asset dropdown variable type in writing templates.md**

After the "Variables" section, add:

```markdown
### Asset variables

If a template variable name contains `logo`, `image`, or `asset`,
the export dialog renders a file picker (dropdown of images uploaded as
template assets) instead of a plain text field. The variable value is
set to the selected filename (e.g. `"logo.png"`).

```typst
#let config = (
  logo: "",        // ← shows file picker in export dialog
  author: "",      // ← shows text input
)

#if config.logo != "" {
  #image(config.logo, height: 2cm)
}
```
```

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs: fix filename typo, broken link, add plugin update/crash docs, asset variable docs"
```

---

## Task 7: New crate — cellforge-config

**Files:**
- Create: `crates/cellforge-config/Cargo.toml`
- Create: `crates/cellforge-config/src/lib.rs`
- Modify: `Cargo.toml` (workspace)

- [ ] **Step 1: Create the crate**

Create `crates/cellforge-config/Cargo.toml`:

```toml
[package]
name = "cellforge-config"
version.workspace = true
edition.workspace = true

[dependencies]
dirs = "6"
```

Create `crates/cellforge-config/src/lib.rs`:

```rust
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
```

- [ ] **Step 2: Add to workspace**

In the root `Cargo.toml`, add `"crates/cellforge-config"` to the `members` list:

```toml
members = [
    "crates/cellforge-config",
    "crates/cellforge-server",
    ...
]
```

- [ ] **Step 3: Verify it compiles and tests pass**

Run: `cargo test -p cellforge-config`
Expected: 4 tests pass

- [ ] **Step 4: Commit**

```bash
git add Cargo.toml crates/cellforge-config/
git commit -m "feat: add cellforge-config crate for centralized path helpers"
```

---

## Task 8: Migrate all crates to cellforge-config

**Files:**
- Modify: `crates/cellforge-auth/Cargo.toml`
- Modify: `crates/cellforge-auth/src/db.rs`
- Modify: `crates/cellforge-auth/src/jwt.rs`
- Modify: `crates/cellforge-kernel/Cargo.toml`
- Modify: `crates/cellforge-kernel/src/launcher.rs`
- Modify: `crates/cellforge-export/Cargo.toml`
- Modify: `crates/cellforge-export/src/templates.rs`
- Modify: `crates/cellforge-server/Cargo.toml`
- Modify: `crates/cellforge-server/src/plugins/mod.rs`

- [ ] **Step 1: Migrate cellforge-auth**

In `crates/cellforge-auth/Cargo.toml`, add:
```toml
cellforge-config = { path = "../cellforge-config" }
```

Remove `dirs = "6"` from dependencies.

In `crates/cellforge-auth/src/db.rs`, delete the `data_dir()` function (lines 757-761) and the `workspace_dir()` function (lines 763-765). Replace all usages:
- `data_dir()` → `cellforge_config::config_dir()`
- `data_dir().join("users").join(username).join("notebooks")` → `cellforge_config::user_workspace_dir(username)`

Add at the top of the file (no `use` needed — use full path `cellforge_config::` inline, matching the crate's pattern of not having many `use` statements at the top, or add a single `use` if the crate already does that).

In `crates/cellforge-auth/src/jwt.rs`, replace the `dirs::config_dir()...join("cellforge")` block (lines 20-22) with:
```rust
let dir = cellforge_config::config_dir();
```

Remove `use` of `dirs` if it was used nowhere else.

- [ ] **Step 2: Migrate cellforge-kernel**

In `crates/cellforge-kernel/Cargo.toml`, add:
```toml
cellforge-config = { path = "../cellforge-config" }
```

Remove `dirs = "6"` from dependencies.

In `crates/cellforge-kernel/src/launcher.rs`, replace the path logic in `ensure_builtin_pylib_dir()` (lines 25-28):
```rust
// Old:
let base = dirs::config_dir()
    .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".config"))
    .join("cellforge")
    .join("pylib");

// New:
let base = cellforge_config::pylib_dir();
```

- [ ] **Step 3: Migrate cellforge-export**

In `crates/cellforge-export/Cargo.toml`, add:
```toml
cellforge-config = { path = "../cellforge-config" }
```

Remove `dirs = "6"` from dependencies.

In `crates/cellforge-export/src/templates.rs`, replace the `templates_dir()` function (lines 8-12):
```rust
pub fn templates_dir() -> PathBuf {
    cellforge_config::templates_dir()
}
```

Or inline it: delete the local function entirely and replace all callers with `cellforge_config::templates_dir()`.

- [ ] **Step 4: Migrate cellforge-server plugins**

In `crates/cellforge-server/Cargo.toml`, add:
```toml
cellforge-config = { path = "../cellforge-config" }
```

In `crates/cellforge-server/src/plugins/mod.rs`, delete the `data_dir()` function (lines 95-99) and replace all usages:
- `data_dir().join("plugins")` → `cellforge_config::plugins_dir()`
- `data_dir().join("users").join(username).join("plugins")` → `cellforge_config::user_plugins_dir(username)`
- `data_dir().join("users").join(username).join("kernel-pylib")` → `cellforge_config::user_kernel_pylib_dir(username)`

Update `system_plugin_dir()`, `user_plugin_dir()`, and `user_kernel_pylib_dir()` to delegate to `cellforge_config`.

Also update `crates/cellforge-server/src/plugins/config.rs` — the `settings_path()` function uses its own path logic. Replace with `cellforge_config::config_dir().join("settings.json")`.

- [ ] **Step 5: Verify everything compiles and all tests pass**

Run: `cargo test --workspace`
Expected: all tests pass

- [ ] **Step 6: Verify no duplicate data_dir() functions remain**

Run: `grep -rn "fn data_dir" crates/`
Expected: no matches (all removed)

Run: `grep -rn "dirs::config_dir" crates/ | grep -v cellforge-config`
Expected: no matches (only cellforge-config uses `dirs` directly)

- [ ] **Step 7: Commit**

```bash
git add crates/
git commit -m "refactor: migrate all crates to use cellforge-config for path helpers"
```

---

## Task 9: SQLite migrations

**Files:**
- Modify: `crates/cellforge-auth/src/db.rs`

The current approach uses `CREATE TABLE IF NOT EXISTS` + blind `ALTER TABLE` calls that silently fail if the column already exists. This works but is fragile. We replace it with a `user_version` PRAGMA-based migration system using rusqlite directly (no sqlx — the crate already uses rusqlite with bundled SQLite).

- [ ] **Step 1: Refactor db.rs — add migration system**

Replace the `open()` method in `crates/cellforge-auth/src/db.rs`. The new version:

```rust
impl UserDb {
    pub fn open() -> Result<Self> {
        let dir = cellforge_config::config_dir();
        std::fs::create_dir_all(&dir)?;
        let db_path = dir.join("users.db");

        let conn = Connection::open(&db_path)
            .with_context(|| format!("opening db at {}", db_path.display()))?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;

        Self::run_migrations(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn run_migrations(conn: &Connection) -> Result<()> {
        let version: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;

        if version < 1 {
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    display_name TEXT NOT NULL DEFAULT '',
                    workspace_dir TEXT NOT NULL,
                    is_admin INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    max_kernels INTEGER NOT NULL DEFAULT 0,
                    max_memory_mb INTEGER NOT NULL DEFAULT 0,
                    group_name TEXT NOT NULL DEFAULT '',
                    last_active DATETIME DEFAULT NULL,
                    is_active INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    max_kernels_per_user INTEGER NOT NULL DEFAULT 2,
                    max_memory_mb_per_user INTEGER NOT NULL DEFAULT 1024,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS kernel_sessions (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    kernel_spec TEXT NOT NULL DEFAULT '',
                    language TEXT NOT NULL DEFAULT '',
                    notebook_path TEXT NOT NULL DEFAULT '',
                    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
                    memory_mb INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'running'
                );
                CREATE INDEX IF NOT EXISTS idx_ks_username ON kernel_sessions(username);

                CREATE TABLE IF NOT EXISTS file_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_path TEXT NOT NULL,
                    username TEXT NOT NULL,
                    action TEXT NOT NULL DEFAULT 'save',
                    snapshot TEXT NOT NULL,
                    changed_cells TEXT NOT NULL DEFAULT '[]',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_history_path ON file_history(file_path);

                CREATE TABLE IF NOT EXISTS shared_files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    from_user TEXT NOT NULL,
                    to_user TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    shared_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                PRAGMA user_version = 1;
                ",
            )?;
        }

        // Existing v0.3 databases: they already have these tables but with
        // user_version=0. Detect by checking if the users table exists and
        // set user_version=1 so future migrations don't re-run.
        if version == 0 {
            let has_users: bool = conn
                .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'")?
                .exists([])?;
            if has_users {
                // Run idempotent ALTER TABLEs for columns that may have been
                // added by earlier non-migration code
                let alters = [
                    "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN max_kernels INTEGER NOT NULL DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN max_memory_mb INTEGER NOT NULL DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN group_name TEXT NOT NULL DEFAULT ''",
                    "ALTER TABLE users ADD COLUMN last_active DATETIME DEFAULT NULL",
                    "ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0",
                    "ALTER TABLE file_history ADD COLUMN changed_cells TEXT NOT NULL DEFAULT '[]'",
                ];
                for sql in alters {
                    let _ = conn.execute_batch(sql); // silently ignore "duplicate column"
                }
                conn.execute_batch("PRAGMA user_version = 1;")?;
            }
        }

        // Future migrations go here:
        // if version < 2 {
        //     conn.execute_batch("... ; PRAGMA user_version = 2;")?;
        // }

        Ok(())
    }
}
```

Delete the old `open()` method body and all the inline `ALTER TABLE` and `CREATE TABLE IF NOT EXISTS` statements that were there before.

- [ ] **Step 2: Verify tests pass**

Run: `cargo test -p cellforge-auth`
Expected: success (no auth-specific tests exist but compilation must succeed)

Run: `cargo test --workspace`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add crates/cellforge-auth/src/db.rs
git commit -m "refactor: add PRAGMA user_version migration system to cellforge-auth"
```

---

## Task 10: Desktop app — cellforge-app crate

**Files:**
- Create: `crates/cellforge-app/Cargo.toml`
- Create: `crates/cellforge-app/src/main.rs`
- Modify: `Cargo.toml` (workspace)
- Modify: `crates/cellforge-server/Cargo.toml` (add lib target)
- Modify: `crates/cellforge-server/src/main.rs` (extract server startup into a public function)

The desktop app needs to start the Axum server programmatically. Currently `cellforge-server` only has a `main()`. We need to extract the server logic into a library function that `cellforge-app` can call.

- [ ] **Step 1: Extract server startup into a lib function**

Create `crates/cellforge-server/src/lib.rs`:

```rust
//! CellForge server library — allows embedding the server in other binaries.

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
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

#[cfg(feature = "embed-frontend")]
#[derive(rust_embed::Embed)]
#[folder = "../../frontend/dist"]
struct FrontendAssets;

#[cfg(feature = "embed-frontend")]
use axum::response::IntoResponse;

#[cfg(feature = "embed-frontend")]
async fn serve_embedded(uri: axum::http::Uri) -> impl axum::response::IntoResponse {
    let path = uri.path().trim_start_matches('/');
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

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Start the CellForge server on the given listener.
/// Returns only when the server shuts down.
pub async fn run_server(listener: TcpListener, config: Config) -> anyhow::Result<()> {
    let state = Arc::new(AppState::new(&config));

    if !config.no_update_check {
        tokio::spawn(async { check_for_updates().await });
    }

    let api = build_api_router();

    // background reaper
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
        if let Some(ref dist) = find_dist_dir() {
            tracing::info!("serving frontend from {}", dist.display());
            app = app.fallback_service(
                tower_http::services::ServeDir::new(dist)
                    .not_found_service(tower_http::services::ServeFile::new(dist.join("index.html"))),
            );
        }
    }

    let app = app
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    tracing::info!("listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

fn build_api_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/health", get(health_handler))
        .route("/auth/status", get(auth::status))
        .route("/auth/login", axum::routing::post(auth::login))
        .route("/auth/register", axum::routing::post(auth::register))
        .route("/auth/me", get(auth::me))
        .route("/auth/logout", axum::routing::post(auth::logout))
        .route("/auth/users", get(auth::list_users))
        .route("/auth/users/{username}", axum::routing::delete(auth::delete_user))
        .route("/auth/change-password", axum::routing::post(auth::change_password))
        .route("/config", get(routes::config))
        .route("/notebooks", get(notebooks::list).post(notebooks::create))
        .route("/notebooks/open", axum::routing::post(notebooks::open_path))
        .route("/notebooks/rename", axum::routing::post(notebooks::rename))
        .route("/notebooks/{*path}", get(notebooks::read).put(notebooks::save).delete(notebooks::remove))
        .route("/kernelspecs", get(kernels::list_specs))
        .route("/sessions", get(kernels::list_sessions).post(kernels::create_session))
        .route("/sessions/{id}", delete(kernels::delete_session))
        .route("/export/pdf", axum::routing::post(export::export_pdf))
        .route("/templates", get(export::list_templates).post(export::upload_template))
        .route("/templates/{name}", axum::routing::delete(export::delete_template))
        .route("/templates/{name}/assets", axum::routing::post(export::upload_template_assets))
        .route("/files/upload", axum::routing::post(fileops::upload))
        .route("/files/mkdir", axum::routing::post(fileops::mkdir))
        .route("/files/delete", axum::routing::post(fileops::delete_path))
        .route("/files/rename", axum::routing::post(fileops::rename_path))
        .route("/files/download", axum::routing::post(fileops::download_file))
        .route("/files/download-zip", axum::routing::post(fileops::download_zip))
        .route("/files/extract-zip", axum::routing::post(fileops::extract_zip_file))
        .route("/files/history", axum::routing::post(fileops::file_history))
        .route("/files/history/{id}", get(fileops::history_snapshot))
        .route("/files/share", axum::routing::post(fileops::share_file))
        .route("/files/unshare", axum::routing::post(fileops::unshare_file))
        .route("/files/shared", get(fileops::shared_files))
        .route("/files/share-users", get(fileops::share_users))
        .route("/files", get(files::list_root))
        .route("/files/{*path}", get(files::list))
        .route("/plugins", get(plugin_routes::list_plugins))
        .route("/plugins/config", get(plugin_routes::get_config).post(plugin_routes::set_config))
        .route("/plugins/upload", axum::routing::post(plugin_routes::upload_plugin))
        .route("/plugins/{scope}/{name}", delete(plugin_routes::delete_plugin))
        .route("/plugins/{scope}/{name}/frontend/{*rest}", get(plugin_routes::serve_plugin_asset))
        .route("/dashboard", get(dashboard::dashboard))
        .route("/dashboard/kernels", get(dashboard::dashboard_kernels))
        .route("/kernels/{id}/stop", axum::routing::post(dashboard::stop_kernel))
        .route("/admin/stats", get(admin::stats))
        .route("/admin/users", get(admin::list_users))
        .route("/admin/users/{username}", axum::routing::put(admin::update_user))
        .route("/admin/groups", get(admin::list_groups).post(admin::create_group))
        .route("/admin/groups/{name}", axum::routing::put(admin::update_group).delete(admin::delete_group))
        .route("/admin/kernels", get(admin::all_kernels))
        .route("/admin/kernels/{id}/stop", axum::routing::post(admin::stop_kernel))
        .route("/admin/kernels/stop-idle", axum::routing::post(admin::stop_all_idle))
        .route("/ai/chat", axum::routing::post(ai::chat))
        .route("/update-check", get(update_check_handler))
        .route("/git/status", get(git::status))
        .route("/ws", get(ws_handler))
        .route("/collab", get(crate::ws::collab::collab_handler))
}

async fn health_handler() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({ "status": "ok", "version": VERSION }))
}

async fn update_check_handler() -> axum::Json<serde_json::Value> {
    axum::Json(fetch_latest_release().await)
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
    if info.get("has_update").and_then(|v| v.as_bool()).unwrap_or(false) {
        let latest = info.get("latest").and_then(|v| v.as_str()).unwrap_or("?");
        tracing::info!(
            "new version available: v{latest} (current: v{VERSION}). \
             Download at https://github.com/Subbok/cellforge/releases/latest"
        );
    }
}
```

Then simplify `crates/cellforge-server/src/main.rs` to:

```rust
use cellforge_server::Config;
use clap::Parser;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("cellforge=debug".parse()?))
        .init();

    let config = Config::parse();
    let addr = format!("{}:{}", config.host, config.port);
    tracing::info!("starting at http://{addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    cellforge_server::run_server(listener, config).await
}
```

Update `crates/cellforge-server/Cargo.toml` to expose a lib target — no change needed in Cargo.toml since Rust auto-detects both `src/main.rs` and `src/lib.rs` in the same crate.

- [ ] **Step 2: Verify server still works**

Run: `cargo build -p cellforge-server`
Expected: success

Run: `cargo test --workspace`
Expected: all tests pass

- [ ] **Step 3: Create cellforge-app crate**

Create `crates/cellforge-app/Cargo.toml`:

```toml
[package]
name = "cellforge-app"
version.workspace = true
edition.workspace = true

[[bin]]
name = "cellforge-app"

[dependencies]
cellforge-server = { path = "../cellforge-server", features = ["embed-frontend"] }

tokio = { workspace = true }
anyhow = { workspace = true }
tracing = { workspace = true }
tracing-subscriber = { workspace = true }

wry = "0.47"
tao = { version = "0.30", features = ["rwh_06"] }
```

Create `crates/cellforge-app/src/main.rs`:

```rust
use anyhow::Result;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use tracing_subscriber::EnvFilter;
use wry::WebViewBuilder;

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("cellforge=debug".parse()?))
        .init();

    // Start tokio runtime for the server
    let rt = tokio::runtime::Runtime::new()?;

    // Bind to a random free port on localhost
    let listener = rt.block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))?;
    let port = listener.local_addr()?.port();
    let url = format!("http://127.0.0.1:{port}");

    tracing::info!("server bound to {url}");

    // Start the server in a background thread
    let config = cellforge_server::Config {
        host: "127.0.0.1".to_string(),
        port,
        notebook_dir: std::env::current_dir().unwrap_or_default(),
        notebook: None,
        no_update_check: false,
        hub: false,
        idle_timeout: 30,
    };

    std::thread::spawn(move || {
        rt.block_on(async {
            if let Err(e) = cellforge_server::run_server(listener, config).await {
                tracing::error!("server error: {e}");
            }
        });
    });

    // Create native window with webview
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("CellForge")
        .with_inner_size(tao::dpi::LogicalSize::new(1400.0, 900.0))
        .build(&event_loop)?;

    let _webview = WebViewBuilder::new()
        .with_url(&url)
        .build(&window)?;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}
```

- [ ] **Step 4: Add cellforge-app to workspace**

In root `Cargo.toml`, add `"crates/cellforge-app"` to `members`:

```toml
members = [
    "crates/cellforge-config",
    "crates/cellforge-server",
    "crates/cellforge-notebook",
    "crates/cellforge-kernel",
    "crates/cellforge-reactive",
    "crates/cellforge-varexplorer",
    "crates/cellforge-export",
    "crates/cellforge-auth",
    "crates/cellforge-app",
]
```

- [ ] **Step 5: Make Config fields public for programmatic construction**

The `Config` struct in `crates/cellforge-server/src/config.rs` uses `clap::Parser`. For `cellforge-app` to construct it directly (without CLI args), we need the fields to be public — they already are. But we also need `Config` to be accessible from `lib.rs`. Update `crates/cellforge-server/src/lib.rs` to `pub use config::Config;` (already included in the lib.rs above).

Verify `Config` derives `Clone` (it already does: `#[derive(Parser, Debug, Clone)]`).

- [ ] **Step 6: Verify it compiles**

Run: `cargo check -p cellforge-app`
Expected: success (may not run without a display server, but it should compile)

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml crates/cellforge-server/src/lib.rs crates/cellforge-server/src/main.rs crates/cellforge-app/
git commit -m "feat: add cellforge-app desktop wrapper (wry + tao)"
```

---

## Task 11: Update release workflow for desktop builds

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add desktop build targets**

Update `.github/workflows/release.yml` to build both `cellforge-server` and `cellforge-app`. Add a second matrix axis for the desktop binary:

After the existing `steps` section for building `cellforge-server`, add a parallel build for `cellforge-app`:

In the `matrix.include` section, add entries for the desktop app. The simplest approach is to add a second cargo build step in the existing job:

```yaml
      # Build desktop app binary
      - name: Build desktop app
        if: matrix.target != 'x86_64-pc-windows-msvc'  # Windows needs extra deps for wry
        run: cargo build --release --target ${{ matrix.target }} -p cellforge-app --features embed-frontend
        continue-on-error: true  # Desktop app is optional — don't fail the release

      - name: Prepare desktop artifact (Unix)
        if: runner.os != 'Windows'
        run: |
          if [ -f target/${{ matrix.target }}/release/cellforge-app ]; then
            cp target/${{ matrix.target }}/release/cellforge-app ${{ matrix.artifact }}-desktop
            chmod +x ${{ matrix.artifact }}-desktop
          fi
        continue-on-error: true
```

And add `${{ matrix.artifact }}-desktop` to the upload artifact paths.

**Note:** wry/tao have platform-specific dependencies (GTK on Linux, WebKit2GTK). The Linux runner needs:

```yaml
      - name: Install desktop dependencies (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add desktop app binary to release workflow"
```

---

## Task 12: i18n — setup infrastructure

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/lib/i18n.ts`
- Create: `frontend/src/locales/en.json`
- Create: `frontend/src/locales/pl.json`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Install i18n dependencies**

```bash
cd /home/suddoku/Documents/CellForge/frontend
npm install i18next react-i18next
```

- [ ] **Step 2: Create i18n configuration**

Create `frontend/src/lib/i18n.ts`:

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import pl from '../locales/pl.json';

const LS_KEY = 'cellforge.language';

function savedLanguage(): string {
  if (typeof localStorage === 'undefined') return 'en';
  return localStorage.getItem(LS_KEY) ?? 'en';
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, pl: { translation: pl } },
  lng: savedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(lng: string) {
  i18n.changeLanguage(lng);
  try { localStorage.setItem(LS_KEY, lng); } catch { /* ignored */ }
}

export default i18n;
```

- [ ] **Step 3: Create English translation file**

Create `frontend/src/locales/en.json`:

```json
{
  "common": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "ok": "OK",
    "close": "Close",
    "loading": "Loading...",
    "error": "Error",
    "back": "Back",
    "refresh": "Refresh",
    "upload": "Upload",
    "create": "Create",
    "name": "Name",
    "description": "Description",
    "actions": "Actions",
    "settings": "Settings",
    "clear": "Clear"
  },

  "app": {
    "kernelRunningWarning": "Kernel is still executing code. Leaving will keep it running on the server. Continue?",
    "unsavedChanges": "You have unsaved changes."
  },

  "auth": {
    "createAdminAccount": "Create your admin account to get started",
    "signInToWorkspace": "Sign in to your workspace",
    "username": "Username",
    "displayName": "Display name",
    "optional": "Optional",
    "password": "Password",
    "signingIn": "Signing in...",
    "createAdmin": "Create admin account",
    "signIn": "Sign in",
    "tagline": "CellForge — Notebook IDE",
    "unknownError": "Unknown error"
  },

  "home": {
    "loadingWorkspace": "Loading workspace...",
    "adminPanel": "Admin Panel",
    "signOut": "Sign out",
    "goodNight": "Good night",
    "goodMorning": "Good morning",
    "goodAfternoon": "Good afternoon",
    "goodEvening": "Good evening",
    "workspaceSubtitle": "Here's what's happening in your workspace",
    "recentNotebooks": "Recent notebooks",
    "runningKernels": "Running kernels",
    "sharedWithMe": "Shared with me",
    "viewAll": "View all",
    "fromUser": "from @{{username}}",
    "removeShare": "Remove share",
    "live": "live",
    "browseFiles": "Browse files",
    "newNotebook": "New notebook",
    "workspaceEmpty": "Your workspace is empty",
    "createToStart": "Create a notebook to get started",
    "createNotebook": "Create notebook",
    "stopKernel": "Stop kernel"
  },

  "dashboard": {
    "home": "Home",
    "files": "Files",
    "emptyDirectory": "Empty directory",
    "createNotebookToStart": "Create a new notebook to get started",
    "folder": "Folder",
    "new": "New",
    "notebook": "Notebook",
    "dropFilesHere": "Drop files here",
    "selectedCount": "{{count}} selected",
    "downloadZip": "Download ZIP"
  },

  "save": {
    "unsavedChanges": "Unsaved changes",
    "saveBeforeLeaving": "Do you want to save your changes before leaving?",
    "dontSave": "Don't save"
  },

  "kernel": {
    "selectKernel": "Select a kernel",
    "chooseEnvironment": "Choose which environment to run your code in",
    "scanning": "Scanning for kernels...",
    "cantReachBackend": "Can't reach backend",
    "startDevScript": "Start it with `./scripts/dev.sh`",
    "otherKernels": "Other kernels",
    "needsInstallation": "Needs kernel installation",
    "install": "Install",
    "copied": "Copied!",
    "copiedToClipboard": "Copied to clipboard:\n\n{{cmd}}\n\nRun it in your terminal, then refresh.",
    "noKernelsFound": "No kernels found",
    "needPython": "To run code you need Python with ipykernel:",
    "autoRefresh": "The list auto-refreshes every 5 seconds.",
    "openWithoutKernel": "Open without kernel",
    "conda": "conda",
    "noKernel": "no kernel"
  },

  "export": {
    "exportNotebook": "Export notebook",
    "pdfTypst": "PDF (Typst)",
    "html": "HTML",
    "template": "Template",
    "variables": "Variables",
    "noImage": "(no image)",
    "exporting": "Exporting...",
    "exportFormat": "Export {{format}}"
  },

  "shortcuts": {
    "title": "Keyboard shortcuts",
    "pressToToggle": "Press `?` to toggle this overlay",
    "execution": "Execution",
    "runCellAdvance": "Run cell and advance",
    "runCellStay": "Run cell, stay",
    "runCellInsert": "Run cell, insert below",
    "navigation": "Navigation (command mode)",
    "previousCell": "Previous cell",
    "nextCell": "Next cell",
    "editMode": "Edit mode (focus editor)",
    "commandMode": "Command mode (blur editor)",
    "cellOps": "Cell operations (command mode)",
    "insertAbove": "Insert cell above",
    "insertBelow": "Insert cell below",
    "deleteCell": "Delete cell (double tap)",
    "changeToMarkdown": "Change to Markdown",
    "changeToCode": "Change to Code",
    "file": "File",
    "saveNotebook": "Save notebook",
    "findReplace": "Find / Replace",
    "undoOutside": "Undo (outside editor)",
    "redoOutside": "Redo (outside editor)",
    "formatting": "Formatting",
    "formatCode": "Format code (in editor)"
  },

  "settings": {
    "title": "Settings",
    "appearance": "Appearance",
    "perUser": "per user",
    "accentColor": "Accent color",
    "accentDescription": "Tints selection highlights, active cell bars, and primary buttons. Pick a swatch or drop in any 6-digit hex.",
    "customHex": "Custom hex:",
    "preview": "Preview →",
    "activeCell": "Active cell",
    "themes": "Themes",
    "themesDescription": "Pick a color theme. Built-in Crisp is always available; install more by uploading a `.zip` with a theme-only `plugin.json`.",
    "builtIn": "Built-in",
    "installedThemePlugins": "Installed theme plugins",
    "system": "system",
    "uploadTheme": "Upload theme",
    "uploading": "Uploading…",
    "removeTheme": "Remove theme",
    "editor": "Editor",
    "reactiveExecution": "Reactive Execution",
    "reactiveDescription": "When enabled, CellForge automatically detects dependencies between cells. Changing a variable in one cell will immediately re-execute all other cells that depend on it, ensuring consistency across the entire notebook.",
    "reactiveEnabled": "Enabled (Default)",
    "reactiveDisabled": "Disabled",
    "reactiveEnabledDesc": "Notebook reacts to every change.",
    "reactiveDisabledDesc": "Cells are only executed manually.",
    "autoSave": "Auto-save",
    "autoSaveDisabled": "Disabled",
    "autoSave10s": "Every 10 seconds",
    "autoSave30s": "Every 30 seconds",
    "autoSave1m": "Every 1 minute",
    "autoSave2m": "Every 2 minutes",
    "autoSave5m": "Every 5 minutes",
    "aiAssistant": "AI Assistant",
    "aiDescription": "Configure your AI provider for cell explanations, error fixes, and code generation. Your API key is stored locally and never sent to CellForge servers.",
    "provider": "Provider",
    "apiKey": "API Key",
    "apiBaseUrl": "API Base URL",
    "model": "Model",
    "ollamaNote": "Ollama runs locally — no API key needed. Make sure Ollama is running.",
    "apiKeyNote": "Your key is stored in your browser only (localStorage). Never sent to CellForge servers.",
    "exportSection": "Export",
    "systemWide": "system-wide",
    "pdfTemplates": "PDF Export Templates",
    "templatesDescription": "Typst templates with optional assets (images). Use `{{content}}` for notebook content, `{{title}}` for title. Define variables in a `#let config = (...)` block.",
    "addAssets": "Add assets (images, fonts)",
    "uploadTemplate": "Upload template",
    "templateName": "Template name (e.g. lab-report)",
    "templateFile": "Template file (.typ)",
    "assetsOptional": "Assets (images, fonts — optional)",
    "account": "Account",
    "changePasswordDesc": "Change your password.",
    "users": "Users",
    "usersDesc": "Manage accounts and reset passwords. Only admins see this.",
    "extensions": "Extensions",
    "perScope": "per scope",
    "plugins": "Plugins",
    "pluginsDescription": "Extend CellForge with Python helpers, custom widgets, and more. Upload a `.zip` containing a `plugin.json` manifest. Theme-only plugins are managed in the Themes section above.",
    "allowUserPlugins": "Allow users to install plugins",
    "allowUserPluginsDesc": "When off, only admins can install plugins (system-wide).",
    "enabled": "Enabled",
    "user": "User",
    "uploadPlugin": "Upload plugin",
    "refreshPlugins": "Refresh plugin list",
    "pluginsDisabled": "Plugin installation is disabled. Ask an admin to enable it or to install plugins system-wide.",
    "noPlugins": "No plugins installed.",
    "removePlugin": "Remove plugin",
    "about": "About",
    "aboutDescription": "v0.3.0 — Notebook IDE. Rust + React + Typst.",
    "newPassword": "New password",
    "confirmPassword": "Confirm password",
    "passwordMinLength": "Password must be at least 4 characters",
    "passwordsMismatch": "Passwords do not match",
    "passwordChanged": "Password changed",
    "failed": "Failed",
    "changePassword": "Change password",
    "addUser": "Add user",
    "displayNameOptional": "Display name (optional)",
    "deleteUser": "Delete user",
    "resetPassword": "Reset password",
    "admin": "admin",
    "passwordUpdated": "Password for @{{username}} has been updated.",
    "language": "Language",
    "languageDescription": "Choose your preferred language for the interface."
  },

  "admin": {
    "title": "Admin Panel",
    "loadingAdmin": "Loading admin data...",
    "totalUsers": "Total users",
    "runningKernels": "Running kernels",
    "totalMemory": "Total memory",
    "mb": "MB",
    "usersSection": "Users",
    "role": "Role",
    "kernels": "Kernels",
    "joined": "Joined",
    "limits": "Limits",
    "groups": "Groups",
    "newGroup": "New group",
    "maxKernelsPerUser": "Max kernels / user",
    "maxMemoryPerUser": "Max memory MB / user",
    "noGroups": "No groups yet. Create one to set resource limits for teams.",
    "runningKernelsSection": "Running Kernels",
    "stopAllIdle": "Stop all idle"
  },

  "update": {
    "newVersion": "CellForge v{{version}}",
    "available": "A new version is available.",
    "download": "Download",
    "dismiss": "Dismiss"
  },

  "error": {
    "somethingBroke": "Something broke",
    "errorDescription": "CellForge hit an unexpected error while rendering. Your notebook isn't lost — it's still saved on disk. Try reloading the page; if the same error comes back, copy the details below into a GitHub issue.",
    "stackTrace": "Stack trace",
    "componentTree": "Component tree",
    "reloadPage": "Reload page",
    "tryRecover": "Try to recover"
  },

  "variables": {
    "noVariables": "No variables yet. Run a cell to see them here.",
    "shape": "shape:",
    "dtype": "dtype:",
    "len": "len:",
    "fromModule": "from {{module}}",
    "previewTable": "Preview table",
    "rowsCols": "{{rows}} rows x {{cols}} cols"
  },

  "statusbar": {
    "utf8": "UTF-8"
  }
}
```

- [ ] **Step 4: Create Polish translation file**

Create `frontend/src/locales/pl.json`:

```json
{
  "common": {
    "save": "Zapisz",
    "cancel": "Anuluj",
    "delete": "Usuń",
    "ok": "OK",
    "close": "Zamknij",
    "loading": "Ładowanie...",
    "error": "Błąd",
    "back": "Wstecz",
    "refresh": "Odśwież",
    "upload": "Prześlij",
    "create": "Utwórz",
    "name": "Nazwa",
    "description": "Opis",
    "actions": "Akcje",
    "settings": "Ustawienia",
    "clear": "Wyczyść"
  },

  "app": {
    "kernelRunningWarning": "Kernel wciąż wykonuje kod. Po opuszczeniu strony będzie działał na serwerze. Kontynuować?",
    "unsavedChanges": "Masz niezapisane zmiany."
  },

  "auth": {
    "createAdminAccount": "Utwórz konto administratora, aby rozpocząć",
    "signInToWorkspace": "Zaloguj się do swojego workspace'a",
    "username": "Nazwa użytkownika",
    "displayName": "Wyświetlana nazwa",
    "optional": "Opcjonalne",
    "password": "Hasło",
    "signingIn": "Logowanie...",
    "createAdmin": "Utwórz konto admina",
    "signIn": "Zaloguj się",
    "tagline": "CellForge — Notebook IDE",
    "unknownError": "Nieznany błąd"
  },

  "home": {
    "loadingWorkspace": "Ładowanie workspace'a...",
    "adminPanel": "Panel admina",
    "signOut": "Wyloguj się",
    "goodNight": "Dobranoc",
    "goodMorning": "Dzień dobry",
    "goodAfternoon": "Dzień dobry",
    "goodEvening": "Dobry wieczór",
    "workspaceSubtitle": "Co się dzieje w Twoim workspace'ie",
    "recentNotebooks": "Ostatnie notebooki",
    "runningKernels": "Uruchomione kernele",
    "sharedWithMe": "Udostępnione mi",
    "viewAll": "Pokaż wszystkie",
    "fromUser": "od @{{username}}",
    "removeShare": "Usuń udostępnienie",
    "live": "aktywny",
    "browseFiles": "Przeglądaj pliki",
    "newNotebook": "Nowy notebook",
    "workspaceEmpty": "Twój workspace jest pusty",
    "createToStart": "Utwórz notebook, aby zacząć",
    "createNotebook": "Utwórz notebook",
    "stopKernel": "Zatrzymaj kernel"
  },

  "dashboard": {
    "home": "Strona główna",
    "files": "Pliki",
    "emptyDirectory": "Pusty katalog",
    "createNotebookToStart": "Utwórz nowy notebook, aby zacząć",
    "folder": "Folder",
    "new": "Nowy",
    "notebook": "Notebook",
    "dropFilesHere": "Upuść pliki tutaj",
    "selectedCount": "{{count}} zaznaczono",
    "downloadZip": "Pobierz ZIP"
  },

  "save": {
    "unsavedChanges": "Niezapisane zmiany",
    "saveBeforeLeaving": "Czy chcesz zapisać zmiany przed wyjściem?",
    "dontSave": "Nie zapisuj"
  },

  "kernel": {
    "selectKernel": "Wybierz kernel",
    "chooseEnvironment": "Wybierz środowisko do uruchamiania kodu",
    "scanning": "Skanowanie kerneli...",
    "cantReachBackend": "Nie można połączyć się z backendem",
    "startDevScript": "Uruchom go poleceniem `./scripts/dev.sh`",
    "otherKernels": "Inne kernele",
    "needsInstallation": "Wymaga instalacji kernela",
    "install": "Zainstaluj",
    "copied": "Skopiowano!",
    "copiedToClipboard": "Skopiowano do schowka:\n\n{{cmd}}\n\nUruchom to w terminalu, potem odśwież.",
    "noKernelsFound": "Nie znaleziono kerneli",
    "needPython": "Do uruchamiania kodu potrzebujesz Pythona z ipykernel:",
    "autoRefresh": "Lista odświeża się automatycznie co 5 sekund.",
    "openWithoutKernel": "Otwórz bez kernela",
    "conda": "conda",
    "noKernel": "brak kernela"
  },

  "export": {
    "exportNotebook": "Eksportuj notebook",
    "pdfTypst": "PDF (Typst)",
    "html": "HTML",
    "template": "Szablon",
    "variables": "Zmienne",
    "noImage": "(brak obrazu)",
    "exporting": "Eksportowanie...",
    "exportFormat": "Eksportuj {{format}}"
  },

  "shortcuts": {
    "title": "Skróty klawiszowe",
    "pressToToggle": "Naciśnij `?` aby przełączyć ten overlay",
    "execution": "Wykonywanie",
    "runCellAdvance": "Uruchom komórkę i przejdź dalej",
    "runCellStay": "Uruchom komórkę, zostań",
    "runCellInsert": "Uruchom komórkę, wstaw poniżej",
    "navigation": "Nawigacja (tryb komend)",
    "previousCell": "Poprzednia komórka",
    "nextCell": "Następna komórka",
    "editMode": "Tryb edycji (fokus na edytor)",
    "commandMode": "Tryb komend (wyjdź z edytora)",
    "cellOps": "Operacje na komórkach (tryb komend)",
    "insertAbove": "Wstaw komórkę powyżej",
    "insertBelow": "Wstaw komórkę poniżej",
    "deleteCell": "Usuń komórkę (podwójne naciśnięcie)",
    "changeToMarkdown": "Zmień na Markdown",
    "changeToCode": "Zmień na Kod",
    "file": "Plik",
    "saveNotebook": "Zapisz notebook",
    "findReplace": "Znajdź / Zamień",
    "undoOutside": "Cofnij (poza edytorem)",
    "redoOutside": "Ponów (poza edytorem)",
    "formatting": "Formatowanie",
    "formatCode": "Formatuj kod (w edytorze)"
  },

  "settings": {
    "title": "Ustawienia",
    "appearance": "Wygląd",
    "perUser": "per użytkownik",
    "accentColor": "Kolor akcentu",
    "accentDescription": "Koloruje podświetlenia zaznaczenia, paski aktywnych komórek i główne przyciski. Wybierz kolor lub wpisz dowolny 6-cyfrowy hex.",
    "customHex": "Własny hex:",
    "preview": "Podgląd →",
    "activeCell": "Aktywna komórka",
    "themes": "Motywy",
    "themesDescription": "Wybierz motyw kolorystyczny. Wbudowany Crisp jest zawsze dostępny; zainstaluj więcej przesyłając `.zip` z `plugin.json` zawierającym tylko motyw.",
    "builtIn": "Wbudowany",
    "installedThemePlugins": "Zainstalowane motywy z pluginów",
    "system": "systemowy",
    "uploadTheme": "Prześlij motyw",
    "uploading": "Przesyłanie…",
    "removeTheme": "Usuń motyw",
    "editor": "Edytor",
    "reactiveExecution": "Reaktywne wykonywanie",
    "reactiveDescription": "Gdy włączone, CellForge automatycznie wykrywa zależności między komórkami. Zmiana zmiennej w jednej komórce natychmiast ponownie uruchomi wszystkie komórki, które od niej zależą.",
    "reactiveEnabled": "Włączone (domyślne)",
    "reactiveDisabled": "Wyłączone",
    "reactiveEnabledDesc": "Notebook reaguje na każdą zmianę.",
    "reactiveDisabledDesc": "Komórki uruchamiane są tylko ręcznie.",
    "autoSave": "Autozapis",
    "autoSaveDisabled": "Wyłączony",
    "autoSave10s": "Co 10 sekund",
    "autoSave30s": "Co 30 sekund",
    "autoSave1m": "Co 1 minutę",
    "autoSave2m": "Co 2 minuty",
    "autoSave5m": "Co 5 minut",
    "aiAssistant": "Asystent AI",
    "aiDescription": "Skonfiguruj dostawcę AI do wyjaśniania komórek, naprawiania błędów i generowania kodu. Twój klucz API jest przechowywany lokalnie i nigdy nie jest wysyłany na serwery CellForge.",
    "provider": "Dostawca",
    "apiKey": "Klucz API",
    "apiBaseUrl": "Bazowy URL API",
    "model": "Model",
    "ollamaNote": "Ollama działa lokalnie — klucz API nie jest wymagany. Upewnij się, że Ollama jest uruchomiona.",
    "apiKeyNote": "Twój klucz jest przechowywany tylko w przeglądarce (localStorage). Nigdy nie jest wysyłany na serwery CellForge.",
    "exportSection": "Eksport",
    "systemWide": "systemowy",
    "pdfTemplates": "Szablony eksportu PDF",
    "templatesDescription": "Szablony Typst z opcjonalnymi zasobami (obrazy). Użyj `{{content}}` dla treści notebooka, `{{title}}` dla tytułu. Zdefiniuj zmienne w bloku `#let config = (...)`.",
    "addAssets": "Dodaj zasoby (obrazy, fonty)",
    "uploadTemplate": "Prześlij szablon",
    "templateName": "Nazwa szablonu (np. raport-laboratoryjny)",
    "templateFile": "Plik szablonu (.typ)",
    "assetsOptional": "Zasoby (obrazy, fonty — opcjonalne)",
    "account": "Konto",
    "changePasswordDesc": "Zmień swoje hasło.",
    "users": "Użytkownicy",
    "usersDesc": "Zarządzaj kontami i resetuj hasła. Tylko administratorzy widzą tę sekcję.",
    "extensions": "Rozszerzenia",
    "perScope": "per zakres",
    "plugins": "Pluginy",
    "pluginsDescription": "Rozszerzaj CellForge o helpery Pythona, własne widgety i więcej. Prześlij `.zip` zawierający manifest `plugin.json`. Pluginy z samymi motywami są zarządzane w sekcji Motywy powyżej.",
    "allowUserPlugins": "Pozwól użytkownikom instalować pluginy",
    "allowUserPluginsDesc": "Gdy wyłączone, tylko administratorzy mogą instalować pluginy (systemowo).",
    "enabled": "Włączone",
    "user": "Użytkownik",
    "uploadPlugin": "Prześlij plugin",
    "refreshPlugins": "Odśwież listę pluginów",
    "pluginsDisabled": "Instalacja pluginów jest wyłączona. Poproś administratora o włączenie lub zainstalowanie pluginów systemowo.",
    "noPlugins": "Brak zainstalowanych pluginów.",
    "removePlugin": "Usuń plugin",
    "about": "O programie",
    "aboutDescription": "v0.3.0 — Notebook IDE. Rust + React + Typst.",
    "newPassword": "Nowe hasło",
    "confirmPassword": "Potwierdź hasło",
    "passwordMinLength": "Hasło musi mieć co najmniej 4 znaki",
    "passwordsMismatch": "Hasła nie są zgodne",
    "passwordChanged": "Hasło zmienione",
    "failed": "Błąd",
    "changePassword": "Zmień hasło",
    "addUser": "Dodaj użytkownika",
    "displayNameOptional": "Wyświetlana nazwa (opcjonalnie)",
    "deleteUser": "Usuń użytkownika",
    "resetPassword": "Resetuj hasło",
    "admin": "admin",
    "passwordUpdated": "Hasło dla @{{username}} zostało zaktualizowane.",
    "language": "Język",
    "languageDescription": "Wybierz preferowany język interfejsu."
  },

  "admin": {
    "title": "Panel administracyjny",
    "loadingAdmin": "Ładowanie danych admina...",
    "totalUsers": "Wszyscy użytkownicy",
    "runningKernels": "Uruchomione kernele",
    "totalMemory": "Całkowita pamięć",
    "mb": "MB",
    "usersSection": "Użytkownicy",
    "role": "Rola",
    "kernels": "Kernele",
    "joined": "Dołączył",
    "limits": "Limity",
    "groups": "Grupy",
    "newGroup": "Nowa grupa",
    "maxKernelsPerUser": "Max kerneli / użytkownik",
    "maxMemoryPerUser": "Max pamięci MB / użytkownik",
    "noGroups": "Brak grup. Utwórz jedną, aby ustawić limity zasobów dla zespołów.",
    "runningKernelsSection": "Uruchomione kernele",
    "stopAllIdle": "Zatrzymaj wszystkie bezczynne"
  },

  "update": {
    "newVersion": "CellForge v{{version}}",
    "available": "Dostępna jest nowa wersja.",
    "download": "Pobierz",
    "dismiss": "Odrzuć"
  },

  "error": {
    "somethingBroke": "Coś się popsuło",
    "errorDescription": "CellForge napotkał nieoczekiwany błąd podczas renderowania. Twój notebook nie jest stracony — jest wciąż zapisany na dysku. Spróbuj przeładować stronę; jeśli ten sam błąd się powtórzy, skopiuj szczegóły poniżej i zgłoś issue na GitHubie.",
    "stackTrace": "Stack trace",
    "componentTree": "Drzewo komponentów",
    "reloadPage": "Przeładuj stronę",
    "tryRecover": "Spróbuj naprawić"
  },

  "variables": {
    "noVariables": "Brak zmiennych. Uruchom komórkę, aby je tutaj zobaczyć.",
    "shape": "kształt:",
    "dtype": "typ:",
    "len": "dł.:",
    "fromModule": "z {{module}}",
    "previewTable": "Podgląd tabeli",
    "rowsCols": "{{rows}} wierszy x {{cols}} kolumn"
  },

  "statusbar": {
    "utf8": "UTF-8"
  }
}
```

- [ ] **Step 5: Initialize i18n in main.tsx**

In `frontend/src/main.tsx`, add the import at the top (before React imports):

```typescript
import './lib/i18n';
```

This must be the first import to initialize i18n before any component renders.

- [ ] **Step 6: Verify it compiles**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: success

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/i18n.ts frontend/src/locales/ frontend/src/main.tsx
git commit -m "feat: add i18n infrastructure with English and Polish translations"
```

---

## Task 13: i18n — migrate components to use translations

This is a large task. For each component, add `import { useTranslation } from 'react-i18next';` and replace hardcoded strings with `t('key')` calls. The pattern is:

```typescript
// Before:
<span>Loading...</span>

// After:
const { t } = useTranslation();
<span>{t('common.loading')}</span>
```

**Files:** All 15+ component files listed in the file map above.

- [ ] **Step 1: Migrate LoginPage.tsx**

Add `import { useTranslation } from 'react-i18next';` and `const { t } = useTranslation();` inside the component. Replace all hardcoded strings with `t('auth.*')` keys matching `en.json`.

- [ ] **Step 2: Migrate HomeDashboard.tsx**

Same pattern. Use `t('home.*')` keys. For the greeting function, return `t('home.goodMorning')` etc. based on hour.

- [ ] **Step 3: Migrate Settings.tsx**

Same pattern. Use `t('settings.*')` keys. This is the largest component — approximately 60+ strings to replace.

- [ ] **Step 4: Migrate SaveModal.tsx**

Use `t('save.*')` and `t('common.*')` keys.

- [ ] **Step 5: Migrate KernelPicker.tsx**

Use `t('kernel.*')` keys.

- [ ] **Step 6: Migrate ExportModal.tsx**

Use `t('export.*')` keys.

- [ ] **Step 7: Migrate ShortcutHelp.tsx**

Use `t('shortcuts.*')` keys.

- [ ] **Step 8: Migrate Dashboard.tsx**

Use `t('dashboard.*')` and `t('common.*')` keys.

- [ ] **Step 9: Migrate AdminPanel.tsx**

Use `t('admin.*')` and `t('common.*')` keys.

- [ ] **Step 10: Migrate UpdateNotice.tsx**

Use `t('update.*')` keys.

- [ ] **Step 11: Migrate ErrorBoundary.tsx**

Use `t('error.*')` keys. Note: ErrorBoundary is a class component — use `withTranslation` HOC or extract the render body into a functional component.

- [ ] **Step 12: Migrate ModalDialog.tsx**

Use `t('common.ok')` and `t('common.cancel')` keys.

- [ ] **Step 13: Migrate StatusBar.tsx**

Use `t('kernel.noKernel')` and `t('statusbar.utf8')` keys.

- [ ] **Step 14: Migrate VariableExplorer.tsx**

Use `t('variables.*')` keys.

- [ ] **Step 15: Migrate App.tsx**

Use `t('app.*')` keys for the beforeunload warnings.

- [ ] **Step 16: Verify frontend builds**

Run: `cd frontend && npm run build`
Expected: success

- [ ] **Step 17: Commit**

```bash
git add frontend/src/
git commit -m "feat: migrate all frontend components to use i18n translations"
```

---

## Task 14: i18n — language switcher in Settings

**Files:**
- Modify: `frontend/src/components/Settings.tsx`

- [ ] **Step 1: Add language picker to Settings**

In the Appearance section of `Settings.tsx`, after the accent color section, add a language switcher:

```tsx
import { setLanguage } from '../lib/i18n';
import { useTranslation } from 'react-i18next';

// Inside the component, in the Appearance section:
<div className="space-y-2">
  <h3 className="text-sm font-medium text-text">{t('settings.language')}</h3>
  <p className="text-xs text-text-muted">{t('settings.languageDescription')}</p>
  <div className="flex gap-2">
    {[
      { code: 'en', label: 'English' },
      { code: 'pl', label: 'Polski' },
    ].map(lang => (
      <button
        key={lang.code}
        onClick={() => setLanguage(lang.code)}
        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
          i18n.language === lang.code
            ? 'bg-accent/15 border-accent/40 text-accent'
            : 'bg-bg-elevated border-border text-text-secondary hover:border-border/80'
        }`}
      >
        {lang.label}
      </button>
    ))}
  </div>
</div>
```

You'll also need to import `i18n` from the i18n module or use `useTranslation()` which returns `{ t, i18n }`.

- [ ] **Step 2: Verify it works**

Run: `cd frontend && npm run build`
Expected: success

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Settings.tsx
git commit -m "feat: add language switcher to Settings (English / Polish)"
```

---

## Excluded from this plan (future work)

These items from the TODO list are deferred to future plans:

- **v0.4:** Universal Jupyter kernel support, Monaco syntax highlighting per language, kernel icons/colors
- **v0.5:** Compiled language support (C++, Rust, ASM), CompiledKernel type
- **Getting Started** wiki page (needs a running instance to write against)
- **README updates** (depends on v0.4 scope decisions)

---

## Self-Review Checklist

1. **Spec coverage:** Every TODO item from the user's list has a corresponding task or is explicitly listed as deferred. ✓
2. **Placeholder scan:** No TBD, TODO, or "similar to Task N" found. ✓
3. **Type consistency:** `Config` struct fields, `cellforge_config::*` function names, i18n key names are consistent across all tasks. ✓
4. **Build verification:** Every task ends with a compile/test step before committing. ✓
5. **Bliss remnants:** Task 2-5 comprehensively cover all grep results. ✓
