use crate::connection::ConnectionInfo;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::OnceLock;
use tokio::process::Child;
use uuid::Uuid;

/// Built-in Python helper modules embedded in the binary.
/// Written to `~/.config/cellforge/pylib/` on first kernel launch and
/// exposed via PYTHONPATH so `import cellforge_ui` / `import bliss_mermaid`
/// works regardless of cwd or installed plugins.
const BUILTIN_PYTHON_MODULES: &[(&str, &str)] = &[
    ("cellforge_ui.py", include_str!("../python/cellforge_ui.py")),
    ("cellforge.py", include_str!("../python/cellforge.py")),
];

/// Write the embedded built-in Python modules to a stable config-dir location
/// and return that path. Safe to call repeatedly — only writes when missing
/// or when the on-disk copy is out of sync with the embedded version.
pub fn ensure_builtin_pylib_dir() -> PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let base = dirs::config_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".config"))
            .join("cellforge")
            .join("pylib");
        let _ = std::fs::create_dir_all(&base);

        for (filename, content) in BUILTIN_PYTHON_MODULES {
            let path = base.join(filename);
            let needs_write = match std::fs::read_to_string(&path) {
                Ok(existing) => existing != *content,
                Err(_) => true,
            };
            if needs_write && let Err(e) = std::fs::write(&path, content) {
                tracing::warn!("could not write {} to {}: {}", filename, path.display(), e);
            }
        }
        base
    })
    .clone()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelSpec {
    pub argv: Vec<String>,
    pub display_name: String,
    pub language: String,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

/// Look through standard jupyter data dirs for installed kernelspecs.
/// Returns (name, path_to_kernel_dir, parsed_spec).
pub fn discover_kernelspecs() -> Vec<(String, PathBuf, KernelSpec)> {
    let mut specs = vec![];

    for base in search_paths() {
        let dir = base.join("kernels");
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let json_path = entry.path().join("kernel.json");
            if !json_path.exists() {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&json_path) else {
                continue;
            };
            let Ok(spec) = serde_json::from_str::<KernelSpec>(&text) else {
                continue;
            };
            let name = entry.file_name().to_string_lossy().to_string();
            specs.push((name, entry.path(), spec));
        }
    }

    specs
}

/// Find a kernelspec. The name can be:
///   - plain spec name like "python3" (first match wins)
///   - "spec_name__env_name" to target a specific conda env
pub fn find_kernelspec(name: &str) -> Result<(PathBuf, KernelSpec)> {
    // check if it's an env-qualified name like "python3__research"
    let (spec_name, env_filter) = match name.split_once("__") {
        Some((s, e)) => (s, Some(e)),
        None => (name, None),
    };

    for (n, path, spec) in discover_kernelspecs() {
        if n != spec_name {
            continue;
        }

        if let Some(env) = env_filter {
            // check that this kernelspec lives inside the right env
            let path_str = path.to_string_lossy();
            let in_env = path_str.contains(&format!("/envs/{env}/"))
                || path_str.contains(&format!("\\envs\\{env}\\"))
                || path_str.ends_with(&format!("/{env}"))
                || path_str.ends_with(&format!("\\{env}"));
            if !in_env {
                continue;
            }
        }

        return Ok((path, spec));
    }

    bail!("kernelspec '{name}' not found")
}

