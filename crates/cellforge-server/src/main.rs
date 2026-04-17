use anyhow::Context;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("cellforge=debug".parse()?))
        .init();

    let mut config = cellforge_server::Config::parse();

    // If --allow-network was passed and the user didn't override --host, switch to 0.0.0.0
    // and warn on stderr. If they passed an explicit --host, we trust them and leave it alone.
    let host = if config.allow_network && config.host == "127.0.0.1" {
        eprintln!(
            "⚠ Network access enabled — server listens on 0.0.0.0. Anyone on your LAN can reach CellForge. Make sure this is what you want."
        );
        "0.0.0.0".to_string()
    } else {
        config.host.clone()
    };
    config.host = host;

    let addr = format!("{}:{}", config.host, config.port);
    tracing::info!("starting at http://{addr}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| {
            format!("could not bind to {addr} — port may be in use, try --port 8889")
        })?;
    cellforge_server::run_server(listener, config).await
}
