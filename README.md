# CellForge

> A modern notebook IDE — Rust backend, React frontend, real Jupyter kernels, reactive execution, and PDF export via Typst.

![version](https://img.shields.io/badge/version-1.0.0-blue)
![rust](https://img.shields.io/badge/rust-2024-orange)
![react](https://img.shields.io/badge/react-19-61dafb)
![license](https://img.shields.io/badge/license-AGPL--3.0-green)

**[Getting Started](https://github.com/Subbok/CellForge/wiki/Getting-Started)** | **[Wiki](https://github.com/Subbok/CellForge/wiki)** | **[Releases](../../releases)**

---

## Install

**One command (Linux x64):**

```bash
curl -fsSL https://github.com/Subbok/CellForge/releases/latest/download/cellforge-linux-x64 -o cellforge && chmod +x cellforge && ./cellforge
```

**Docker — pick your image:**

```bash
# Lean default — Python 3.12 + scientific/data stack, no DL frameworks.
# Multi-arch (linux/amd64, linux/arm64). ~2 GB.
docker run -p 8888:8888 -v ~/notebooks:/data \
  ghcr.io/subbok/cellforge-server:latest

# AI — lean + PyTorch and TensorFlow kernels, GPU-accelerated (CUDA 12.6).
# linux/amd64 only. ~8 GB. Needs nvidia-container-toolkit on the host.
docker run --gpus all -p 8888:8888 -v ~/notebooks:/data \
  ghcr.io/subbok/cellforge-server-ai:latest
```

The AI image registers three kernels in the dropdown: **Python 3.12 (CPU)**, **(PyTorch)**, **(TensorFlow)**. Pick the CPU kernel for plotting/data work (fast startup), switch to PyTorch or TensorFlow when you need the GPU.

**Docker (custom kernel set — R, Julia, JavaScript, Kotlin, Ruby):**

```bash
curl -fsSL https://raw.githubusercontent.com/Subbok/CellForge/main/scripts/docker-install.sh | bash
```

Or grab a binary from [Releases](../../releases):

| Platform | Server | Desktop |
|---|---|---|
| Linux x64 | `cellforge-linux-x64` | `cellforge-linux-x64-desktop.AppImage` |
| Linux ARM64 | `cellforge-linux-arm64` | — |
| macOS x64 | `cellforge-macos-x64` | `cellforge-macos-x64-desktop.dmg` |
| macOS ARM | `cellforge-macos-arm64` | `cellforge-macos-arm64-desktop.dmg` |
| Windows x64 | `cellforge-windows-x64.exe` | `cellforge-windows-x64-desktop.exe` |
| Windows ARM64 | `cellforge-windows-arm64.exe` | `cellforge-windows-arm64-desktop.exe` |

**Server** opens in your browser at http://localhost:8888. Single portable file with the frontend and Typst compiler embedded (~30 MB). **Desktop** is a native window (Linux AppImage, macOS .dmg, Windows .exe) — same features, no browser needed.

You need at least one Jupyter kernel installed: `pip install ipykernel`

---

## Highlights

- **Any Jupyter kernel** — Python, R, Julia, JavaScript, Kotlin, Go, and anything that speaks the Jupyter wire protocol. Auto-detects conda envs, venvs, and system installs.
- **Real-time collaboration** — open the same notebook in several tabs, devices, or user accounts (via file sharing); edits, cursors, cell ops, and outputs stay in sync via Yjs CRDT. Collaborators share one kernel process per language, so variables, execution state, and iopub streams converge across users.
- **Reactive execution** — AST-based cell dependency DAG, auto-reruns downstream cells on change.
- **Built-in viz library** — `import cellforge as cf` — charts, diagrams, widgets, progress bars. No pip install. [Docs](https://github.com/Subbok/cellforge/wiki/Built-in-Library)
- **PDF export via embedded Typst** — no LaTeX, no external tools. Custom `.typ` templates. [Docs](https://github.com/Subbok/cellforge/wiki/Writing-Typst-Templates)
- **Plugin system** — themes, Python helpers, custom renderers, toolbar buttons, sidebar panels, keybindings. [Docs](https://github.com/Subbok/cellforge/wiki/Writing-Plugins)
- **Per-kernel sandboxing** — each kernel runs in a bubblewrap jail with mount, PID, and network isolation on Linux; graceful fallback when kernel namespaces are unavailable (Docker default, restricted hosts). [Docs](https://github.com/Subbok/CellForge/wiki/Deployment-Security)
- **Multi-user** — SQLite accounts, JWT auth with session invalidation, bcrypt with constant-time fallback, per-user workspaces, file sharing with live collab, admin panel, per-group resource limits. Single binary, no JupyterHub.

CellForge ships as a ~30 MB binary. Compare: JupyterLab (~150 MB) + TeX Live for PDF export (~2-4 GB).

---

## Build from source

```bash
git clone https://github.com/Subbok/CellForge.git && cd CellForge

# Development (hot reload)
(cd frontend && npm ci) && scripts/dev.sh

# Production binary
(cd frontend && npm ci && npm run build)
cargo build --release -p cellforge-server --features embed-frontend
# → target/release/cellforge-server
```

### System packages

**Debian/Ubuntu:**
```bash
sudo apt install build-essential pkg-config
# For the desktop app (cellforge-app) also:
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
```

**macOS:**
```bash
xcode-select --install
```

**Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/?q=build+tools) with "Desktop development with C++".

### Toolchain

- Rust 1.85+ (install via [rustup](https://rustup.rs))
- Node.js 18+
- A Jupyter kernel — see below.

### Python + Jupyter kernel

CellForge talks to real Jupyter kernels. You need at least one:

```bash
# Option A — virtual environment (recommended, works everywhere including Debian 12+/PEP 668):
python3 -m venv .venv
. .venv/bin/activate
pip install ipykernel
python -m ipykernel install --user

# Option B — pipx (isolated global tool):
pipx install ipykernel

# Option C — system-wide (Debian 12+ / Ubuntu 24.04 need --break-system-packages):
pip install --break-system-packages ipykernel
```

CellForge auto-detects conda envs, venvs, and system Python — no manual configuration needed.

---

## Architecture

Rust workspace with 9 crates: `cellforge-server` (Axum HTTP/WS), `cellforge-kernel` (Jupyter/ZeroMQ), `cellforge-notebook` (ipynb format), `cellforge-reactive` (cell DAG), `cellforge-varexplorer` (runtime introspection), `cellforge-export` (Typst PDF), `cellforge-auth` (SQLite/JWT), `cellforge-config` (XDG paths), `cellforge-app` (desktop wrapper via wry/tao).

Frontend: React 19 + TypeScript + Monaco + Yjs + Zustand + Tailwind v4.

Tests: `cargo test --workspace` (190+ tests). Type-check: `cd frontend && npx tsc --noEmit`.

---

## Roadmap

- Debugger integration (breakpoints, step-through)
- Extension marketplace

## Contributing

Issues and PRs welcome. For bugs: include your OS, conda/venv/system Python, and `scripts/dev.sh` output.

## License

AGPL-3.0 — see [LICENSE](LICENSE).

## Acknowledgments

[Typst](https://typst.app) | [Yjs](https://yjs.dev) | [Monaco](https://microsoft.github.io/monaco-editor/) | [axum](https://github.com/tokio-rs/axum) | [Jupyter](https://jupyter.org) | [Tailwind](https://tailwindcss.com) | [Zustand](https://github.com/pmndrs/zustand) | [lucide](https://lucide.dev)
