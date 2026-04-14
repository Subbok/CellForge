use anyhow::{Context, Result, bail};
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;

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
}

impl UserDb {
    pub fn open() -> Result<Self> {
        let dir = cellforge_config::config_dir();
        std::fs::create_dir_all(&dir)?;
        let db_path = dir.join("users.db");

        let conn = Connection::open(&db_path)
            .with_context(|| format!("opening db at {}", db_path.display()))?;

        conn.execute_batch("PRAGMA journal_mode=WAL;")?;

        Self::run_migrations(&conn)?;

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

        // Future migrations:
        // if version < 2 {
        //     conn.execute_batch("ALTER TABLE ... ; PRAGMA user_version = 2;")?;
        // }

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
            ",
        )?;
        Ok(())
    }

    /// Register a new user. First user is automatically admin.
    pub fn register(&self, username: &str, password: &str, display_name: &str) -> Result<User> {
        let username = username.trim().to_lowercase();
        if username.is_empty() || username.len() < 2 {
            bail!("username must be at least 2 characters");
        }
        if password.len() < 4 {
            bail!("password must be at least 4 characters");
        }

        let is_admin = !self.has_users(); // first user = admin
        let hash = bcrypt::hash(password, 10).context("hashing password")?;
        let workspace = cellforge_config::user_workspace_dir(&username);
        std::fs::create_dir_all(&workspace)?;

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users (username, password_hash, display_name, workspace_dir, is_admin) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![username, hash, display_name, workspace.to_string_lossy().to_string(), is_admin as i32],
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
        })
    }

    pub fn login(&self, username: &str, password: &str) -> Result<User> {
        let username = username.trim().to_lowercase();
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, username, password_hash, display_name, workspace_dir, is_admin, created_at FROM users WHERE username = ?1"
        )?;

        let row = stmt
            .query_row(rusqlite::params![username], |row| {
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
            .map_err(|_| anyhow::anyhow!("invalid username or password"))?;

        let (id, username, hash, display_name, workspace_dir, is_admin, created_at) = row;

        if !bcrypt::verify(password, &hash).unwrap_or(false) {
            bail!("invalid username or password");
        }

        Ok(User {
            id,
            username,
            display_name,
            workspace_dir,
            is_admin: is_admin != 0,
            created_at,
        })
    }

    /// Change a user's password. Caller must verify authorization (self or admin).
    pub fn change_password(&self, username: &str, new_password: &str) -> Result<()> {
        if new_password.len() < 4 {
            bail!("password must be at least 4 characters");
        }
        let hash = bcrypt::hash(new_password, 10).context("hashing password")?;
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute(
            "UPDATE users SET password_hash = ?1 WHERE username = ?2",
            rusqlite::params![hash, username.trim().to_lowercase()],
        )?;
        if rows == 0 {
            bail!("user not found");
        }
        Ok(())
    }

    pub fn get_user(&self, username: &str) -> Result<User> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, username, display_name, workspace_dir, is_admin, created_at FROM users WHERE username = ?1"
        )?;

        stmt.query_row(rusqlite::params![username], |row| {
            Ok(User {
                id: row.get(0)?,
                username: row.get(1)?,
                display_name: row.get(2)?,
                workspace_dir: row.get(3)?,
                is_admin: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
            })
        })
        .map_err(|_| anyhow::anyhow!("user not found"))
    }

    pub fn list_users(&self) -> Vec<User> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, username, display_name, workspace_dir, is_admin, created_at FROM users ORDER BY id"
        ).unwrap();

        stmt.query_map([], |row| {
            Ok(User {
                id: row.get(0)?,
                username: row.get(1)?,
                display_name: row.get(2)?,
                workspace_dir: row.get(3)?,
                is_admin: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
            })
        })
        .unwrap()
        .flatten()
        .collect()
    }

    pub fn delete_user(&self, username: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM users WHERE username = ?1 AND is_admin = 0",
            rusqlite::params![username],
        )?;
        Ok(())
    }

    pub fn has_users(&self) -> bool {
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO file_history (file_path, username, action, snapshot, changed_cells) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![file_path, username, action, snapshot, changed_cells],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Get the most recent snapshot for a file (to compute diffs).
    pub fn last_snapshot(&self, file_path: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT snapshot FROM file_history WHERE file_path = ?1 ORDER BY id DESC LIMIT 1",
            rusqlite::params![file_path],
            |row| row.get(0),
        )
        .ok()
    }

    pub fn get_history(&self, file_path: &str, limit: usize) -> Vec<HistoryEntry> {
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO shared_files (from_user, to_user, file_name, file_path) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![from, to, file_name, dest.to_string_lossy().to_string()],
        )?;
        Ok(())
    }

    /// List files shared with a user.
    pub fn shared_with(&self, username: &str) -> Vec<SharedFile> {
        let conn = self.conn.lock().unwrap();
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

    /// Remove a share (delete symlink + DB record).
    pub fn unshare_file(&self, share_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
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
            let conn = self.conn.lock().unwrap();
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
                let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute(
            "UPDATE users SET max_kernels = ?1, max_memory_mb = ?2, group_name = ?3 WHERE username = ?4",
            rusqlite::params![max_kernels, max_memory_mb, group_name, username],
        )?;
        if rows == 0 {
            bail!("user '{}' not found", username);
        }
        Ok(())
    }

    /// Return effective limits for a user. Per-user overrides take priority;
    /// if both are 0 the group defaults are used instead.
    pub fn get_user_limits(&self, username: &str) -> Result<UserLimits> {
        let conn = self.conn.lock().unwrap();
        let (max_kernels, max_memory_mb, group_name): (i64, i64, String) = conn
            .query_row(
                "SELECT max_kernels, max_memory_mb, group_name FROM users WHERE username = ?1",
                rusqlite::params![username],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| anyhow::anyhow!("user not found"))?;

        // If user has explicit overrides, use them
        if max_kernels > 0 || max_memory_mb > 0 {
            return Ok(UserLimits {
                max_kernels,
                max_memory_mb,
                group_name,
            });
        }

        // Fall back to group limits
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
            });
        }

        Ok(UserLimits {
            max_kernels: 0,
            max_memory_mb: 0,
            group_name,
        })
    }

    pub fn touch_user_active(&self, username: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE users SET last_active = CURRENT_TIMESTAMP, is_active = 1 WHERE username = ?1",
            rusqlite::params![username],
        )?;
        Ok(())
    }

    pub fn user_is_active(&self, username: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT is_active FROM users WHERE username = ?1",
            rusqlite::params![username],
            |row| row.get::<_, i32>(0),
        )
        .map(|v| v != 0)
        .unwrap_or(false)
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
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO kernel_sessions (id, username, kernel_spec, language, notebook_path) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, username, kernel_spec, language, notebook_path],
        )?;
        Ok(())
    }

    pub fn remove_kernel_session(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM kernel_sessions WHERE id = ?1",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    pub fn update_kernel_session_status(&self, id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE kernel_sessions SET status = ?1, last_active = CURRENT_TIMESTAMP WHERE id = ?2",
            rusqlite::params![status, id],
        )?;
        Ok(())
    }

    pub fn list_kernel_sessions(&self) -> Vec<KernelSession> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, username, kernel_spec, language, notebook_path, started_at, last_active, memory_mb, status FROM kernel_sessions ORDER BY started_at DESC",
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
                status: row.get(8)?,
            })
        })
        .unwrap()
        .flatten()
        .collect()
    }

    pub fn kernel_count_for_user(&self, username: &str) -> i64 {
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
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
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecentNotebook {
    pub file_path: String,
    pub last_opened: String,
}

