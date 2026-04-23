use anyhow::Result;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::{Icon, WindowBuilder};
use tracing_subscriber::EnvFilter;
use wry::WebViewBuilder;

const ICON_PNG: &[u8] = include_bytes!("../../../assets/icon.png");

fn load_window_icon() -> Option<Icon> {
    let decoder = png::Decoder::new(ICON_PNG);
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    // png crate can yield RGB or RGBA depending on the source; Icon::from_rgba
    // wants straight RGBA so expand if needed.
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf[..info.buffer_size()].to_vec(),
        png::ColorType::Rgb => {
            let src = &buf[..info.buffer_size()];
            let mut out = Vec::with_capacity(src.len() / 3 * 4);
            for chunk in src.chunks_exact(3) {
                out.extend_from_slice(chunk);
                out.push(0xff);
            }
            out
        }
        _ => return None,
    };
    Icon::from_rgba(rgba, info.width, info.height).ok()
}

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
        allow_network: false,
        notebook_dir: std::env::current_dir().unwrap_or_default(),
        notebook: None,
        no_update_check: false,
        hub: false,
    };

    std::thread::spawn(move || {
        rt.block_on(async {
            if let Err(e) = cellforge_server::run_server(listener, config).await {
                tracing::error!("server error: {e}");
            }
        });
    });

    // Linux: set GTK application ID so Wayland compositors can match the
    // window to app.cellforge.desktop for title-bar icon and task grouping.
    // GApplication IDs must follow D-Bus naming (at least one dot, reverse
    // domain style) — bare "cellforge" is rejected and panics GDK init.
    let mut event_loop_builder = EventLoopBuilder::new();
    #[cfg(target_os = "linux")]
    {
        use tao::platform::unix::EventLoopBuilderExtUnix;
        event_loop_builder.with_app_id("app.cellforge");
    }
    let event_loop = event_loop_builder.build();

    let window = WindowBuilder::new()
        .with_title("CellForge")
        .with_window_icon(load_window_icon())
        .with_inner_size(tao::dpi::LogicalSize::new(1400.0, 900.0))
        .build(&event_loop)?;

    #[cfg(target_os = "linux")]
    let _webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        let vbox = window.default_vbox().unwrap();
        WebViewBuilder::new().with_url(&url).build_gtk(vbox)?
    };

    #[cfg(not(target_os = "linux"))]
    let _webview = WebViewBuilder::new().with_url(&url).build(&window)?;

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