/// Spawn a kernel process and return its connection info + child handle.
/// This does the whole dance: pick ports, write connection file, launch subprocess.
///
/// `cwd` — working directory for the kernel process. Pass the notebook's
/// parent directory so that `np.savez('x.npz')` and other relative-path
/// writes land next to the .ipynb, not wherever the server was started.
///
/// Crucially, we set up the kernel's PATH and CONDA_PREFIX so that
/// `!pip install` and `!conda install` inside notebook cells target the
/// kernel's own environment, not whatever python is first in the user's shell.
pub async fn launch_kernel(
    spec_name: &str,
    cwd: Option<&std::path::Path>,
    extra_pythonpath: &[std::path::PathBuf],
) -> Result<(ConnectionInfo, Child)> {
    let (spec_dir, spec) = find_kernelspec(spec_name)?;

    let ports = pick_free_ports(5)?;
    let key = Uuid::new_v4().to_string();

    let conn = ConnectionInfo {
        transport: "tcp".into(),
        ip: "127.0.0.1".into(),
        shell_port: ports[0],
        iopub_port: ports[1],
        stdin_port: ports[2],
        control_port: ports[3],
        hb_port: ports[4],
        key: key.clone(),
        signature_scheme: "hmac-sha256".into(),
        kernel_name: Some(spec_name.into()),
    };

    let conn_file = std::env::temp_dir().join(format!("cellforge-kernel-{}.json", Uuid::new_v4()));
    std::fs::write(&conn_file, serde_json::to_string_pretty(&conn)?)
        .context("writing connection file")?;

    let conn_file_str = conn_file.to_string_lossy().to_string();
    let argv: Vec<String> = spec
        .argv
        .iter()
        .map(|arg| arg.replace("{connection_file}", &conn_file_str))
        .collect();

    if argv.is_empty() {
        bail!("kernelspec has empty argv");
    }

    // figure out which env this kernel lives in, so we can fix PATH
    let env_info = detect_env(&spec_dir, &argv[0]);

    tracing::info!(
        "launching kernel: {} {} (env: {})",
        argv[0],
        argv[1..].join(" "),
        env_info
            .as_ref()
            .map(|e| e.prefix.display().to_string())
            .unwrap_or("system".into())
    );

    let mut cmd = tokio::process::Command::new(&argv[0]);
    cmd.args(&argv[1..]);
    cmd.kill_on_drop(true);

    // Compose PYTHONPATH: built-in pylib first, then any extras the caller
    // provided (e.g. per-user plugin pylibs), then the user's existing
    // PYTHONPATH if any.
    let builtin_pylib = ensure_builtin_pylib_dir();
    let mut parts: Vec<String> = Vec::new();
    parts.push(builtin_pylib.display().to_string());
    for p in extra_pythonpath {
        parts.push(p.display().to_string());
    }
    if let Ok(existing) = std::env::var("PYTHONPATH")
        && !existing.is_empty()
    {
        parts.push(existing);
    }
    let path_sep = if cfg!(windows) { ";" } else { ":" };
    let new_pythonpath = parts.join(path_sep);
    cmd.env("PYTHONPATH", &new_pythonpath);
    tracing::debug!("kernel PYTHONPATH = {}", new_pythonpath);

    // run the kernel in the notebook's directory so relative file ops
    // (np.savez, open('data.csv', 'w'), matplotlib savefig, etc.) land there
    match cwd {
        Some(dir) if dir.is_dir() => {
            cmd.current_dir(dir);
            tracing::info!("kernel cwd = {}", dir.display());
        }
        Some(dir) => {
            tracing::warn!(
                "kernel cwd {} is not a directory, kernel will inherit server cwd ({})",
                dir.display(),
                std::env::current_dir()
                    .map(|p| p.display().to_string())
                    .unwrap_or("?".into()),
            );
        }
        None => {
            tracing::warn!(
                "kernel cwd not provided, kernel will inherit server cwd ({})",
                std::env::current_dir()
                    .map(|p| p.display().to_string())
                    .unwrap_or("?".into()),
            );
        }
    }

    // this is the fix for "!pip install goes to the wrong place":
    // we make sure the kernel's env bin dir is at the front of PATH,
    // and set CONDA_PREFIX if it's a conda env. that way any subprocess
    // the kernel spawns (like `!pip` or `!conda`) resolves to the right env.
    if let Some(ref env) = env_info {
        let bin = if cfg!(windows) {
            env.prefix.join("Scripts")
        } else {
            env.prefix.join("bin")
        };
        let old_path = std::env::var("PATH").unwrap_or_default();
        let new_path = format!("{}{path_sep}{old_path}", bin.display());
        cmd.env("PATH", &new_path);
        cmd.env("VIRTUAL_ENV", &env.prefix);

        if env.is_conda {
            cmd.env("CONDA_PREFIX", &env.prefix);
            // also set CONDA_DEFAULT_ENV so `conda install` knows where to put stuff
            if let Some(name) = env.prefix.file_name() {
                cmd.env("CONDA_DEFAULT_ENV", name);
            }
        }

        tracing::debug!("kernel PATH starts with {}", bin.display());
    }

    let child = cmd
        .spawn()
        .with_context(|| format!("spawning kernel: {}", argv[0]))?;

    // give it a moment to start up and bind its sockets
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    Ok((conn, child))
}

