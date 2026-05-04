use anyhow::{Context, Result, bail};
use parking_lot::Mutex;
use rusqlite::Connection;
use serde::Serialize;
use std::sync::LazyLock;

pub struct UserDb {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub workspace_dir: String,
    pub is_admin: bool,
    pub created_at: String,
    /// Username of the admin who created this account, or empty for the
    /// bootstrap admin (created via the auth bootstrap when the workspace
    /// had no users).
    #[serde(default)]
    pub created_by: String,
    /// Most recent ISO timestamp at which we observed an authenticated
    /// request from this user. None for users who have never signed in
    /// since migration 5 landed.
    pub last_seen_at: Option<String>,
    /// Synthesised flag — `id == 1`. Bootstrap admin is the only one who
    /// can demote other admins or delete admin accounts; nothing in the
    /// app can demote or delete them. Filled in by `list_users`/`get_user`.
    #[serde(default)]
    pub is_super_admin: bool,
    /// Optional email — used **only** to derive the Gravatar SHA-256 hash
    /// for the avatar route. Never displayed, never used for auth or
    /// notifications. Empty string serialises to `None`.
    #[serde(default)]
    pub email: Option<String>,
    /// True when the user has uploaded a local avatar. The actual path is
    /// kept server-side; the frontend just decides whether to show the
    /// "remove" button.
    #[serde(default)]
    pub has_avatar: bool,
}

/// Bcrypt hash of a fixed dummy password at cost 12 — same cost factor used
/// for real passwords in `register()` and `change_password()`. `login()` falls
/// back to this when a username doesn't exist so `bcrypt::verify` runs on every
/// attempt and timing stays constant between "user not found" and "user found,
/// wrong password". Never accept this hash: the existence check in `login()`
/// keeps it from authenticating.
static DUMMY_HASH: LazyLock<String> = LazyLock::new(|| {
    bcrypt::hash("cellforge-timing-dummy", 12).expect("bcrypt dummy hash generation")
});

impl UserDb {
    pub fn open() -> Result<Self> {
        let dir = cellforge_config::config_dir();
        std::fs::create_dir_all(&dir)?;
        Self::open_at(dir.join("users.db"))
    }

    /// Open a database at a specific path. Useful for tests that need
    /// an isolated database to avoid "database is locked" errors.
    pub fn open_at(db_path: std::path::PathBuf) -> Result<Self> {
        let conn = Connection::open(&db_path)
            .with_context(|| format!("opening db at {}", db_path.display()))?;

        conn.execute_batch("PRAGMA journal_mode=WAL;")?;

        Self::run_migrations(&conn)?;

        // Warm the dummy bcrypt hash used by `login()` so the first
        // "user not found" attempt doesn't leak a timing anomaly through
        // LazyLock's one-shot init.
        let _ = &*DUMMY_HASH;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn run_migrations(conn: &Connection) -> Result<()> {
        let version: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;

        if version == 0 {
            // Check if this is an existing v0.3 database (has tables but user_version=0)
            let has_users: bool = conn
                .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'")?
                .exists([])?;

            if has_users {
                // Existing database — run idempotent ALTER TABLEs for columns
                // that may have been added by earlier non-migration code
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
                    let _ = conn.execute_batch(sql);
                }
                // Ensure all tables exist (groups, kernel_sessions, file_history, shared_files
                // may have been created by older code already, but IF NOT EXISTS is safe)
                Self::create_all_tables(conn)?;
                conn.execute_batch("PRAGMA user_version = 1;")?;
            } else {
                // Fresh database — create everything from scratch
                Self::create_all_tables(conn)?;
                conn.execute_batch("PRAGMA user_version = 1;")?;
            }
        }

        // Migration 2 — add `is_disabled` column so admin deactivation
        // actually has a flag to flip. Distinct from
        // `is_active` (which doubles as "seen the dashboard" indicator).
        if version < 2 {
            let _ = conn.execute_batch(
                "ALTER TABLE users ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0",
            );
            conn.execute_batch("PRAGMA user_version = 2;")?;
        }

        // Migration 3 — token version for JWT invalidation on password change,
        // deactivation, and admin-role demotion.
        if version < 3 {
            let _ = conn.execute_batch(
                "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0",
            );
            conn.execute_batch("PRAGMA user_version = 3;")?;
        }

        // Migration 4 — deduplicate `shared_files` and enforce a UNIQUE
        // constraint on (from_user, to_user, file_name). Old `share_file`
        // inserted a new row on every call, so sharing the same notebook
        // twice produced duplicates on the recipient's dashboard.
        if version < 4 {
            conn.execute_batch(
                "DELETE FROM shared_files WHERE id NOT IN (
                     SELECT MIN(id) FROM shared_files
                     GROUP BY from_user, to_user, file_name
                 );
                 CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_files_unique
                     ON shared_files(from_user, to_user, file_name);
                 PRAGMA user_version = 4;",
            )?;
        }

        // Migration 5 — track who created each user (admin attribution) and
        // a per-request `last_seen_at` distinct from `last_active` (which
        // doubles as the "is the user authenticated right now" flag bumped
        // only on session reactivation). The Admin members table needs both.
        if version < 5 {
            let _ = conn.execute_batch(
                "ALTER TABLE users ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
                 ALTER TABLE users ADD COLUMN last_seen_at DATETIME DEFAULT NULL;",
            );
            conn.execute_batch("PRAGMA user_version = 5;")?;
        }

