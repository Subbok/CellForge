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

    let rt = tokio::runtime::Runtime::new()?;

    let listener = rt.block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))?;
    let port = listener.local_addr()?.port();
    let url = format!("http://127.0.0.1:{port}");

    tracing::info!("server bound to {url}");

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