struct EnvInfo {
    prefix: PathBuf, // e.g. /home/user/miniforge3/envs/myenv
    is_conda: bool,
}

/// Try to figure out which env a kernel belongs to, based on where
/// its kernelspec or executable lives. This isn't bulletproof but it
/// covers the common cases (conda envs, venvs).
fn detect_env(spec_dir: &std::path::Path, _executable: &str) -> Option<EnvInfo> {
    // Walk up from the kernelspec dir looking for a directory that looks like
    // a Python env (has bin/ or Scripts/ plus conda-meta/ or pyvenv.cfg).
    let mut dir = spec_dir;
    loop {
        let has_bin = dir.join("bin").is_dir() || dir.join("Scripts").is_dir();
        let is_env = dir.join("conda-meta").is_dir() || dir.join("pyvenv.cfg").exists();
        if has_bin && is_env {
            let is_conda = dir.join("conda-meta").is_dir();
            return Some(EnvInfo {
                prefix: dir.to_path_buf(),
                is_conda,
            });
        }
        dir = dir.parent()?;
    }
}

fn pick_free_ports(n: usize) -> Result<Vec<u16>> {
    // bind to port 0 to get an OS-assigned free port, then drop the listener.
    // there's a small race window but it's fine for local dev.
    let mut ports = vec![];
    for _ in 0..n {
        let listener = TcpListener::bind("127.0.0.1:0").context("finding free port")?;
        ports.push(listener.local_addr()?.port());
    }
    Ok(ports)
}

