use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug, Clone)]
#[command(name = "cellforge", about = "CellForge notebook server")]
pub struct Config {
    /// Host address to bind to
    #[arg(long, default_value = "0.0.0.0")]
    pub host: String,

    /// Port to listen on
    #[arg(long, default_value_t = 8888)]
    pub port: u16,

    /// Working directory for notebooks
    #[arg(long, default_value = ".")]
    pub notebook_dir: PathBuf,

    /// Open a specific notebook file
    #[arg(value_name = "NOTEBOOK")]
    pub notebook: Option<PathBuf>,

    /// Disable startup update check
    #[arg(long)]
    pub no_update_check: bool,

    /// Enable hub mode (admin panel, resource limits, groups)
    #[arg(long)]
    pub hub: bool,

    /// Idle kernel timeout in minutes (hub mode only, default: 30)
    #[arg(long, default_value_t = 30)]
    pub idle_timeout: u64,
}

impl Config {
    pub fn parse() -> Self {
        <Self as Parser>::parse()
    }
}