        // Migration 6 — per-kernel CPU % sampled by the metrics task.
        // Stored normalised to whole-machine (0..100) so the Admin panel can
        // render a uniform meter without re-doing the cpu_count division.
        if version < 6 {
            let _ = conn.execute_batch(
                "ALTER TABLE kernel_sessions ADD COLUMN cpu_pct INTEGER NOT NULL DEFAULT 0;",
            );
            conn.execute_batch("PRAGMA user_version = 6;")?;
        }

        // Migration 7 — per-user storage quota in MB. 0 = unlimited (default
        // so existing users don't get capped out the moment the column lands).
        if version < 7 {
            let _ = conn.execute_batch(
                "ALTER TABLE users ADD COLUMN max_storage_mb INTEGER NOT NULL DEFAULT 0;",
            );
            conn.execute_batch("PRAGMA user_version = 7;")?;
        }

        // Migration 8 — activity_events feed. Append-only log read by the
        // Home Activity column. Indexed by `ts DESC` so the most recent N
        // rows come out cheap. Rows older than the trim threshold are
        // pruned periodically by the server (see lib.rs sampler).
        if version < 8 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS activity_events (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                     actor TEXT NOT NULL,
                     kind TEXT NOT NULL,
                     target TEXT NOT NULL DEFAULT '',
                     meta TEXT NOT NULL DEFAULT ''
                 );
                 CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_events(ts DESC);
                 PRAGMA user_version = 8;",
            )?;
        }

        // Migration 9 — profile fields: optional email (used only to derive
        // the Gravatar URL) and a path to a locally-stored avatar PNG.
        // Both columns are TEXT with no default so unset = NULL — the
        // avatar route falls back through the chain (local file → Gravatar
        // proxy → 404 / initial-letter on the frontend) per row.
        //
        // Each ALTER is run in its own statement and the error swallowed —
        // a fresh DB already has these columns courtesy of
        // `create_all_tables`, and an existing DB on user_version=8 needs
        // them added. SQLite has no `ADD COLUMN IF NOT EXISTS`.
        if version < 9 {
            let _ = conn.execute_batch("ALTER TABLE users ADD COLUMN email TEXT");
            let _ = conn.execute_batch("ALTER TABLE users ADD COLUMN avatar_path TEXT");
            conn.execute_batch("PRAGMA user_version = 9;")?;
        }

        Ok(())
    }

    fn create_all_tables(conn: &Connection) -> Result<()> {
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
                email TEXT,
                avatar_path TEXT,
                is_active INTEGER NOT NULL DEFAULT 0,
                is_disabled INTEGER NOT NULL DEFAULT 0,
                token_version INTEGER NOT NULL DEFAULT 0,
                created_by TEXT NOT NULL DEFAULT '',
                last_seen_at DATETIME DEFAULT NULL,
                max_storage_mb INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS activity_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                actor TEXT NOT NULL,
                kind TEXT NOT NULL,
                target TEXT NOT NULL DEFAULT '',
                meta TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_events(ts DESC);

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
                cpu_pct INTEGER NOT NULL DEFAULT 0,
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
            ",
        )?;
        Ok(())
    }

    /// Register a new user. First user is automatically admin. `created_by`
    /// is an empty string for the bootstrap admin and the username of the
    /// admin account that triggered the registration in every other case.
    pub fn register(
        &self,
        username: &str,
        password: &str,
        display_name: &str,
        created_by: &str,
    ) -> Result<User> {
        let username = username.trim().to_lowercase();
        if username.is_empty() || username.len() < 2 {
            bail!("username must be at least 2 characters");
        }
        if password.len() < 8 {
            bail!("password must be at least 8 characters");
        }

        // Compute bcrypt hash BEFORE taking the DB lock — hashing is
        // 100-300ms of pure CPU and should not block other DB readers/writers.
        let hash = bcrypt::hash(password, 12).context("hashing password")?;
        let workspace = cellforge_config::user_workspace_dir(&username);
        std::fs::create_dir_all(&workspace)?;

        let is_admin = !self.has_users(); // first user = admin
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO users (username, password_hash, display_name, workspace_dir, is_admin, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![username, hash, display_name, workspace.to_string_lossy().to_string(), is_admin as i32, created_by],
        ).map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                anyhow::anyhow!("username '{}' already taken", username)
            } else {
                anyhow::anyhow!("register failed: {}", e)
            }
        })?;

        let id = conn.last_insert_rowid();
        Ok(User {
            id,
            username,
            display_name: display_name.to_string(),
            workspace_dir: workspace.to_string_lossy().to_string(),
            is_admin,
            created_at: String::new(),
            created_by: created_by.to_string(),
            last_seen_at: None,
            is_super_admin: id == 1,
            email: None,
            has_avatar: false,
        })
    }

    /// Touch `last_seen_at` for the given user. Called on every authenticated
    /// HTTP request via the auth middleware. Best-effort — failures are
    /// swallowed so a transient lock doesn't fail the request.
    pub fn touch_last_seen(&self, username: &str) {
        let conn = self.conn.lock();
        let _ = conn.execute(
            "UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE username = ?1",
            rusqlite::params![username],
        );
    }

    /// Count users whose `last_seen_at` is within the last `within_seconds`
    /// seconds. Cheap presence proxy — anyone whose browser is up will hit
    /// the dashboard poller every 5s, so a 2-minute window catches everyone
    /// active without flapping on a single tab refresh.
    pub fn count_online(&self, within_seconds: i64) -> i64 {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT COUNT(*) FROM users \
             WHERE last_seen_at IS NOT NULL \
               AND last_seen_at >= datetime('now', ?1)",
            rusqlite::params![format!("-{} seconds", within_seconds)],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
    }

    /// Usernames of online users excluding `me`. Capped at `limit` so the
    /// payload stays bounded on busy workspaces. Used by the Home greeting
    /// to render the "X collaborators online" sub-line with a few example
    /// names.
    pub fn online_others(&self, me: &str, within_seconds: i64, limit: usize) -> Vec<String> {
        let conn = self.conn.lock();
        let mut stmt = match conn.prepare(
            "SELECT username FROM users \
             WHERE username != ?1 \
               AND last_seen_at IS NOT NULL \
               AND last_seen_at >= datetime('now', ?2) \
             ORDER BY last_seen_at DESC \
             LIMIT ?3",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        stmt.query_map(
            rusqlite::params![me, format!("-{} seconds", within_seconds), limit as i64],
            |row| row.get::<_, String>(0),
        )
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    }

    /// Append an activity event. `actor` is the username who performed the
    /// action; `kind` is a short verb (`opened`, `kernel_started`, `shared`,
    /// `saved`, `created_user`); `target` is the affected resource (file
    /// path, kernel id, recipient username); `meta` is optional JSON for
    /// future filters. Append-only — never updated, occasionally pruned.
    pub fn record_activity(&self, actor: &str, kind: &str, target: &str, meta: &str) {
        let conn = self.conn.lock();
        let _ = conn.execute(
            "INSERT INTO activity_events (actor, kind, target, meta) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![actor, kind, target, meta],
        );
    }

    /// Recent activity events visible to `viewer`. The visibility rule is
    /// "everything I did myself + every share whose target is me". A real
    /// permissions matrix (e.g. notebooks shared with me get a feed of all
    /// edits to them) is a future expansion; current scope keeps the noise
    /// down on multi-user workspaces.
    pub fn list_activity(&self, viewer: &str, limit: usize) -> Vec<ActivityEvent> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, ts, actor, kind, target, meta
                 FROM activity_events
                 WHERE actor = ?1
                    OR (kind = 'shared' AND target = ?1)
                 ORDER BY ts DESC
                 LIMIT ?2",
            )
            .unwrap();
        stmt.query_map(rusqlite::params![viewer, limit as i64], |row| {
            Ok(ActivityEvent {
                id: row.get(0)?,
                ts: row.get(1)?,
                actor: row.get(2)?,
                kind: row.get(3)?,
                target: row.get(4)?,
                meta: row.get(5)?,
            })
        })
        .unwrap()
        .flatten()
        .collect()
    }

    /// Drop activity rows older than `keep_days`. Called periodically by a
    /// background task so the table doesn't grow without bound. Indexed by
    /// ts so the delete is cheap.
    pub fn prune_activity(&self, keep_days: i64) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM activity_events WHERE ts < datetime('now', ?1)",
            rusqlite::params![format!("-{} days", keep_days)],
        )?;
        Ok(())
    }

    pub fn login(&self, username: &str, password: &str) -> Result<User> {
        let username = username.trim().to_lowercase();

        // Look up the row under the DB lock, then drop the lock before running
        // bcrypt (100-300ms of pure CPU). Keeping verify outside the lock also
        // lets concurrent readers proceed during a login storm.
        type Row = (i64, String, String, String, String, i32, String);
        let row: Option<Row> = {
            let conn = self.conn.lock();
            let mut stmt = conn.prepare(
                "SELECT id, username, password_hash, display_name, workspace_dir, is_admin, created_at FROM users WHERE username = ?1"
            )?;
            stmt.query_row(rusqlite::params![username], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i32>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })
            .ok()
        };

        // Always run bcrypt::verify — fall back to DUMMY_HASH when the user
        // doesn't exist so both branches pay the same cost-12 cost. This closes
        // the username-enumeration timing side-channel.
        let hash_to_verify: &str = row
            .as_ref()
            .map(|r| r.2.as_str())
            .unwrap_or_else(|| DUMMY_HASH.as_str());

        let verified = bcrypt::verify(password, hash_to_verify).unwrap_or(false);

        // Only accept when BOTH the row existed AND bcrypt verified. A success
        // requires a real row, so the dummy hash can never authenticate even
        // if an attacker somehow supplies the dummy plaintext.
        match row {
            Some((id, uname, _hash, display_name, workspace_dir, is_admin, created_at))
                if verified =>
            {
                Ok(User {
                    id,
                    username: uname,
                    display_name,
                    workspace_dir,
                    is_admin: is_admin != 0,
                    created_at,
                    // Login response doesn't carry these fields; admin views fetch
                    // them via list_users(). Keep the API minimal and let admin
                    // queries pull the full row.
                    created_by: String::new(),
                    last_seen_at: None,
                    is_super_admin: id == 1,
                    email: None,
                    has_avatar: false,
                })
            }
            _ => bail!("invalid username or password"),
        }
    }

    /// Change a user's password. Caller must verify authorization (self or admin).
    /// Bumps token_version in the same write so every outstanding JWT for the
    /// user is rejected on next use.
    pub fn change_password(&self, username: &str, new_password: &str) -> Result<()> {
        if new_password.len() < 8 {
            bail!("password must be at least 8 characters");
        }
        // Compute bcrypt hash BEFORE taking the DB lock — hashing is
        // 100-300ms of pure CPU and should not block other DB readers/writers.
        let hash = bcrypt::hash(new_password, 12).context("hashing password")?;
        let conn = self.conn.lock();
        let rows = conn.execute(
            "UPDATE users
             SET password_hash = ?1, token_version = token_version + 1
             WHERE username = ?2",
            rusqlite::params![hash, username.trim().to_lowercase()],
        )?;
        if rows == 0 {
            bail!("user not found");
        }
        Ok(())
    }

    pub fn get_user(&self, username: &str) -> Result<User> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, username, display_name, workspace_dir, is_admin, created_at, created_by, last_seen_at, email, avatar_path FROM users WHERE username = ?1"
        )?;

        stmt.query_row(rusqlite::params![username], |row| {
            let id: i64 = row.get(0)?;
            let avatar_path: Option<String> = row.get(9)?;
            Ok(User {
                id,
                username: row.get(1)?,
                display_name: row.get(2)?,
                workspace_dir: row.get(3)?,
                is_admin: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
                created_by: row.get(6)?,
                last_seen_at: row.get(7)?,
                is_super_admin: id == 1,
                email: row.get(8)?,
                has_avatar: avatar_path.is_some(),
            })
        })
        .map_err(|_| anyhow::anyhow!("user not found"))
    }

    pub fn list_users(&self) -> Vec<User> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, username, display_name, workspace_dir, is_admin, created_at, created_by, last_seen_at, email, avatar_path FROM users ORDER BY id"
        ).unwrap();

        stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let avatar_path: Option<String> = row.get(9)?;
            Ok(User {
                id,
                username: row.get(1)?,
                display_name: row.get(2)?,
                workspace_dir: row.get(3)?,
                is_admin: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
                created_by: row.get(6)?,
                last_seen_at: row.get(7)?,
                is_super_admin: id == 1,
                email: row.get(8)?,
                has_avatar: avatar_path.is_some(),
            })
        })
        .unwrap()
        .flatten()
        .collect()
    }

    /// Set the user's email (used solely for the Gravatar fallback URL).
    /// Pass `None` to clear it.
    pub fn set_email(&self, username: &str, email: Option<&str>) -> Result<()> {
        let normalized = email
            .map(|e| e.trim().to_lowercase())
            .filter(|e| !e.is_empty());
        let conn = self.conn.lock();
        let rows = conn.execute(
            "UPDATE users SET email = ?1 WHERE username = ?2",
            rusqlite::params![normalized, username],
        )?;
        if rows == 0 {
            bail!("user not found");
        }
        Ok(())
    }

    /// Record / clear the on-disk avatar location. Caller is responsible
    /// for writing or removing the actual file before/after the DB update.
    pub fn set_avatar_path(&self, username: &str, path: Option<&str>) -> Result<()> {
        let conn = self.conn.lock();
        let rows = conn.execute(
            "UPDATE users SET avatar_path = ?1 WHERE username = ?2",
            rusqlite::params![path, username],
        )?;
        if rows == 0 {
            bail!("user not found");
        }
        Ok(())
    }

    /// Look up the absolute avatar path for the given user, if any. Returns
    /// `None` for users that haven't uploaded one — callers fall through
    /// to the Gravatar / initial-letter chain.
    pub fn avatar_path(&self, username: &str) -> Option<String> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT avatar_path FROM users WHERE username = ?1",
            rusqlite::params![username],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    }

    /// Look up the email for Gravatar derivation. Lowercased / trimmed at
    /// write time so the SHA-256 hash is stable.
    pub fn email_for(&self, username: &str) -> Option<String> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT email FROM users WHERE username = ?1",
            rusqlite::params![username],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    }

    /// Delete a user. By default refuses to drop admins (the auth route
    /// uses this for normal admin → non-admin removals). The super admin
    /// route passes `force = true` to bypass the guard, but the bootstrap
    /// admin (`id = 1`) is still untouchable — there's deliberately no way
    /// to remove the workspace owner from inside the app.
    ///
    /// Cascades:
    /// - the user's workspace directory is removed from disk (notebooks,
    ///   uploaded files, anything the user dropped in there);
    /// - all dependent rows (kernel_sessions, shared_files, file_history,
    ///   activity_events) referencing this user are dropped.
    ///
    /// Best-effort on filesystem errors — a single permission glitch
    /// shouldn't strand a half-deleted user in the DB. Workspace removal
    /// happens before the row delete so the dangling path can never get
    /// orphaned (lookup by `username` would 404 mid-cleanup).
    pub fn delete_user(&self, username: &str, force: bool) -> Result<()> {
        // Capture the workspace path BEFORE we drop the row — afterwards
        // get_user would 404. Also serves as a precondition check: a
        // missing user is a no-op, not an error.
        let workspace = match self.get_user(username) {
            Ok(u) => Some(u.workspace_dir),
            Err(_) => None,
        };

        let conn = self.conn.lock();

        // Single transaction so we don't end up with a deleted user row
        // but lingering kernel sessions if the second statement trips.
        let tx = conn.unchecked_transaction()?;

        // Refuse to delete admins or the bootstrap super admin per the
        // existing rule. force=false also blocks admin removal.
        let row_filter = if force {
            "DELETE FROM users WHERE username = ?1 AND id != 1"
        } else {
            "DELETE FROM users WHERE username = ?1 AND is_admin = 0"
        };
        let removed = tx.execute(row_filter, rusqlite::params![username])?;
        if removed == 0 {
            // Either the user didn't exist or the role guard rejected the
            // delete. Nothing else to clean up — bail without touching
            // disk or related tables.
            tx.rollback()?;
            return Ok(());
        }

        // Cascade DB rows. None of these are critical-path; orphans are
        // ugly but not load-bearing, so we swallow individual errors.
        let _ = tx.execute(
            "DELETE FROM kernel_sessions WHERE username = ?1",
            rusqlite::params![username],
        );
        let _ = tx.execute(
            "DELETE FROM shared_files WHERE from_user = ?1 OR to_user = ?1",
            rusqlite::params![username],
        );
        let _ = tx.execute(
            "DELETE FROM file_history WHERE username = ?1",
            rusqlite::params![username],
        );
        let _ = tx.execute(
            "DELETE FROM activity_events WHERE actor = ?1 OR target = ?1",
            rusqlite::params![username],
        );

        tx.commit()?;
        drop(conn);

        // Workspace wipe: full recursive removal. Logged on failure but
        // doesn't fail the operation — the user row is already gone, so
        // recovery is just running `rm -rf` on the leftover path manually.
        if let Some(dir) = workspace
            && !dir.is_empty()
        {
            let path = std::path::PathBuf::from(&dir);
            if path.exists()
                && let Err(e) = std::fs::remove_dir_all(&path)
            {
                tracing::warn!("delete_user: removing workspace {dir} failed: {e}");
            }
        }

        Ok(())
    }

    /// True iff `username` is the bootstrap admin — the user with `id = 1`,
    /// created during initial workspace setup. The super admin can demote
    /// other admins and delete any user; nothing can remove or demote them.
    pub fn is_super_admin(&self, username: &str) -> bool {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT id = 1 FROM users WHERE username = ?1",
            rusqlite::params![username],
            |row| row.get::<_, i64>(0),
        )
        .map(|v| v != 0)
        .unwrap_or(false)
    }

    pub fn has_users(&self) -> bool {
        let conn = self.conn.lock();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
            .unwrap_or(0);
        count > 0
    }

    // -- file history --

    /// Save history entry. `changed_cells` is a JSON string describing what changed.
    pub fn save_history(
        &self,
        file_path: &str,
        username: &str,
        action: &str,
        snapshot: &str,
        changed_cells: &str,
    ) -> Result<i64> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO file_history (file_path, username, action, snapshot, changed_cells) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![file_path, username, action, snapshot, changed_cells],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Get the most recent snapshot for a file (to compute diffs).
    pub fn last_snapshot(&self, file_path: &str) -> Option<String> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT snapshot FROM file_history WHERE file_path = ?1 ORDER BY id DESC LIMIT 1",
            rusqlite::params![file_path],
            |row| row.get(0),
        )
        .ok()
    }

    pub fn get_history(&self, file_path: &str, limit: usize) -> Vec<HistoryEntry> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, username, action, changed_cells, created_at FROM file_history WHERE file_path = ?1 ORDER BY id DESC LIMIT ?2"
        ).unwrap();
        stmt.query_map(rusqlite::params![file_path, limit as i64], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                username: row.get(1)?,
                action: row.get(2)?,
                changed_cells: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .unwrap()
        .flatten()
        .collect()
    }

    pub fn get_snapshot(&self, id: i64) -> Result<String> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT snapshot FROM file_history WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|_| anyhow::anyhow!("snapshot not found"))
    }

    /// Share a file with another user (copies it to their workspace).
    pub fn share_file(
        &self,
        from: &str,
        to: &str,
        file_name: &str,
        src_path: &std::path::Path,
    ) -> Result<()> {
        // symlink to original file in target user's workspace
        let target_user = self.get_user(to)?;
        let dest = std::path::PathBuf::from(&target_user.workspace_dir).join(file_name);
        let src_abs = std::fs::canonicalize(src_path).unwrap_or(src_path.to_path_buf());
        // remove existing if any
        let _ = std::fs::remove_file(&dest);
        #[cfg(unix)]
        std::os::unix::fs::symlink(&src_abs, &dest).context("creating symlink")?;
        #[cfg(not(unix))]
        std::fs::copy(&src_abs, &dest).context("copying shared file")?;

        {
            let conn = self.conn.lock();
            conn.execute(
                "INSERT INTO shared_files (from_user, to_user, file_name, file_path)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(from_user, to_user, file_name)
                 DO UPDATE SET file_path = excluded.file_path,
                               shared_at = CURRENT_TIMESTAMP",
                rusqlite::params![from, to, file_name, dest.to_string_lossy().to_string()],
            )?;
        }
        // Activity feed: visible to both `from` (their own action) and `to`
        // (target = recipient). list_activity's WHERE matches actor=viewer
        // OR (kind='shared' AND target=viewer), so this single row covers both.
        self.record_activity(from, "shared", to, file_name);
        Ok(())
    }

    /// List files shared with a user.
    pub fn shared_with(&self, username: &str) -> Vec<SharedFile> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, from_user, file_name, shared_at FROM shared_files WHERE to_user = ?1 ORDER BY shared_at DESC"
        ).unwrap();
        stmt.query_map(rusqlite::params![username], |row| {
            Ok(SharedFile {
                id: row.get(0)?,
                from_user: row.get(1)?,
                file_name: row.get(2)?,
                shared_at: row.get(3)?,
            })
        })
        .unwrap()
        .flatten()
        .collect()
    }

    /// List outbound shares of a specific file owned by `from_user`.
    /// Used by the share dialog to show who a file is already shared with.
    pub fn shares_by_me_of(&self, from_user: &str, file_name: &str) -> Vec<OutboundShare> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, to_user FROM shared_files
                 WHERE from_user = ?1 AND file_name = ?2
                 ORDER BY to_user",
            )
            .unwrap();
        stmt.query_map(rusqlite::params![from_user, file_name], |row| {
            Ok(OutboundShare {
                id: row.get(0)?,
                to_user: row.get(1)?,
            })
        })
        .unwrap()
        .flatten()
        .collect()
    }

    /// Remove a share (delete symlink + DB record).
    pub fn unshare_file(&self, share_id: i64) -> Result<()> {
        let conn = self.conn.lock();
        // get file_path to remove symlink
        let path: Option<String> = conn
            .query_row(
                "SELECT file_path FROM shared_files WHERE id = ?1",
                rusqlite::params![share_id],
                |row| row.get(0),
            )
            .ok();
        if let Some(p) = path {
            let _ = std::fs::remove_file(&p);
        }
        conn.execute(
            "DELETE FROM shared_files WHERE id = ?1",
            rusqlite::params![share_id],
        )?;
        Ok(())
    }

    /// Update symlinks when a shared file is renamed.
    pub fn update_shared_file_rename(
        &self,
        from_user: &str,
        old_name: &str,
        new_name: &str,
        new_src_path: &std::path::Path,
    ) {
        // Collect data in one lock, then release before calling get_user (avoids deadlock)
        let rows: Vec<(i64, String, String)> = {
            let conn = self.conn.lock();
            let mut stmt = conn
                .prepare("SELECT id, to_user, file_path FROM shared_files WHERE from_user = ?1 AND file_name = ?2")
                .unwrap();
            stmt.query_map(rusqlite::params![from_user, old_name], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .unwrap()
            .flatten()
            .collect()
        }; // conn lock dropped here

        let new_src_abs = std::fs::canonicalize(new_src_path).unwrap_or(new_src_path.to_path_buf());

        for (id, to_user, old_path) in rows {
            let _ = std::fs::remove_file(&old_path);
            // get_user takes its own lock — safe now
            if let Ok(target_user) = self.get_user(&to_user) {
                let new_dest = std::path::PathBuf::from(&target_user.workspace_dir).join(new_name);
                #[cfg(unix)]
                let _ = std::os::unix::fs::symlink(&new_src_abs, &new_dest);
                #[cfg(not(unix))]
                let _ = std::fs::copy(&new_src_abs, &new_dest);
                // update DB with new lock
                let conn = self.conn.lock();
                let _ = conn.execute(
                    "UPDATE shared_files SET file_name = ?1, file_path = ?2 WHERE id = ?3",
                    rusqlite::params![new_name, new_dest.to_string_lossy().to_string(), id],
                );
            }
        }
    }

    // ── Hub: groups ──────────────────────────────────────────────────

    pub fn create_group(
        &self,
        name: &str,
        description: &str,
        max_kernels: i64,
        max_memory_mb: i64,
    ) -> Result<Group> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO groups (name, description, max_kernels_per_user, max_memory_mb_per_user) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![name, description, max_kernels, max_memory_mb],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Group {
            id,
            name: name.to_string(),
            description: description.to_string(),
            max_kernels_per_user: max_kernels,
            max_memory_mb_per_user: max_memory_mb,
            created_at: String::new(),
        })
    }

    pub fn list_groups(&self) -> Vec<Group> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT id, name, description, max_kernels_per_user, max_memory_mb_per_user, created_at FROM groups ORDER BY name")
            .unwrap();
        stmt.query_map([], |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                max_kernels_per_user: row.get(3)?,
                max_memory_mb_per_user: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .unwrap()
        .flatten()
        .collect()
    }

    pub fn update_group(
        &self,
        name: &str,
        description: &str,
        max_kernels: i64,
        max_memory_mb: i64,
    ) -> Result<()> {
        let conn = self.conn.lock();
        let rows = conn.execute(
            "UPDATE groups SET description = ?1, max_kernels_per_user = ?2, max_memory_mb_per_user = ?3 WHERE name = ?4",
            rusqlite::params![description, max_kernels, max_memory_mb, name],
        )?;
        if rows == 0 {
            bail!("group '{}' not found", name);
        }
        Ok(())
    }

    pub fn delete_group(&self, name: &str) -> Result<()> {
        let conn = self.conn.lock();
        // clear group_name on users that belong to this group
        conn.execute(
            "UPDATE users SET group_name = '' WHERE group_name = ?1",
            rusqlite::params![name],
        )?;
        conn.execute(
            "DELETE FROM groups WHERE name = ?1",
            rusqlite::params![name],
        )?;
        Ok(())
    }

    // ── Hub: user limits ─────────────────────────────────────────────

    pub fn update_user_limits(
        &self,
        username: &str,
        max_kernels: i64,
        max_memory_mb: i64,
        group_name: &str,
        max_storage_mb: i64,
    ) -> Result<()> {
        let conn = self.conn.lock();
        let rows = conn.execute(
            "UPDATE users SET max_kernels = ?1, max_memory_mb = ?2, group_name = ?3, max_storage_mb = ?4 WHERE username = ?5",
            rusqlite::params![max_kernels, max_memory_mb, group_name, max_storage_mb, username],
        )?;
        if rows == 0 {
            bail!("user '{}' not found", username);
        }
        Ok(())
    }

    /// Return effective limits for a user. Per-user overrides take priority;
    /// if both are 0 the group defaults are used instead. Storage is tracked
    /// per-user only — groups don't (yet) carry a storage cap.
    pub fn get_user_limits(&self, username: &str) -> Result<UserLimits> {
        let conn = self.conn.lock();
        let (max_kernels, max_memory_mb, group_name, max_storage_mb): (i64, i64, String, i64) = conn
            .query_row(
                "SELECT max_kernels, max_memory_mb, group_name, max_storage_mb FROM users WHERE username = ?1",
                rusqlite::params![username],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|_| anyhow::anyhow!("user not found"))?;

        // If user has explicit overrides, use them
        if max_kernels > 0 || max_memory_mb > 0 {
            return Ok(UserLimits {
                max_kernels,
                max_memory_mb,
                group_name,
                max_storage_mb,
            });
        }

        // Fall back to group limits (kernels + memory only — storage stays
        // per-user since the group schema doesn't have a storage column).
        if !group_name.is_empty()
            && let Ok((gk, gm)) = conn.query_row(
                "SELECT max_kernels_per_user, max_memory_mb_per_user FROM groups WHERE name = ?1",
                rusqlite::params![group_name],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
        {
            return Ok(UserLimits {
                max_kernels: gk,
                max_memory_mb: gm,
                group_name,
                max_storage_mb,
            });
        }

        Ok(UserLimits {
            max_kernels: 0,
            max_memory_mb: 0,
            group_name,
            max_storage_mb,
        })
    }

    pub fn touch_user_active(&self, username: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE users SET last_active = CURRENT_TIMESTAMP, is_active = 1 WHERE username = ?1",
            rusqlite::params![username],
        )?;
        Ok(())
    }

    pub fn user_is_active(&self, username: &str) -> bool {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT is_active FROM users WHERE username = ?1",
            rusqlite::params![username],
            |row| row.get::<_, i32>(0),
        )
        .map(|v| v != 0)
        .unwrap_or(false)
    }

    /// Mark the account disabled — cannot authenticate until re-enabled.
    /// Also bumps `token_version` so any outstanding JWTs are rejected on
    /// next use.
    pub fn deactivate_user(&self, username: &str) -> Result<()> {
        let conn = self.conn.lock();
        let rows = conn.execute(
            "UPDATE users
             SET is_disabled = 1, token_version = token_version + 1
             WHERE username = ?1",
            rusqlite::params![username],
        )?;
        if rows == 0 {
            bail!("user not found");
        }
        Ok(())
    }

    /// Reverse a previous deactivation. Does not bump token_version —
    /// re-enabling an account shouldn't retroactively un-revoke its old
    /// sessions (they should have been rejected while disabled, and a
    /// password change or explicit logout already owns that invariant).
    pub fn reactivate_user(&self, username: &str) -> Result<()> {
        let conn = self.conn.lock();
        let rows = conn.execute(
            "UPDATE users SET is_disabled = 0 WHERE username = ?1",
            rusqlite::params![username],
        )?;
        if rows == 0 {
            bail!("user not found");
        }
        Ok(())
    }

    pub fn user_is_disabled(&self, username: &str) -> bool {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT is_disabled FROM users WHERE username = ?1",
            rusqlite::params![username],
            |row| row.get::<_, i32>(0),
        )
        .map(|v| v != 0)
        .unwrap_or(false)
    }

    /// Current token_version for JWT invalidation checks. Defaults to 0
    /// for accounts predating the token_version migration.
    pub fn user_token_version(&self, username: &str) -> i64 {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT token_version FROM users WHERE username = ?1",
            rusqlite::params![username],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
    }

    /// Bump token_version — invalidates every outstanding JWT for this
    /// user. Called internally by `deactivate_user` and should be called
    /// explicitly on password change and role demotion.
    pub fn bump_token_version(&self, username: &str) -> Result<()> {
        let conn = self.conn.lock();
        let rows = conn.execute(
            "UPDATE users SET token_version = token_version + 1 WHERE username = ?1",
            rusqlite::params![username],
        )?;
        if rows == 0 {
            bail!("user not found");
        }
        Ok(())
    }

    /// Set or unset the admin flag for a user. When demoting (admin → not),
    /// also bumps token_version so any outstanding JWTs encoding the admin
    /// claim are invalidated on next use. Promoting doesn't bump because
    /// outstanding tokens already encode at-most the user's prior privileges.
    pub fn set_admin(&self, username: &str, is_admin: bool) -> Result<()> {
        let conn = self.conn.lock();
        let rows = if is_admin {
            conn.execute(
                "UPDATE users SET is_admin = 1 WHERE username = ?1",
                rusqlite::params![username],
            )?
        } else {
            conn.execute(
                "UPDATE users SET is_admin = 0, token_version = token_version + 1 WHERE username = ?1",
                rusqlite::params![username],
            )?
        };
        if rows == 0 {
            bail!("user not found");
        }
        Ok(())
    }

    // ── Hub: kernel sessions ─────────────────────────────────────────

    pub fn register_kernel_session(
        &self,
        id: &str,
        username: &str,
        kernel_spec: &str,
        language: &str,
        notebook_path: &str,
    ) -> Result<()> {
        {
            let conn = self.conn.lock();
            conn.execute(
                "INSERT OR REPLACE INTO kernel_sessions (id, username, kernel_spec, language, notebook_path) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![id, username, kernel_spec, language, notebook_path],
            )?;
        }
        self.record_activity(username, "kernel_started", notebook_path, language);
        Ok(())
    }

    pub fn remove_kernel_session(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM kernel_sessions WHERE id = ?1",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    pub fn update_kernel_session_status(&self, id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE kernel_sessions SET status = ?1, last_active = CURRENT_TIMESTAMP WHERE id = ?2",
            rusqlite::params![status, id],
        )?;
        Ok(())
    }

    /// Update memory + CPU for a live kernel. Called periodically by the
    /// server's metrics sampler so the admin panel reflects current usage.
    /// `cpu_pct` is normalised to whole-machine (0..100).
    pub fn update_kernel_session_metrics(
        &self,
        id: &str,
        memory_mb: i64,
        cpu_pct: i64,
    ) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE kernel_sessions SET memory_mb = ?1, cpu_pct = ?2 WHERE id = ?3",
            rusqlite::params![memory_mb, cpu_pct, id],
        )?;
        Ok(())
    }

    /// Remove every kernel_sessions row. Called once at server startup — any
    /// rows present are leftovers from a previous run (server crashed, kernel
    /// exit path didn't run, etc.) and would otherwise inflate admin totals
    /// with stale `memory_mb` values from long-dead processes.
    pub fn clear_kernel_sessions(&self) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM kernel_sessions", [])?;
        Ok(())
    }

    /// Delete kernel_sessions rows whose id isn't in `live_ids`. Called by
    /// the memory sampler so that kernels that died mid-run (without the WS
    /// handler getting to `remove_kernel_session`) are pruned and no longer
    /// contribute to the admin totals.
    pub fn prune_kernel_sessions(
        &self,
        live_ids: &std::collections::HashSet<String>,
    ) -> Result<()> {
        let conn = self.conn.lock();
        let existing_ids: Vec<String> = {
            let mut stmt = conn.prepare("SELECT id FROM kernel_sessions")?;
            stmt.query_map([], |row| row.get::<_, String>(0))?
                .flatten()
                .collect()
        };
        for id in existing_ids {
            if !live_ids.contains(&id) {
                let _ = conn.execute(
                    "DELETE FROM kernel_sessions WHERE id = ?1",
                    rusqlite::params![id],
                );
            }
        }
        Ok(())
    }

    pub fn list_kernel_sessions(&self) -> Vec<KernelSession> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, username, kernel_spec, language, notebook_path, started_at, last_active, memory_mb, cpu_pct, status FROM kernel_sessions ORDER BY started_at DESC",
            )
            .unwrap();
        stmt.query_map([], |row| {
            Ok(KernelSession {
                id: row.get(0)?,
                username: row.get(1)?,
                kernel_spec: row.get(2)?,
                language: row.get(3)?,
                notebook_path: row.get(4)?,
                started_at: row.get(5)?,
                last_active: row.get(6)?,
                memory_mb: row.get(7)?,
                cpu_pct: row.get(8)?,
                status: row.get(9)?,
            })
        })
        .unwrap()
        .flatten()
        .collect()
    }

    pub fn kernel_count_for_user(&self, username: &str) -> i64 {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT COUNT(*) FROM kernel_sessions WHERE username = ?1 AND status = 'running'",
            rusqlite::params![username],
            |row| row.get(0),
        )
        .unwrap_or(0)
    }

    // ── Hub: recent notebooks ────────────────────────────────────────

    /// Return recently saved .ipynb files for a user from file_history.
    pub fn recent_notebooks(&self, username: &str, limit: usize) -> Vec<RecentNotebook> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare(
                "SELECT file_path, MAX(created_at) as last_opened \
                 FROM file_history \
                 WHERE username = ?1 AND file_path LIKE '%.ipynb' \
                 GROUP BY file_path \
                 ORDER BY last_opened DESC \
                 LIMIT ?2",
            )
            .unwrap();
        stmt.query_map(rusqlite::params![username, limit as i64], |row| {
            Ok(RecentNotebook {
                file_path: row.get(0)?,
                last_opened: row.get(1)?,
            })
        })
        .unwrap()
        .flatten()
        .collect()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub username: String,
    pub action: String,
    pub changed_cells: String, // JSON: [{"cell_id": "...", "change": "edited|added|deleted", "summary": "..."}]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SharedFile {
    pub id: i64,
    pub from_user: String,
    pub file_name: String,
    pub shared_at: String,
}

