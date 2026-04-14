# 🧪 CellForge

> A modern notebook IDE — Rust backend, React frontend, real Jupyter kernels, live collaboration, and PDF export via Typst.

![version](https://img.shields.io/badge/version-0.4.0-blue)
![rust](https://img.shields.io/badge/rust-2024-orange)
![react](https://img.shields.io/badge/react-19-61dafb)
![status](https://img.shields.io/badge/status-work%20in%20progress-yellow)
![license](https://img.shields.io/badge/license-AGPL--3.0-green)

> ⚠️ **Heads up — CellForge is an early-stage, single-developer project.**
> It works well for my day-to-day notebook work, but expect rough edges: bugs, missing features, things that only ever got tested on one Linux box. If you hit something broken, open an issue — that's the fastest way to get it fixed.

**[Getting Started →](https://github.com/Subbok/CellForge/wiki/Getting-Started)** — download, install a kernel, and create your first notebook in under 5 minutes.

---

## 🌟 Highlights

- **Any Jupyter kernel** — works with every standard Jupyter kernel: Python (ipykernel), R (IRkernel), Julia (IJulia), JavaScript (ijavascript), Kotlin, Go, and anything else that speaks the Jupyter wire protocol. Discovers conda envs, venvs, and system installs automatically. Fixes `PATH`/`CONDA_PREFIX` so `!pip install` lands in the right environment. Cross-platform: Linux, macOS, Windows.
- **Multi-kernel notebooks** — use Python, R, and Julia in the same notebook. Per-cell language selector, automatic variable sharing between kernels via JSON/Arrow serialization.
- **Live collaboration out of the box** — Yjs CRDT over WebSocket with remote cursors, shared Y.Text per cell, broadcasted cell operations (add/delete/move), per-notebook kernel sharing.
- **Reactive execution** — an AST-based dependency analyzer rebuilds the cell DAG on every edit and auto-reruns downstream cells when an upstream variable changes.
- **Built-in visualization library** — `import cellforge as cf` gives you bar/line/pie/hbar charts, flow/sequence diagrams, stat tiles, callouts, progress bars, and interactive widgets — all without `pip install`. Works in the notebook, HTML export, and PDF export. [Full docs →](https://github.com/Subbok/cellforge/wiki/Built-in-Library)
- **Plugin system** — upload a zip to add themes, Python helpers, custom output renderers, toolbar buttons, sidebar panels, keyboard shortcuts, export formats, cell actions, and status bar items. Admin can control who installs plugins. [Writing plugins →](https://github.com/Subbok/cellforge/wiki/Writing-Plugins)
- **PDF export via Typst** — the Typst compiler is embedded directly in the binary — no separate install, no LaTeX, no external tools. Custom `.typ` templates with variable substitution, built-in lab-report template, HTML export as a fallback. [Writing templates →](https://github.com/Subbok/cellforge/wiki/Writing-Typst-Templates)
- **Hub mode** — `--hub` flag enables resource limits per user/group, admin panel with live kernel monitoring, user/group management. Works from a single binary — no JupyterHub, no nginx, no PostgreSQL.
- **Multi-user with per-user workspaces** — SQLite-backed accounts, JWT cookies, admin role, cross-user file sharing, isolated notebook directories.
- **Split-view sidebar** — Variables, Files, TOC, History, Dependencies (+ plugin panels) can be stacked two at a time with a resizable divider.
- **Runtime accent picker + themes** — accent color driven by a single CSS variable with contrast-aware foregrounds. Install theme plugins to change the full palette. [Writing themes →](https://github.com/Subbok/cellforge/wiki/Writing-Themes)

## ℹ️ Overview

CellForge is a Jupyter-flavored notebook environment built around a Rust axum server and a React + TypeScript + Monaco frontend. It talks to real Jupyter kernels over ZeroMQ using the standard messaging protocol, so any `ipykernel` install should work — including niche conda envs, venvs, and system Python.

It was built as a single-developer project to explore what a notebook IDE looks like when you don't start from Jupyter's Tornado server: you get proper per-user workspaces, a real live-collaboration layer, PDF export that doesn't need a LaTeX install, and an editor that feels responsive because the frontend never blocks on server round-trips for structural edits.

CellForge ships as a single portable binary (~30 MB) that includes the web frontend, the Typst PDF compiler, and the server. Compare that to a typical Jupyter setup: JupyterLab (~150 MB pip install) plus a LaTeX distribution for PDF export (~2–4 GB for TeX Live). CellForge replaces all of that with one download.

It's *not* a drop-in JupyterLab replacement — but it's gaining ground fast. It's a focused, opinionated tool for writing notebooks and producing readable PDFs from them.

## 🐳 Docker

```bash
docker build -t cellforge .
docker run -p 8888:8888 -v ~/notebooks:/data cellforge
```

Or use the interactive setup script to choose which kernels to include:

```bash
curl -fsSL https://raw.githubusercontent.com/Subbok/CellForge/main/scripts/docker-install.sh | bash
```

Open http://localhost:8888 — notebooks are stored in `~/notebooks`.

## ⬇️ Downloads

Portable binaries for every release are on the [Releases](../../releases) page — one file per platform, no install required:

| Platform | Server (browser) | Desktop app |
|---|---|---|
| Linux x64 | `cellforge-linux-x64` | `cellforge-linux-x64-desktop` |
| Linux ARM64 | `cellforge-linux-arm64` | — |
| macOS x64 | `cellforge-macos-x64` | `cellforge-macos-x64-desktop` |
| macOS ARM | `cellforge-macos-arm64` | `cellforge-macos-arm64-desktop` |
| Windows x64 | `cellforge-windows-x64.exe` | `cellforge-windows-x64-desktop.exe` |
| Windows ARM64 | `cellforge-windows-arm64.exe` | `cellforge-windows-arm64-desktop.exe` |

**Quick install (Linux x64):**
```bash
curl -fsSL https://github.com/Subbok/CellForge/releases/latest/download/cellforge-linux-x64 -o cellforge && chmod +x cellforge && ./cellforge
```

**Server** — opens in your browser at http://localhost:8888. One portable binary with the frontend embedded.

**Desktop** — native window (system webview), no browser needed. Same features, starts the server in the background automatically.

## 🚀 Quick start (from source)

```bash
git clone <your-fork>
cd cellforge

# first-time only: install frontend dependencies
(cd frontend && npm install)

# build the backend, start both servers
scripts/dev.sh
```

Then open http://localhost:3000 — you'll be asked to create an admin account on first run. Pass any working directory to serve from:

```bash
scripts/dev.sh --notebook-dir ~/research
```

By default the frontend is also exposed on your LAN (`vite --host`), so you can open the same URL on any device connected to your network — the app works over plain HTTP because UUID generation and clipboard fall back to non-secure-context variants.

## 🧰 Prerequisites

- **Rust** — toolchain with edition 2024 support (tested on stable 1.85+)
- **Node.js** — 18+ for Vite 8
- **Python** with `ipykernel` installed:
  ```bash
  # conda
  conda create -n lab python ipykernel

  # or just pip (works on Windows too)
  pip install ipykernel
  ```
- **Linux, macOS, or Windows** — all three platforms are supported. On Windows, Python from python.org, the `py` launcher, and conda/miniforge are all detected automatically.

## ⬇️ Installation

**Recommended:** grab a portable binary from [Releases](../../releases) — it has the frontend embedded, nothing else to install.

**From source** (if you want to hack on it):

```bash
git clone <your-fork>
cd cellforge

# frontend
(cd frontend && npm install && npm run build)

# portable binary with embedded frontend
cargo build --release -p cellforge-server --features embed-frontend

# → target/release/cellforge-server (single file, run anywhere)
```

For development, `scripts/dev.sh` runs the backend + Vite dev server with hot reload.

## 🏗️ Architecture

The backend is a cargo workspace of seven focused crates:

| Crate | Responsibility |
|---|---|
| `cellforge-server` | Axum HTTP + WebSocket server, auth routes, file ops, exports, collab |
| `cellforge-kernel` | Jupyter messaging protocol (ZeroMQ), kernel launcher, env detection |
| `cellforge-notebook` | `.ipynb` nbformat (de)serialization |
| `cellforge-reactive` | Python AST dependency analyzer and cell DAG scheduler |
| `cellforge-varexplorer` | Runtime variable introspection over the kernel |
| `cellforge-export` | Typst-based PDF compiler, HTML export, template management |
| `cellforge-auth` | SQLite user database, JWT cookies, password hashing |
| `cellforge-config` | Centralized XDG-compliant config path helpers |

The frontend is a single Vite + React 19 app:

```
frontend/src
├── components/       # Dashboard, Settings, notebook, sidebar, modals
├── stores/           # Zustand — notebook, kernel, tabs, UI (persisted)
├── services/         # websocket, api, collaboration, execution queue
├── hooks/            # keybindings, cell drag, kernel exec
└── lib/              # uuid, clipboard, diff, ansi, types
```

Notable frontend pieces:

- **Monaco editor** with kernel-backed completions, breakpoints, and a paused-at-line indicator wired to the debugger step/continue flow.
- **Yjs + y-monaco** for per-cell collaborative editing, plus a sidechannel for structural cell operations (add/delete/reorder) that don't fit the CRDT model.
- **Zustand** stores with `localStorage` persistence for UI state (sidebar width, accent color, split ratio).
- **Tailwind v4** with a tiny component layer in `index.css` — `.btn`/`.btn-primary`/`.field`/`.modal-panel` — so the visual system stays consistent across modals.

## ⚙️ Configuration

Backend CLI flags (`cellforge-server --help`):

```
--host <HOST>           Bind address (default: 0.0.0.0)
--port <PORT>           Port to listen on (default: 8888)
--notebook-dir <PATH>   Working directory for notebooks (default: .)
--hub                   Enable hub mode (admin panel, resource limits, groups)
--idle-timeout <MINS>   Idle kernel timeout in minutes (default: 30)
--no-update-check       Disable startup update check
<NOTEBOOK>              Optional initial notebook to open
```

Runtime state lives under `~/.config/cellforge/`:

```
users.db                 — SQLite user database
users/<name>/notebooks/  — per-user workspace (kernels cwd here)
templates/               — installed PDF export templates
pylib/                   — built-in Python helpers (cellforge_ui etc.)
```

The `pylib/` directory is automatically added to every kernel's `PYTHONPATH`, so `import cellforge_ui` always works regardless of where the notebook lives on disk.

## 🎨 Customization

**PDF templates** — drop a `.typ` file into `~/.config/cellforge/templates/<name>/template.typ` (or upload via Settings → PDF Export Templates). A `#let config = (...)` block with string fields becomes a form in the export dialog:

```typst
#let config = (
  author:     "",
  course:     "",
  date:       "{{today}}",
)

= #config.course
_by #config.author on #config.date_

{{content}}
```

`{{content}}` is replaced with the compiled notebook body; `{{today}}` with the current date in `DD.MM.YYYY`.

**Accent color** — Settings → Accent color. Eight curated swatches plus a custom hex input. All primary buttons, selection highlights and active cell indicators are driven by a single CSS variable with luminance-aware text color flipping between white and near-black.

**Widgets** — inside a notebook cell:

```python
import cellforge_ui as ui
import numpy as np

amp  = ui.slider("Amplitude", min=0.1, max=5.0, step=0.1, value=1.0)
freq = ui.slider("Frequency", min=1, max=20, value=5)
amp
freq
```

Dropping a widget as the last expression of a cell renders it below the cell. The `.value` attribute reads the latest state.

## 🗺️ Roadmap

- **Docker-based hub** — container-per-user isolation for larger deployments.
- **Debugger integration** — breakpoints, step-through, variable inspection.
- **Extension marketplace** — browse and install plugins from a central registry.

## 🧪 Development

```bash
# run everything (backend + vite --host)
scripts/dev.sh

# type-check the frontend
cd frontend && npx tsc --noEmit

# check the whole workspace
cargo check --workspace

# build a release binary
cargo build --release -p cellforge-server
```

Run tests with `cargo test --workspace` (186+ tests across the workspace).

## 💭 Feedback and Contributing

Issues and PRs welcome in the repo's Issues tab. If you're reporting a bug, please include:

- Your OS and whether you're on conda / venv / system Python
- The output of `scripts/dev.sh` (backend logs are especially useful — they're chatty on purpose)
- Steps to reproduce

Feature requests are fine but keep in mind this is a single-developer project — I prioritize things that make the existing experience smoother over adding new surface area.

## ✍️ Authors

**suddoku** — initial work and ongoing development.

## 📜 License

AGPL-3.0 — see [LICENSE](LICENSE). You can use, modify, and distribute CellForge freely. If you modify it and offer it as a service, you must release the source code.

## 💡 Acknowledgments

Standing on the shoulders of:

- [**Typst**](https://typst.app) — document typesetting engine, used as a LaTeX-free PDF backend.
- [**Yjs**](https://yjs.dev) and [**y-monaco**](https://github.com/yjs/y-monaco) — the CRDT layer that makes live collaboration trivial.
- [**Monaco Editor**](https://microsoft.github.io/monaco-editor/) — the editor behind every cell.
- [**axum**](https://github.com/tokio-rs/axum), [**tokio**](https://tokio.rs), [**zeromq-rs**](https://github.com/zeromq/zmq.rs) — the backend stack.
- [**Jupyter**](https://jupyter.org) — the `.ipynb` format and messaging protocol we target.
- [**Tailwind CSS v4**](https://tailwindcss.com), [**lucide**](https://lucide.dev), [**Zustand**](https://github.com/pmndrs/zustand) — the frontend toolkit.
