# Writing Plugins

CellForge plugins are ZIP archives containing a `plugin.json` manifest
and optional frontend/backend contributions.

## Plugin structure

A minimal plugin looks like this:

```
my-plugin/
  plugin.json
  frontend/
    plugin.js
  pylib/
    my_plugin.py
```

## The manifest (`plugin.json`)

Every plugin must have a `plugin.json` at the root of the ZIP:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "display_name": "My Plugin",
  "description": "A short description.",
  "author": "Your Name",
  "contributes": {
    "themes": [],
    "widgets": [],
    "pylib": [],
    "toolbar_buttons": [],
    "sidebar_panels": [],
    "cell_actions": [],
    "keybindings": [],
    "export_formats": [],
    "status_bar_items": []
  }
}
```

The `name` field must be lowercase alphanumeric with dashes only
(e.g. `my-plugin`, `solarized-dark`). It is used as the on-disk
directory name.

## Frontend module

If your plugin contributes toolbar buttons, sidebar panels, widgets,
or other UI elements, you need a `frontend/plugin.js` file that
exports a `register(ctx)` function:

```javascript
export default function register(ctx) {
  ctx.registerCommand("my-plugin.hello", () => {
    alert("Hello from my plugin!");
  });
}
```

See [Writing Themes](writing%20themes.md) for full details.

## Contribution types

CellForge supports nine contribution types:

| Type              | Description                                |
| ----------------- | ------------------------------------------ |
| `themes`          | CSS variable overrides for color theming   |
| `widgets`         | Custom HTML elements for MIME rendering    |
| `pylib`           | Python files injected into the kernel      |
| `toolbar_buttons` | Buttons added to the notebook toolbar      |
| `sidebar_panels`  | Panels in the left sidebar                 |
| `cell_actions`    | Context-menu actions on individual cells   |
| `keybindings`     | Keyboard shortcuts bound to commands       |
| `export_formats`  | Additional export format options           |
| `status_bar_items`| Items shown in the bottom status bar       |

## Plugin scopes

Plugins can be installed at two scopes:

- **System** -- available to all users (admin-only install)
- **User** -- per-user install, stored in the user's config directory

When a user-scoped plugin has the same name as a system-scoped one,
the user version takes precedence for that user.

## Plugin pylib injection

Files listed in `contributes.pylib` are copied into the kernel's
working directory before execution. This lets plugins ship helper
Python modules that notebooks can `import` directly.

## Updating plugins

When you upload a newer version of an installed plugin (e.g. 1.0.0 → 2.0.0),
CellForge replaces the existing plugin directory atomically:

1. The new ZIP is extracted to a staging directory
2. The manifest is validated (name must match the existing plugin)
3. The old plugin directory is removed
4. The staging directory is renamed into place

If extraction or validation fails, the old version stays intact — no
partial upgrades.

**Reload required:** After updating a plugin that has frontend
contributions, refresh the page to load the new JavaScript module.
Python modules (`pylib`) are re-synced on the next kernel launch.

## Plugin crash behavior

If a plugin's JavaScript module throws an error during `register()`:

- The error is logged to the browser console with `[plugins]` prefix
- The plugin's contributions are skipped (no toolbar buttons, no
  sidebar panels, etc. from that plugin)
- All other plugins and the rest of CellForge continue to work normally
- The plugin still appears in Settings → Plugins so it can be removed

A crashing plugin cannot break the notebook editor or other plugins.

## Tips

- Use the `cellforge-demo` example plugin as a reference -- it
  exercises all nine contribution types.
- Plugin names must match their directory name on disk. If they
  don't match, the scanner will skip the plugin.
- Keep frontend bundles small. The browser loads them on every
  page load.
- Test your plugin by uploading it through Settings and checking
  the browser console for `[plugins]` messages.
