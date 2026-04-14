use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("cellforge=debug".parse()?))
        .init();

    let config = cellforge_server::Config::parse();
    let addr = format!("{}:{}", config.host, config.port);
    tracing::info!("starting at http://{addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    cellforge_server::run_server(listener, config).await
}