fn search_paths() -> Vec<PathBuf> {
    // Order matters: first match wins, so conda envs go first,
    // then venv, then system Python.
    let mut paths = vec![];

    fn push_unique(paths: &mut Vec<PathBuf>, p: PathBuf) {
        if p.exists() && !paths.contains(&p) {
            paths.push(p);
        }
    }

    // 1. active conda env
    if let Ok(prefix) = std::env::var("CONDA_PREFIX") {
        push_unique(&mut paths, PathBuf::from(&prefix).join("share/jupyter"));
    }

    // 2. all other conda envs
    push_conda_envs(&mut paths);

    // 3. active venv / whatever `python3` (or `python` on Windows) resolves to
    for cmd in &["python3", "python"] {
        if let Ok(out) = std::process::Command::new(cmd)
            .args(["-c", "import sys; print(sys.prefix)"])
            .output()
            && out.status.success()
        {
            let prefix = String::from_utf8_lossy(&out.stdout).trim().to_string();
            push_unique(&mut paths, PathBuf::from(&prefix).join("share/jupyter"));
        }
    }

    // 4. also try system Python explicitly (bypasses conda PATH override)
    #[cfg(unix)]
    for bin in &["/usr/bin/python3", "/usr/bin/python"] {
        if let Ok(out) = std::process::Command::new(bin)
            .args(["-c", "import sys; print(sys.prefix)"])
            .output()
            && out.status.success()
        {
            let prefix = String::from_utf8_lossy(&out.stdout).trim().to_string();
            push_unique(&mut paths, PathBuf::from(&prefix).join("share/jupyter"));
        }
    }

    // 4b. Windows: try the `py` launcher (PEP 397, standard with python.org installs)
    //     and scan common Python install locations
    #[cfg(windows)]
    {
        if let Ok(out) = std::process::Command::new("py")
            .args(["-c", "import sys; print(sys.prefix)"])
            .output()
            && out.status.success()
        {
            let prefix = String::from_utf8_lossy(&out.stdout).trim().to_string();
            push_unique(&mut paths, PathBuf::from(&prefix).join("share/jupyter"));
        }
        // python.org installs typically land in %LOCALAPPDATA%\Programs\Python\Python3XX
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let programs_python = PathBuf::from(&local).join("Programs").join("Python");
            if let Ok(entries) = std::fs::read_dir(&programs_python) {
                for entry in entries.flatten() {
                    push_unique(&mut paths, entry.path().join("share/jupyter"));
                }
            }
        }
    }

    // 5. R (IRkernel) — ask R itself where it installed its kernelspec
    if let Ok(out) = std::process::Command::new("R")
        .args([
            "--slave",
            "-e",
            "cat(system.file('kernelspec', package='IRkernel'))",
        ])
        .output()
        && out.status.success()
    {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            // system.file returns the kernelspec *inside* the package, which lives
            // somewhere like .../IRkernel/kernelspec — we need the parent jupyter
            // data dir, so walk up to find the share/jupyter ancestor.
            // Simpler: also try Rscript -e "cat(IRkernel::jupyter_data_dir())" if
            // the kernelspec path contains "kernels/ir", derive the jupyter root.
            let pb = PathBuf::from(&p);
            // The path is typically .../share/jupyter/kernels/ir  — so go up twice
            // to reach .../share/jupyter, or just push the kernelspec parent's parent.
            if let Some(kernels_dir) = pb.parent()
                && let Some(jupyter_dir) = kernels_dir.parent()
            {
                push_unique(&mut paths, jupyter_dir.to_path_buf());
            }
        }
    }
    // Also try `Rscript` (some setups only have Rscript in PATH, not R)
    if let Ok(out) = std::process::Command::new("Rscript")
        .args(["-e", "cat(system.file('kernelspec', package='IRkernel'))"])
        .output()
        && out.status.success()
    {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            let pb = PathBuf::from(&p);
            if let Some(kernels_dir) = pb.parent()
                && let Some(jupyter_dir) = kernels_dir.parent()
            {
                push_unique(&mut paths, jupyter_dir.to_path_buf());
            }
        }
    }

    // 6. Julia (IJulia) — ask IJulia where it keeps its jupyter data dir
    if let Ok(out) = std::process::Command::new("julia")
        .args(["-e", "using IJulia; print(IJulia.JUPYTER_DATA_DIR[])"])
        .output()
        && out.status.success()
    {
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !p.is_empty() {
            push_unique(&mut paths, PathBuf::from(p));
        }
    }
    // Fallback: if IJulia is installed, its depot typically lives in ~/.julia;
    // check the conventional location for the jupyter data dir it creates.
    if let Some(h) = dirs::home_dir() {
        push_unique(&mut paths, h.join(".julia/conda/3/share/jupyter"));
        push_unique(&mut paths, h.join(".julia/conda/3/x86_64/share/jupyter"));
    }

    // 7. user data dir (where `pip install --user ipykernel` lands)
    if let Some(d) = dirs::data_dir() {
        push_unique(&mut paths, d.join("jupyter"));
    }
    #[cfg(unix)]
    if let Some(h) = dirs::home_dir() {
        push_unique(&mut paths, h.join(".local/share/jupyter"));
    }

    // 8. system-wide kernel dirs
    #[cfg(unix)]
    {
        push_unique(&mut paths, "/usr/share/jupyter".into());
        push_unique(&mut paths, "/usr/local/share/jupyter".into());
    }
    #[cfg(windows)]
    {
        if let Ok(pd) = std::env::var("PROGRAMDATA") {
            push_unique(&mut paths, PathBuf::from(&pd).join("jupyter"));
        }
    }

    paths
}

/// Find all conda environments and add their jupyter paths.
fn push_conda_envs(paths: &mut Vec<PathBuf>) {
    // try `conda info --envs` first — works whether conda is in PATH or not
    // as long as CONDA_EXE is set (which it is after `conda init`)
    let conda_cmd = std::env::var("CONDA_EXE").unwrap_or_else(|_| "conda".into());

    let Ok(out) = std::process::Command::new(&conda_cmd)
        .args(["info", "--envs"])
        .output()
    else {
        // conda not available, try common locations manually
        push_conda_envs_fallback(paths);
        return;
    };

    if !out.status.success() {
        push_conda_envs_fallback(paths);
        return;
    }

    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        let line = line.trim();
        // skip comments and empty lines
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // format is: "envname    /path/to/env" or just "/path/to/env" for base
        // the path is always the last whitespace-separated token
        if let Some(path_str) = line.split_whitespace().last() {
            let p = PathBuf::from(path_str).join("share/jupyter");
            if p.exists() && !paths.contains(&p) {
                paths.push(p);
            }
        }
    }
}

