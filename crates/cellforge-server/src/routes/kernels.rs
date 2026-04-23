use crate::routes::auth::extract_user;
use crate::state::AppState;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use cellforge_kernel::launcher::discover_kernelspecs;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Serialize)]
pub struct KernelSpecEntry {
    name: String,         // unique key for connecting (e.g. "python3__research")
    display_name: String, // what the user sees
    language: String,
    env_name: Option<String>, // conda env name if detected
    env_path: Option<String>, // full path to the env
    spec_name: String,        // actual kernelspec name (e.g. "python3")
}

pub async fn list_specs(headers: HeaderMap) -> Result<impl IntoResponse, StatusCode> {
    let _username = extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let raw = discover_kernelspecs();

    let mut entries: Vec<KernelSpecEntry> = raw
        .into_iter()
        .map(|(spec_name, spec_dir, spec)| {
            // try to figure out which env this is from the spec dir path.
            // e.g. /home/user/miniconda3/envs/research/share/jupyter/kernels/python3
            let (env_name, env_path) = detect_env_from_path(&spec_dir);

            let display = if let Some(ref env) = env_name {
                format!("{} ({})", spec.display_name, env)
            } else {
                spec.display_name.clone()
            };

            // unique key: spec_name + env to avoid collisions when multiple
            // envs have a "python3" kernelspec
            let key = if let Some(ref env) = env_name {
                format!("{}__{}", spec_name, env)
            } else {
                spec_name.clone()
            };

            KernelSpecEntry {
                name: key,
                display_name: display,
                language: spec.language,
                env_name,
                env_path: env_path.map(|p| p.to_string_lossy().into()),
                spec_name,
            }
        })
        .collect();

    // also list conda envs that DON'T have kernelspecs — the user probably
    // wants to know they exist and can install ipykernel
    let existing_envs: std::collections::HashSet<String> =
        entries.iter().filter_map(|e| e.env_name.clone()).collect();

    for (env_name, env_path) in find_conda_envs_without_kernel() {
        if existing_envs.contains(&env_name) {
            continue;
        }
        entries.push(KernelSpecEntry {
            name: format!("__install__{}", env_name),
            display_name: format!("{} (needs ipykernel)", env_name),
            language: "python".into(),
            env_name: Some(env_name),
            env_path: Some(env_path.to_string_lossy().into()),
            spec_name: String::new(),
        });
    }

    // also list standalone Python installations (non-conda) that lack ipykernel
    let existing_paths: std::collections::HashSet<String> =
        entries.iter().filter_map(|e| e.env_path.clone()).collect();
    for (label, prefix) in find_pythons_without_kernel() {
        let path_str = prefix.to_string_lossy().to_string();
        if existing_paths.contains(&path_str) {
            continue;
        }
        entries.push(KernelSpecEntry {
            name: format!("__install__{}", label),
            display_name: format!("{} (needs ipykernel)", label),
            language: "python".into(),
            env_name: Some(label),
            env_path: Some(path_str),
            spec_name: String::new(),
        });
    }

    // list R installations that don't have IRkernel installed
    for (label, r_path) in find_r_without_kernel() {
        let path_str = r_path.to_string_lossy().to_string();
        entries.push(KernelSpecEntry {
            name: format!("__install__{}", label),
            display_name: format!("{} (needs IRkernel)", label),
            language: "r".into(),
            env_name: Some(label),
            env_path: Some(path_str),
            spec_name: String::new(),
        });
    }

    // list Julia installations that don't have IJulia installed
    for (label, julia_path) in find_julia_without_kernel() {
        let path_str = julia_path.to_string_lossy().to_string();
        entries.push(KernelSpecEntry {
            name: format!("__install__{}", label),
            display_name: format!("{} (needs IJulia)", label),
            language: "julia".into(),
            env_name: Some(label),
            env_path: Some(path_str),
            spec_name: String::new(),
        });
    }

    Ok(Json(entries))
}

fn detect_env_from_path(
    spec_dir: &std::path::Path,
) -> (Option<String>, Option<std::path::PathBuf>) {
    // walk up from the spec dir looking for a conda-meta or pyvenv.cfg
    let mut dir = spec_dir;
    loop {
        if dir.join("conda-meta").is_dir() {
            let name = dir
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                // if the env is the base conda install, use "base"
                .unwrap_or("base".into());

            // the base env has conda-meta but its parent is NOT an "envs" dir
            let is_base = dir
                .parent()
                .map(|p| p.file_name() != Some("envs".as_ref()))
                .unwrap_or(true);
            let display_name = if is_base { "base".into() } else { name };

            return (Some(display_name), Some(dir.to_path_buf()));
        }
        if dir.join("pyvenv.cfg").exists() {
            let name = dir
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or("venv".into());
            return (Some(name), Some(dir.to_path_buf()));
        }
        match dir.parent() {
            Some(p) if p != dir => dir = p,
            _ => break,
        }
    }
    (None, None)
}

