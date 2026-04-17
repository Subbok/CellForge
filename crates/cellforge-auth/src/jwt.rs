use anyhow::{Context, Result};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // username
    pub exp: usize,  // expiry timestamp
    pub iat: usize,  // issued at
}

// secret key — generated once per server lifetime, stored in memory.
// if you restart the server, all sessions expire. that's fine.
static SECRET: OnceLock<Vec<u8>> = OnceLock::new();

fn secret() -> &'static [u8] {
    SECRET.get_or_init(|| {
        let dir = cellforge_config::config_dir();
        let key_path = dir.join("jwt_secret");

        if let Ok(key) = std::fs::read(&key_path)
            && key.len() >= 32
        {
            return key;
        }

        let mut key = vec![0u8; 64];
        getrandom::getrandom(&mut key).expect("getrandom failed — system entropy pool unavailable");
        let _ = std::fs::create_dir_all(&dir);
        if let Err(e) = std::fs::write(&key_path, &key) {
            tracing::error!(
                "could not persist jwt_secret to {}: {e}",
                key_path.display()
            );
        } else {
            // chmod 0600 so only the server user can read it
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
            }
        }
        key
    })
}

pub fn create_token(username: &str) -> Result<String> {
    let now = chrono::Utc::now().timestamp() as usize;
    let claims = Claims {
        sub: username.to_string(),
        exp: now + 7 * 24 * 3600, // 7 days
        iat: now,
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
