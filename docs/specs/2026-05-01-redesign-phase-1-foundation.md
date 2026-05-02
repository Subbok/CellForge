# Redesign — Phase 1: Foundation

**Date:** 2026-05-01
**Scope:** First slice of the "Forge" frontend redesign described in `design_handoff_cellforge_redesign/README.md`. This phase replaces design tokens and fonts only — no React components, no layouts, no logic touched. The app must keep running identically afterwards.

**Direction picked (from brainstorming):** Option A — full redesign (top-nav shell), executed across multiple phases. This is Phase 1 of ~8.

## Goal

After Phase 1:

- Background goes pure black (`#000`).
- Default accent flips from blue to violet (`#a78bfa`); user-selectable accent picker keeps working and overrides apply globally (logo, wordmark, buttons, focus rings — everywhere).
- Body font becomes Geist; mono stays JetBrains Mono; Space Grotesk loaded but not yet used (reserved for the wordmark in Phase 2).
- Global radius for `rounded-lg` becomes 10px (handoff value).
- All existing components continue to render through the same Tailwind tokens — no JSX changes.

## Non-goals (deferred to later phases)

- New shell / top-nav / `FFNav` — Phase 2
- Logo and wordmark components — Phase 2
- Login screen redesign — Phase 3
- Home / Files / Notebook / Settings / Admin / Kernels / Plugins / Modals — Phases 3–8
- Button geometry changes (`h-9`, `px-3.5` etc.) — touched per-screen as those screens get redesigned
- Light mode — out of scope until handoff covers it

## Token map

Existing token names are kept so no consumer changes. Values move to handoff equivalents.

| Handoff token | Existing token (kept) | Old value | New value |
|---|---|---|---|
| `--bg` (page bg) | `--color-bg` | `#13141b` | `#000000` |
| `--bg-1` (cards) | `--color-bg-secondary` | `#161823` | `#141414` |
| `--bg-2` (inputs, sub-rows) | `--color-bg-elevated` | `#242736` | `#242424` |
| `--bg-3` (hover, active) | `--color-bg-hover` | `#2b2e3d` | `#383838` |
| `--bg-1` (output/cards) | `--color-bg-output` | `#161823` | `#141414` |
| `--line-2` (input borders) | `--color-border` | `#3f4154` | `rgba(255,255,255,0.10)` |
| `--line` (hairlines) | **new** `--color-border-subtle` | — | `rgba(255,255,255,0.06)` |
| `--fg` (primary text) | `--color-text` | `#ebedf2` | `#f4f5f7` |
| `--fg-2` (labels) | `--color-text-secondary` | `#a8adba` | `rgba(255,255,255,0.72)` |
| `--fg-3` (hints, meta) | `--color-text-muted` | `#7d8390` | `rgba(255,255,255,0.46)` |
| accent default | `DEFAULT_ACCENT` (uiStore.ts) | `#7a99ff` | `#a78bfa` |
| accent fg (auto-flip) | `--color-accent-fg` | `#ffffff` (default) | `#0a0a0a` (when on light accent) — logic unchanged, picks via luminance |
| success | `--color-success` | `#34d399` | `#4ade80` |
| info | **new** `--color-info` | — | `#60a5fa` |
| warning | `--color-warning` | `#fbbf24` | `#fbbf24` (kept) |
| error | `--color-error` | `#f87171` | `#ef4444` |
| cell active | `--color-cell-active` | `#7a99ff` | follows accent (already runtime-bound in `App.tsx`) |
| cell stale | `--color-cell-stale` | `#fbbf24` | `#fbbf24` (kept) |
| cell running | `--color-cell-running` | `#a78bfa` | `#a78bfa` (kept — coincidence with new accent is fine) |

Notes:

- `--color-bg-output` is collapsed onto `--color-bg-secondary` in value but kept as a separate token. Splitting them again later is trivial if any screen needs it.
- The runtime accent override in `App.tsx` (lines 167–181) stays as-is. It writes `--color-accent`, `--color-cell-active`, `--color-accent-hover`, `--color-accent-fg`. The default in `@theme` is just the seed before the user picks one.

## Radius

