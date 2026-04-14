# Getting Started

CellForge is a notebook IDE that runs as a single binary. This guide gets you from download to your first notebook in under 5 minutes.

---

## 1. Download

Grab the latest binary for your platform from the [Releases page](https://github.com/Subbok/cellforge/releases/latest):

| Platform | File |
|---|---|
| Linux x64 | `cellforge-linux-x64` |
| macOS x64 | `cellforge-macos-x64` |
| macOS ARM (M1/M2/M3) | `cellforge-macos-arm64` |
| Windows x64 | `cellforge-windows-x64.exe` |

The frontend is embedded in the binary — no Node.js, no unpacking. Just download and run.

## 2. Install a Python kernel

CellForge talks to real Jupyter kernels. You need at least one installed:

```bash
# Option A: pip (simplest)
pip install ipykernel

# Option B: conda
conda create -n notebooks python ipykernel
conda activate notebooks

# Option C: system package (Debian/Ubuntu)
sudo apt install python3-ipykernel
```

CellForge auto-detects conda envs, venvs, and system Python — no manual configuration needed.

## 3. Start CellForge

```bash
# Linux / macOS
chmod +x cellforge-linux-x64
./cellforge-linux-x64

# Windows
cellforge-windows-x64.exe
```

Open **http://localhost:8888** in your browser.

### First launch

On the first visit you'll be asked to create an **admin account**. Pick any username and password — this is stored locally in `~/.config/cellforge/users.db`.

## 4. Create your first notebook

1. Click **New notebook** on the home dashboard
2. Select a kernel (e.g. "Python 3")
3. Type some code in the first cell:
   ```python
   import cellforge as cf
   cf.callout("Hello from CellForge!", kind="success", title="It works")
   ```
4. Press **Shift+Enter** to run

## 5. Built-in library

Every CellForge notebook has access to `import cellforge as cf` — no pip install needed. Quick examples:

```python
# Charts
cf.bar([42, 78, 55], labels=["Mon", "Tue", "Wed"], title="Commits")
cf.line([3, 7, 4, 9, 5], color="#ff79c6", title="Trend")
cf.pie([45, 30, 25], labels=["Python", "Rust", "Other"])

# Widgets
speed = cf.slider("Speed", min=1, max=100, value=50)
opt = cf.dropdown("Optimizer", options=["Adam", "SGD", "AdamW"])

# UI elements
cf.stat("Accuracy", "94.2%", delta="+1.3%")
cf.callout("Training complete!", kind="success")
cf.progress(73, 100, label="Epoch 73/100")

# Live progress (like tqdm)
for i in cf.track(range(100), label="Processing"):
    ...
```

[Full library reference →](https://github.com/Subbok/cellforge/wiki/Built-in-Library)

## 6. Export to PDF

CellForge has a built-in Typst compiler — no LaTeX needed.

1. Click the **Export** button in the toolbar (or press the export icon)
2. Choose **PDF (Typst)** or **HTML**
3. Select a template (e.g. "blank" or "lab-report")
4. Fill in any template variables (author, course, etc.)
5. Click **Export**

You can upload custom Typst templates via **Settings → PDF Export Templates**.

[Writing custom templates →](https://github.com/Subbok/cellforge/wiki/Writing-Typst-Templates)

## 7. Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Shift+Enter` | Run cell and advance |
| `Ctrl+Enter` | Run cell, stay |
| `Alt+Enter` | Run cell, insert below |
| `↑` / `↓` | Navigate cells (command mode) |
| `A` / `B` | Insert cell above / below |
| `DD` | Delete cell (double tap) |
| `M` / `Y` | Switch to Markdown / Code |
| `Ctrl+S` | Save notebook |
| `?` | Show all shortcuts |

## 8. Working directory

By default CellForge serves notebooks from the current directory. To use a different folder:

```bash
./cellforge-linux-x64 --notebook-dir ~/research
```

Or open a specific notebook directly:

```bash
./cellforge-linux-x64 ~/research/analysis.ipynb
```

## 9. Optional: Docker

```bash
docker build -t cellforge .
docker run -p 8888:8888 -v ~/notebooks:/data cellforge
```

## Next steps

- [Built-in Library](https://github.com/Subbok/cellforge/wiki/Built-in-Library) — charts, widgets, diagrams
- [Writing Plugins](https://github.com/Subbok/cellforge/wiki/Writing-Plugins) — extend CellForge
- [Writing Themes](https://github.com/Subbok/cellforge/wiki/Writing-Themes) — customize the look
- [Writing Templates](https://github.com/Subbok/cellforge/wiki/Writing-Typst-Templates) — custom PDF layouts
