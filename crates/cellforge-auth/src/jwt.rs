use anyhow::{Context, Result};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // username
    pub exp: usize,  // expiry timestamp
    pub iat: usize,  // issued at
    /// Token-version epoch. Bumped on password change, admin-disable, and
    /// admin-role demotion. The auth middleware rejects tokens whose `tv`
    /// is less than the current DB value, invalidating every outstanding
    /// JWT for that user in one write. `#[serde(default)]` keeps older
    /// tokens that predate the column from breaking during rollout — they
    /// carry `tv = 0`, matching the column default.
    #[serde(default)]
    pub tv: i64,
}

// secret key — generated once per server lifetime, stored in memory.
// if you restart the server, all sessions expire. that's fine.
static SECRET: OnceLock<Vec<u8>> = OnceLock::new();

fn secret() -> &'static [u8] {
    SECRET.get_or_init(|| {
        let dir = cellforge_config::config_dir();
        let key_path = dir.join("jwt_secret");

        // Try to read an existing key. Three branches matter:
        //  - long-enough file → reuse it (the normal path)
        //  - file present but too short → DO NOT overwrite. A short file is
        //    either a partial write from a previous crash or another process
        //    mid-creation. Silently regenerating would invalidate every live
        //    session AND race with the other writer, so we panic with a clear
        //    message telling the operator what to do.
        //  - NotFound → fall through to generation
        match std::fs::read(&key_path) {
            Ok(key) if key.len() >= 32 => return key,
            Ok(key) => {
                panic!(
                    "JWT secret at {} is only {} bytes (need ≥32). Refusing to \
                    overwrite — remove the file manually to regenerate (every \
                    active session will be logged out) or restore from backup.",
                    key_path.display(),
                    key.len()
                );
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                panic!("could not read jwt_secret at {}: {e}", key_path.display());
            }
            Err(_) => {} // NotFound — generate below
        }

        let mut key = vec![0u8; 64];
        getrandom::fill(&mut key).expect("getrandom failed — system entropy pool unavailable");
        let _ = std::fs::create_dir_all(&dir);

        // Atomic install: write to a sibling temp file with restrictive perms,
        // then `hard_link` it into place. `hard_link` refuses if the target
        // already exists — so if a second server instance won the startup race
        // we don't overwrite its secret; we read its key back instead.
        let tmp_path = dir.join(format!(
            "jwt_secret.{}.{}.tmp",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));

        if let Err(e) = std::fs::write(&tmp_path, &key) {
            tracing::error!(
                "could not stage jwt_secret tmp at {}: {e}",
                tmp_path.display()
            );
            return key;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600));
        }
        match std::fs::hard_link(&tmp_path, &key_path) {
            Ok(()) => {
                let _ = std::fs::remove_file(&tmp_path);
                key
            }
            Err(_) => {
                // Lost the race; another instance created the file. Use its
                // key so both processes agree on the same secret — otherwise
                // tokens minted by one would fail verification by the other.
                let _ = std::fs::remove_file(&tmp_path);
                match std::fs::read(&key_path) {
                    Ok(other) if other.len() >= 32 => other,
                    _ => {
                        tracing::error!(
                            "lost jwt_secret race but winner's file at {} is unreadable",
                            key_path.display()
                        );
                        key
                    }
                }
            }
        }
    })
}

pub fn create_token(username: &str) -> Result<String> {
    create_token_with_version(username, 0)
}

/// Create a JWT embedding the given token_version. Call sites that have
/// access to the UserDb should use this with the current DB value so
/// bumping the DB version retroactively invalidates the token. Callers
/// without DB access (tests, compat shims) can use `create_token`, which
/// embeds `tv=0` and will be rejected as soon as any version bump happens.
pub fn create_token_with_version(username: &str, token_version: i64) -> Result<String> {
    let now = chrono::Utc::now().timestamp() as usize;
    let claims = Claims {
        sub: username.to_string(),
        exp: now + 7 * 24 * 3600, // 7 days
        iat: now,
        tv: token_version,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret()),
    )
    .context("creating JWT")
}

pub fn verify_token(token: &str) -> Result<Claims> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret()),
        &Validation::default(),
    )
    .context("invalid token")?;

    Ok(data.claims)
}