Tailwind v4 lets us override `--radius-lg` inside `@theme`. Setting it to `10px` makes every existing `.rounded-lg` (used on buttons, inputs, modals, cards) take the new value with zero JSX edits. Other radii (`rounded`, `rounded-md`, `rounded-xl`, `rounded-full`) stay at Tailwind defaults — handoff calls out 10px specifically for cards/buttons/inputs/modals, which is exactly the `lg` set.

## Density

Drop `--ui-root-size: 16.5px` override. Browser default (16px) is what the handoff's type scale assumes. Body `font-size: 13px` is set on `body` (handoff: "Body 13 / 400 / 1.5"). All Tailwind text-sizing utilities then resolve from a 16px root, matching design references.

Risk: a few places might rely on the old root scaling. Mitigation: smoke-test the running app after the change and adjust per-screen later if anything breaks.

## Fonts

Self-hosted via `@fontsource/*` npm packages. Reasoning:

- AppImage and any future hub-mode deployment need offline fonts.
- CDN is one less network round-trip on cold load.
- `@fontsource` is the standard pattern for self-hosting Google Fonts in Vite/React projects.

Current state (verified): no font packages installed, no `<link>` in `index.html`, no `@import` in CSS. Both Inter and JetBrains Mono have been falling back to system fonts. Phase 1 actually starts loading custom fonts for the first time — UI typography will visibly change for everyone.

Packages added (all three are new):

- `@fontsource/geist`
- `@fontsource/space-grotesk`
- `@fontsource/jetbrains-mono`

Imports added to `frontend/src/main.tsx` (top of file, before any component import):

```ts
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist/700.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
```

Token update in `index.css`:

```css
--font-sans: "Geist", system-ui, -apple-system, sans-serif;
```

Mono token unchanged.

`body { font-family: var(--font-sans); font-size: 13px; }` — explicit 13px body to match the handoff scale.

## Files touched

1. `frontend/package.json` + `package-lock.json` — add `@fontsource/geist` and `@fontsource/space-grotesk` (and `@fontsource/jetbrains-mono` if missing). User runs `npm install`.
2. `frontend/src/main.tsx` — add font CSS imports at top.
3. `frontend/src/index.css` — replace `@theme` token block with new values; add `--color-border-subtle` and `--color-info`; override `--radius-lg`; remove `--ui-root-size` line and `html { font-size: ... }` rule; set `body { font-size: 13px }`.
4. `frontend/src/stores/uiStore.ts` — change `DEFAULT_ACCENT` from `#7a99ff` to `#a78bfa`.

That's it. No `.tsx` files of components are edited in Phase 1.

## Verification

1. `npm install` runs cleanly.
2. `npm run build` (Vite) completes without errors.
3. Dev server boots; login screen renders (still old layout, just new colors and font).
4. DevTools: `:root` exposes new token values; `--font-sans` is `Geist`.
5. Existing user with persisted blue accent still sees blue (override is per-user); a fresh user picks up violet default.
6. Settings → Appearance accent picker still works — pick a different color, it overrides everywhere as before.

## Risks and known dings

- **Subtle borders.** New `--color-border` is `rgba(255,255,255,0.10)` over `#000` ≈ `#1a1a1a`. Existing component layer uses borders heavily (e.g., `.btn-secondary`, `.field`, `.modal-panel`). They'll look much subtler. This is intended — handoff calls for hairline-style borders. If any specific component looks broken (lost shape entirely), we patch that component when its screen comes up in a later phase.
- **Hardcoded hex values in components.** Some components may use literal hex (`#13141b` etc.) instead of tokens. After the token change, those become out-of-place dark blocks on a black page. I'll grep for hex literals after editing tokens and surface a list — fixes are deferred to relevant screen phases unless something is glaringly broken at the global level.
- **Body font 13px.** Forms a coherent scale with handoff; might surprise a few spots that assume root 14px from `text-sm` × 16.5/16. Should be fine in practice.
- **Geist availability.** Verify `@fontsource/geist` exists on npm before relying on it. If only `geist-sans` is published under that name, adjust import path.

## Verified before write

- `--ui-root-size` is only declared and self-referenced inside `index.css`. No Settings UI binds to it. Safe to remove in Phase 1.
- No font packages are currently installed; no `<link>` to a font CDN in `index.html`. Phase 1 introduces font loading for the first time.