/// Row returned by `shares_by_me_of` — the minimal view the share dialog
/// needs to render an "already shared with" list with unshare buttons.
#[derive(Debug, Clone, Serialize)]
pub struct OutboundShare {
    pub id: i64,
    pub to_user: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ActivityEvent {
    pub id: i64,
    /// SQLite UTC timestamp without TZ marker. Frontend appends 'Z' to parse correctly.
    pub ts: String,
    pub actor: String,
    /// Short verb: `opened`, `kernel_started`, `shared`, `saved`, `created_user`, etc.
    pub kind: String,
    /// Resource the action targeted — file path, recipient username, kernel id.
    pub target: String,
    /// Optional JSON for future filters (kernel language, file size). Empty by default.
    pub meta: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Group {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub max_kernels_per_user: i64,
    pub max_memory_mb_per_user: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserLimits {
    pub max_kernels: i64,
    pub max_memory_mb: i64,
    pub group_name: String,
    /// Per-user storage cap in megabytes; 0 means unlimited.
    #[serde(default)]
    pub max_storage_mb: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct KernelSession {
    pub id: String,
    pub username: String,
    pub kernel_spec: String,
    pub language: String,
    pub notebook_path: String,
    pub started_at: String,
    pub last_active: String,
    pub memory_mb: i64,
    /// CPU usage normalised to whole-machine (0..100). Sampled by the
    /// metrics task; updated alongside `memory_mb` every interval.
    #[serde(default)]
    pub cpu_pct: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecentNotebook {
    pub file_path: String,
    pub last_opened: String,
}