/// Find conda envs that have python but no kernelspec installed.
fn find_conda_envs_without_kernel() -> Vec<(String, std::path::PathBuf)> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };

    #[allow(unused_mut)]
    let mut bases = vec![
        home.join("miniforge3"),
        home.join("mambaforge"),
        home.join("miniconda3"),
        home.join("anaconda3"),
    ];
    #[cfg(windows)]
    {
        if let Ok(ld) = std::env::var("LOCALAPPDATA") {
            bases.push(std::path::PathBuf::from(&ld).join("miniconda3"));
            bases.push(std::path::PathBuf::from(&ld).join("miniforge3"));
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            bases.push(std::path::PathBuf::from(&pf).join("Anaconda3"));
        }
    }
    // macOS: Homebrew casks + common system-wide locations. Desktop app
    // launched from Finder has no PATH, so these have to be checked explicitly.
    #[cfg(target_os = "macos")]
    {
        bases.push(std::path::PathBuf::from(
            "/opt/homebrew/Caskroom/miniconda/base",
        ));
        bases.push(std::path::PathBuf::from(
            "/opt/homebrew/Caskroom/miniforge/base",
        ));
        bases.push(std::path::PathBuf::from(
            "/usr/local/Caskroom/miniconda/base",
        ));
        bases.push(std::path::PathBuf::from("/opt/miniconda3"));
        bases.push(std::path::PathBuf::from("/opt/miniforge3"));
    }
    #[cfg(target_os = "linux")]
    {
        bases.push(std::path::PathBuf::from("/opt/miniconda3"));
        bases.push(std::path::PathBuf::from("/opt/miniforge3"));
        bases.push(std::path::PathBuf::from("/opt/anaconda3"));
    }

    let mut out = vec![];
    let mut seen: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();

    let mut consider = |p: std::path::PathBuf, name: String| {
        if seen.contains(&p) {
            return;
        }
        let has_python = if cfg!(windows) {
            p.join("Scripts/python.exe").exists() || p.join("python.exe").exists()
        } else {
            p.join("bin/python").exists()
        };
        if !has_python {
            return;
        }
        if p.join("share/jupyter/kernels").is_dir() {
            return;
        }
        seen.insert(p.clone());
        out.push((name, p));
    };

    for base in &bases {
        let envs_dir = base.join("envs");
        let Ok(entries) = std::fs::read_dir(&envs_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            consider(entry.path(), name);
        }
    }

    // Catch-all: ~/.conda/environments.txt lists every env conda knows about,
    // including --prefix envs outside the standard bases directories.
    let env_list = home.join(".conda/environments.txt");
    if let Ok(text) = std::fs::read_to_string(&env_list) {
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let p = std::path::PathBuf::from(line);
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "env".into());
            consider(p, name);
        }
    }

    out
}

/// Find standalone Python installations (non-conda) that don't have ipykernel.
/// On Windows this covers python.org installs, the `py` launcher, and MSYS2.
pub fn find_pythons_without_kernel() -> Vec<(String, std::path::PathBuf)> {
    let mut out = vec![];
    let mut seen_prefixes = std::collections::HashSet::new();

    // Helper: run a Python executable, check if it lacks ipykernel, and collect it.
    let mut check_exe = |exe: &str, label_hint: Option<&str>| {
        let Ok(pout) = std::process::Command::new(exe)
            .args(["-c", "import sys; print(sys.prefix)"])
            .output()
        else {
            return;
        };
        if !pout.status.success() {
            return;
        }
        let prefix = String::from_utf8_lossy(&pout.stdout).trim().to_string();
        if prefix.is_empty() || !seen_prefixes.insert(prefix.clone()) {
            return;
        }

        let prefix_path = std::path::PathBuf::from(&prefix);
        // skip conda envs — already handled by find_conda_envs_without_kernel
        if prefix_path.join("conda-meta").is_dir() {
            return;
        }

        // check if ipykernel is importable in this Python
        let has_ipykernel = std::process::Command::new(exe)
            .args(["-c", "import ipykernel"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if has_ipykernel {
            return;
        }

        // also skip if this prefix already has kernelspecs (via data dir)
        if prefix_path.join("share/jupyter/kernels").is_dir() {
            return;
        }

        let label = if let Some(h) = label_hint {
            h.to_string()
        } else {
            std::process::Command::new(exe)
                .args([
                    "-c",
                    "import sys; v=sys.version_info; print(f'Python {v.major}.{v.minor}')",
                ])
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_else(|| "Python".into())
        };

        out.push((label, prefix_path));
    };

    // 1. Check python / python3 in PATH
    for cmd in &["python3", "python"] {
        check_exe(cmd, None);
    }

    // 2. Windows-specific: py launcher + standard install locations
    #[cfg(windows)]
    {
        check_exe("py", None);

        // python.org installs go to %LOCALAPPDATA%\Programs\Python\PythonXY\
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let programs = std::path::PathBuf::from(&local)
                .join("Programs")
                .join("Python");
            if let Ok(entries) = std::fs::read_dir(&programs) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    let exe = p.join("python.exe");
                    if exe.exists() {
                        let label = entry.file_name().to_string_lossy().to_string();
                        check_exe(&exe.to_string_lossy(), Some(&label));
                    }
                }
            }
        }

        // Also check %ProgramFiles%\Python* (some org installs end up here)
        if let Ok(pf) = std::env::var("ProgramFiles") {
            if let Ok(entries) = std::fs::read_dir(&pf) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !name.starts_with("Python") {
                        continue;
                    }
                    let exe = entry.path().join("python.exe");
                    if exe.exists() {
                        check_exe(&exe.to_string_lossy(), Some(&name));
                    }
                }
            }
        }
    }

    out
}

