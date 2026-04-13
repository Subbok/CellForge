# solarized-dark

A minimal theme-only plugin for CellForge. It contributes a single theme
"Solarized Dark" based on Ethan Schoonover's palette.

## Install

Pack it as a ZIP:

```bash
cd examples/plugins
zip -r solarized-dark.zip solarized-dark
```

Then in CellForge:

1. Open **Settings → Plugins**
2. Click **Upload plugin**, pick `solarized-dark.zip`
3. Switch to **Settings → Themes → Solarized Dark**

The theme applies live — no restart needed.

## How it works

`plugin.json` declares a single theme under `contributes.themes`. Each
theme is a list of CSS variable overrides. CellForge applies them inline
on `<html>` when the theme is selected, replacing the built-in Crisp
defaults from `index.css`.

The user-chosen accent color still wins over `--color-accent` from the
theme — that's intentional, so the accent picker stays meaningful even
when a bold theme is active.

## Required CSS variables

A theme can override any of the following, and unlisted variables fall
back to built-in Crisp:

- `--color-bg` — page background
- `--color-bg-secondary` — topbar, sidebar background
- `--color-bg-elevated` — code block background
- `--color-bg-output` — cell output background
- `--color-bg-hover` — generic hover highlight
- `--color-border` — panel separators
- `--color-text` — primary text
- `--color-text-secondary` — secondary text (buttons, labels)
- `--color-text-muted` — muted hints, metadata
- `--color-accent` — primary accent color (overridden by user's picker)
- `--color-accent-hover` — accent on hover
- `--color-accent-fg` — foreground for text on accent backgrounds
- `--color-cell-active` — active cell indicator
- `--color-success` / `--color-warning` / `--color-error` — status colors

See `docs/writing-themes.md` in the main repo for the full list with
notes on contrast and accessibility.
