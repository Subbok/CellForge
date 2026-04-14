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
        // try to load from config, or generate random
        let dir = cellforge_config::config_dir();
        let key_path = dir.join("jwt_secret");

        if let Ok(key) = std::fs::read(&key_path)
            && key.len() >= 32
        {
            return key;
        }

        // generate new secret
        let key: Vec<u8> = (0..64).map(|_| rand_byte()).collect();
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(&key_path, &key);
        key
    })
}

fn rand_byte() -> u8 {
    // poor man's random — good enough for a secret key
    use std::time::SystemTime;
    let t = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    ((t.subsec_nanos() ^ t.as_millis() as u32) & 0xFF) as u8
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
