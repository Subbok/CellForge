# CellForge

> A modern notebook IDE — Rust backend, React frontend, real Jupyter kernels, live collaboration, and PDF export via Typst.

![version](https://img.shields.io/badge/version-0.4.0-blue)
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

**Docker (pre-built, recommended):**

```bash
docker run --gpus all -p 8888:8888 -v ~/notebooks:/data \
  ghcr.io/subbok/cellforge-server:latest
```

Includes Python 3.12, PyTorch + CUDA 12.6, and the full ML stack. Drop `--gpus all` for CPU-only.

**Docker (custom kernels):**

```bash
curl -fsSL https://raw.githubusercontent.com/Subbok/CellForge/main/scripts/docker-install.sh | bash
```

Or grab a binary from [Releases](../../releases):

| Platform | Server | Desktop |
|---|---|---|
| Linux x64 | `cellforge-linux-x64` | — |
| Linux ARM64 | `cellforge-linux-arm64` | — |
| macOS x64 | `cellforge-macos-x64` | — |
| macOS ARM | `cellforge-macos-arm64` | — |
| Windows x64 | `cellforge-windows-x64.exe` | `cellforge-windows-x64-desktop.exe` |
| Windows ARM64 | `cellforge-windows-arm64.exe` | `cellforge-windows-arm64-desktop.exe` |

**Server** opens in your browser at http://localhost:8888. Single portable file with the frontend and Typst compiler embedded (~30 MB). **Desktop** (Windows only for now) is a native window — same features, no browser needed.

You need at least one Jupyter kernel installed: `pip install ipykernel`

---

## Highlights

- **Any Jupyter kernel** — Python, R, Julia, JavaScript, Kotlin, Go, and anything that speaks the Jupyter wire protocol. Auto-detects conda envs, venvs, and system installs.
- **Live collaboration** — Yjs CRDT with remote cursors, shared editing, broadcasted cell operations.
- **Reactive execution** — AST-based cell dependency DAG, auto-reruns downstream cells on change.
- **Built-in viz library** — `import cellforge as cf` — charts, diagrams, widgets, progress bars. No pip install. [Docs](https://github.com/Subbok/cellforge/wiki/Built-in-Library)
- **PDF export via embedded Typst** — no LaTeX, no external tools. Custom `.typ` templates. [Docs](https://github.com/Subbok/cellforge/wiki/Writing-Typst-Templates)
- **Plugin system** — themes, Python helpers, custom renderers, toolbar buttons, sidebar panels, keybindings. [Docs](https://github.com/Subbok/cellforge/wiki/Writing-Plugins)
- **Hub mode** — `--hub` enables resource limits, admin panel, user/group management. Single binary, no JupyterHub.
- **Multi-user** — SQLite accounts, JWT auth, per-user workspaces, file sharing.

CellForge ships as a ~30 MB binary. Compare: JupyterLab (~150 MB) + TeX Live for PDF export (~2-4 GB).

---

## Build from source

```bash
git clone https://github.com/Subbok/CellForge.git && cd CellForge

# Development (hot reload)
(cd frontend && npm install) && scripts/dev.sh

# Production binary
(cd frontend && npm install && npm run build)
cargo build --release -p cellforge-server --features embed-frontend
# → target/release/cellforge-server
```

**Requires:** Rust 1.85+, Node.js 18+, Python with `ipykernel`.

---

## Architecture

Rust workspace with 9 crates: `cellforge-server` (Axum HTTP/WS), `cellforge-kernel` (Jupyter/ZeroMQ), `cellforge-notebook` (ipynb format), `cellforge-reactive` (cell DAG), `cellforge-varexplorer` (runtime introspection), `cellforge-export` (Typst PDF), `cellforge-auth` (SQLite/JWT), `cellforge-config` (XDG paths), `cellforge-app` (desktop wrapper via wry/tao).

Frontend: React 19 + TypeScript + Monaco + Yjs + Zustand + Tailwind v4.

Tests: `cargo test --workspace` (190+ tests). Type-check: `cd frontend && npx tsc --noEmit`.

---

## Roadmap

- Container-per-user hub isolation
- Debugger integration (breakpoints, step-through)
- Extension marketplace

## Contributing

Issues and PRs welcome. For bugs: include your OS, conda/venv/system Python, and `scripts/dev.sh` output.

## License

AGPL-3.0 — see [LICENSE](LICENSE).

## Acknowledgments

[Typst](https://typst.app) | [Yjs](https://yjs.dev) | [Monaco](https://microsoft.github.io/monaco-editor/) | [axum](https://github.com/tokio-rs/axum) | [Jupyter](https://jupyter.org) | [Tailwind](https://tailwindcss.com) | [Zustand](https://github.com/pmndrs/zustand) | [lucide](https://lucide.dev)