/// Find R installations that don't have IRkernel installed.
/// Checks `R` first, then `Rscript`, but only ever returns one entry.
fn find_r_without_kernel() -> Vec<(String, std::path::PathBuf)> {
    for exe in &["R", "Rscript"] {
        // Get R version
        let version_out = std::process::Command::new(exe)
            .args([
                "--slave",
                "-e",
                "cat(paste0(R.version$major, '.', R.version$minor))",
            ])
            .output();
        let Ok(vout) = version_out else { continue };
        if !vout.status.success() {
            continue;
        }
        let version = String::from_utf8_lossy(&vout.stdout).trim().to_string();
        if version.is_empty() {
            continue;
        }

        // Check if IRkernel is installed
        let has_irkernel = std::process::Command::new(exe)
            .args(["--slave", "-e", "library(IRkernel)"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if has_irkernel {
            break;
        }

        // Get the R home path to use as a stable identifier
        let home_out = std::process::Command::new(exe)
            .args(["--slave", "-e", "cat(R.home())"])
            .output();
        let r_path = if let Ok(hout) = home_out {
            if hout.status.success() {
                std::path::PathBuf::from(String::from_utf8_lossy(&hout.stdout).trim().to_string())
            } else {
                std::path::PathBuf::from(exe)
            }
        } else {
            std::path::PathBuf::from(exe)
        };

        let label = format!("R {}", version);
        return vec![(label, r_path)];
    }
    vec![]
}

/// Find Julia installations that don't have IJulia installed.
fn find_julia_without_kernel() -> Vec<(String, std::path::PathBuf)> {
    let version_out = std::process::Command::new("julia")
        .arg("--version")
        .output();
    let Ok(vout) = version_out else { return vec![] };
    if !vout.status.success() {
        return vec![];
    }
    // output looks like "julia version 1.10.2"
    let version_str = String::from_utf8_lossy(&vout.stdout).trim().to_string();
    let version = version_str
        .split_whitespace()
        .last()
        .unwrap_or("?")
        .to_string();

    // Check if IJulia is available
    let has_ijulia = std::process::Command::new("julia")
        .args(["-e", "using IJulia"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if has_ijulia {
        return vec![];
    }

    // Use the julia binary path as identifier
    let julia_path = which_path("julia").unwrap_or_else(|| std::path::PathBuf::from("julia"));
    let label = format!("Julia {}", version);
    vec![(label, julia_path)]
}

/// Return the full path of an executable found in PATH, or None.
fn which_path(exe: &str) -> Option<std::path::PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let candidate = dir.join(exe);
            if candidate.exists() {
                Some(candidate)
            } else {
                None
            }
        })
    })
}

#[derive(Serialize)]
pub struct SessionEntry {
    id: String,
    notebook_path: String,
    kernel_name: String,
}

pub async fn list_sessions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    let _username = extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let lock = state.sessions.read();
    let out: Vec<_> = lock
        .values()
        .map(|s| SessionEntry {
            id: s.id.clone(),
            notebook_path: s.notebook_path.to_string_lossy().into(),
            kernel_name: s.kernel_name.clone(),
        })
        .collect();
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct CreateSessionReq {
    notebook_path: String,
    kernel_name: Option<String>,
}

pub async fn create_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CreateSessionReq>,
) -> Result<Json<SessionEntry>, StatusCode> {
    let _username = extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let id = uuid::Uuid::new_v4().to_string();
    let kernel_name = req.kernel_name.unwrap_or("python3".into());

    let info = crate::state::SessionInfo {
        id: id.clone(),
        notebook_path: req.notebook_path.clone().into(),
        kernel_name: kernel_name.clone(),
        _kernel_id: None,
    };
    state.sessions.write().insert(id.clone(), info);

    Ok(Json(SessionEntry {
        id,
        notebook_path: req.notebook_path,
        kernel_name,
    }))
}

pub async fn delete_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let _username = extract_user(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    match state.sessions.write().remove(&id) {
        Some(_) => Ok(StatusCode::NO_CONTENT),
        None => Err(StatusCode::NOT_FOUND),
    }
}