/// If conda command isn't available, check the usual locations.
fn push_conda_envs_fallback(paths: &mut Vec<PathBuf>) {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };

    // miniforge, mambaforge, miniconda, anaconda — check all of them.
    // On Windows these typically live in %USERPROFILE% (same as home_dir).
    #[allow(unused_mut)]
    let mut bases = vec![
        home.join("miniforge3"),
        home.join("mambaforge"),
        home.join("miniconda3"),
        home.join("anaconda3"),
    ];
    // Windows also puts conda in AppData or Program Files
    #[cfg(windows)]
    {
        if let Ok(ld) = std::env::var("LOCALAPPDATA") {
            bases.push(PathBuf::from(&ld).join("miniconda3"));
            bases.push(PathBuf::from(&ld).join("miniforge3"));
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            bases.push(PathBuf::from(&pf).join("Anaconda3"));
        }
    }

    for base in &bases {
        // base env
        let p = base.join("share/jupyter");
        if p.exists() && !paths.contains(&p) {
            paths.push(p);
        }

        // named envs
        let envs_dir = base.join("envs");
        if let Ok(entries) = std::fs::read_dir(&envs_dir) {
            for entry in entries.flatten() {
                let p = entry.path().join("share/jupyter");
                if p.exists() && !paths.contains(&p) {
                    paths.push(p);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_free_ports_returns_unique_ports() {
        let ports = pick_free_ports(5).expect("should allocate 5 free ports");
        assert_eq!(ports.len(), 5);
        for &p in &ports {
            assert!(p > 0, "port should be > 0, got {p}");
        }
        let mut unique = ports.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(
            unique.len(),
            5,
            "all 5 ports should be unique, got: {ports:?}"
        );
    }

    #[test]
    fn pick_free_ports_zero_returns_empty() {
        let ports = pick_free_ports(0).expect("zero ports should work");
        assert!(ports.is_empty());
    }

    #[test]
    fn pick_free_ports_large_batch() {
        let ports = pick_free_ports(20).expect("should allocate 20 ports");
        assert_eq!(ports.len(), 20);
        let mut unique = ports.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), 20);
    }

    #[test]
    fn discover_kernelspecs_does_not_panic() {
        let specs = discover_kernelspecs();
        let _ = specs.len();
    }

    #[test]
    fn discover_kernelspecs_returns_valid_entries() {
        let specs = discover_kernelspecs();
        for (name, path, spec) in &specs {
            assert!(!name.is_empty());
            assert!(
                path.exists(),
                "kernel path should exist: {}",
                path.display()
            );
            assert!(!spec.display_name.is_empty());
            assert!(!spec.argv.is_empty());
        }
    }

    #[test]
    fn ensure_builtin_pylib_dir_creates_files() {
        let dir = ensure_builtin_pylib_dir();
        assert!(dir.exists() && dir.is_dir());
        for (filename, content) in BUILTIN_PYTHON_MODULES {
            let path = dir.join(filename);
            assert!(path.exists(), "should exist: {}", path.display());
            let on_disk = std::fs::read_to_string(&path).unwrap();
            assert_eq!(on_disk, *content);
        }
    }

    #[test]
    fn ensure_builtin_pylib_dir_is_idempotent() {
        assert_eq!(ensure_builtin_pylib_dir(), ensure_builtin_pylib_dir());
    }

    #[test]
    fn kernelspec_serde_roundtrip() {
        let spec = KernelSpec {
            argv: vec!["python3".into(), "-m".into(), "ipykernel_launcher".into()],
            display_name: "Python 3".into(),
            language: "python".into(),
            metadata: serde_json::json!({"debugger": true}),
        };
        let json = serde_json::to_string(&spec).unwrap();
        let back: KernelSpec = serde_json::from_str(&json).unwrap();
        assert_eq!(back.display_name, "Python 3");
        assert_eq!(back.argv.len(), 3);
    }

    #[test]
    fn kernelspec_deserialize_minimal() {
        let json = r#"{"argv":["python3"],"display_name":"Py","language":"python"}"#;
        let spec: KernelSpec = serde_json::from_str(json).unwrap();
        assert_eq!(spec.argv, vec!["python3"]);
        assert_eq!(spec.metadata, serde_json::Value::Null);
    }

    #[test]
    fn search_paths_includes_r_jupyter_dir() {
        // Smoke test: search_paths() must not panic regardless of whether R /
        // IRkernel is installed. We just call it and ignore the result.
        let _ = search_paths();
    }

    #[test]
    fn search_paths_includes_julia_jupyter_dir() {
        // Smoke test: search_paths() must not panic regardless of whether Julia /
        // IJulia is installed. We just call it and ignore the result.
        let _ = search_paths();
    }
}
