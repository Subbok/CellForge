# Writing Templates

CellForge uses [Typst](https://typst.app/) templates for PDF export.
Templates live in `~/.config/cellforge/templates/`, each in its own
directory.

## Template structure

```
templates/
  lab-report/
    template.typ
    logo.png          (optional asset)
  blank/
    template.typ
```

Each template directory must contain a `template.typ` file. Any other
files in the directory are treated as assets (images, fonts, etc.)
that the template can reference.

## The `{{content}}` placeholder

Every template must include a `{{content}}` placeholder. CellForge
replaces this with the rendered notebook content during export:

```typst
#set page(paper: "a4")
#set text(size: 11pt)

{{content}}
```

## Variables

Templates can declare user-configurable variables using a
`#let config = (...)` block. CellForge parses this block and
shows input fields in the export dialog.

```typst
#let config = (
  title: "",
  author: "",
  date: "{{today}}",
)
```

Each key becomes a labeled input field. The default values are
pre-filled.

### Built-in variable substitutions

| Variable      | Replaced with               |
| ------------- | --------------------------- |
| `{{content}}` | Rendered notebook cells     |
| `{{today}}`   | Current date (YYYY-MM-DD)   |
| `{{title}}`   | Notebook filename (no ext)  |

### Asset variables

If a template variable name contains `logo`, `image`, or `asset`,
the export dialog renders a file picker (dropdown of images uploaded as
template assets) instead of a plain text field. The variable value is
set to the selected filename (e.g. `"logo.png"`).

```typst
#let config = (
  logo: "",        // ← shows file picker in export dialog
  author: "",      // ← shows text input
)

#if config.logo != "" {
  #image(config.logo, height: 2cm)
}
```

## Page setup

Typst supports extensive page configuration:

```typst
#set page(
  paper: "a4",
  margin: (x: 2cm, y: 2.5cm),
  header: [My Report],
  footer: context [Page #here().page()],
)
```

## Code blocks

The built-in templates style code blocks with a light gray
background:

```typst
#show raw.where(block: true): set text(size: 9pt)
#show raw.where(block: true): block.with(
  fill: luma(245),
  inset: 8pt,
  radius: 4pt,
  width: 100%,
)
```

## Managing templates

Templates can be managed through the CellForge UI:

- **Upload:** Settings page or the export dialog
- **Delete:** Settings page
- **Assets:** Upload images/fonts alongside the template

## Tips

- Start with the `blank` template and customize from there.
- Use `{{today}}` in date fields for automatic date insertion.
- Keep templates self-contained -- reference assets by filename
  only (e.g. `#image("logo.png")`), not by absolute path.
