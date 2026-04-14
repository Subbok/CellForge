use anyhow::Result;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;

/// Where templates live — ~/.config/cellforge/templates/
/// Each template is a directory containing template.typ + any assets (images etc)
pub fn templates_dir() -> PathBuf {
    cellforge_config::templates_dir()
}

fn template_dir(name: &str) -> PathBuf {
    templates_dir().join(name)
}

/// List all available templates.
pub fn list_templates() -> Vec<TemplateInfo> {
    let dir = templates_dir();
    let mut templates = vec![];

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let typ_file = p.join("template.typ");
                if typ_file.exists() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let content = std::fs::read_to_string(&typ_file).unwrap_or_default();
                    let variables = parse_config_variables(&content);
                    let assets = list_asset_names(&p);
                    templates.push(TemplateInfo {
                        name,
                        variables,
                        assets,
                    });
                }
            }
            // also support bare .typ files (legacy)
            if p.extension().is_some_and(|e| e == "typ") && p.is_file() {
                let name = p
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                // migrate: move into directory
                let new_dir = template_dir(&name);
                let _ = std::fs::create_dir_all(&new_dir);
                let _ = std::fs::rename(&p, new_dir.join("template.typ"));
                let content =
                    std::fs::read_to_string(new_dir.join("template.typ")).unwrap_or_default();
                let variables = parse_config_variables(&content);
                let assets = list_asset_names(&new_dir);
                templates.push(TemplateInfo {
                    name,
                    variables,
                    assets,
                });
            }
        }
    }

    templates.sort_by(|a, b| a.name.cmp(&b.name));
    templates
}

#[derive(Debug, Clone, Serialize)]
pub struct TemplateInfo {
    pub name: String,
    pub variables: Vec<TemplateVariable>,
    /// Asset filenames in the template directory (images, fonts, etc.)
    pub assets: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TemplateVariable {
    pub key: String,
    pub default_value: String,
}

/// List asset filenames in a template directory (everything except template.typ).
fn list_asset_names(dir: &std::path::Path) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname != "template.typ" && entry.path().is_file() {
                names.push(fname);
            }
        }
    }
    names.sort();
    names
}

/// Read template content.
pub fn read_template(name: &str) -> Result<String> {
    let typ_path = template_dir(name).join("template.typ");
    if typ_path.exists() {
        return Ok(std::fs::read_to_string(&typ_path)?);
    }
    // legacy bare file
    let bare = templates_dir().join(format!("{name}.typ"));
    Ok(std::fs::read_to_string(&bare)?)
}

/// Get all asset files for a template (images etc) as name → bytes.
pub fn template_assets(name: &str) -> HashMap<String, Vec<u8>> {
    let dir = template_dir(name);
    let mut assets = HashMap::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname == "template.typ" {
                    continue;
                }
                if let Ok(data) = std::fs::read(&p) {
                    assets.insert(fname, data);
                }
            }
        }
    }

    assets
}

/// Save a template (creates directory + template.typ).
pub fn save_template(name: &str, content: &str) -> Result<()> {
    let dir = template_dir(name);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("template.typ"), content)?;
    Ok(())
}

/// Save a template asset file (image etc).
pub fn save_template_asset(name: &str, filename: &str, data: &[u8]) -> Result<()> {
    let dir = template_dir(name);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(filename), data)?;
    Ok(())
}

/// Delete a template.
pub fn delete_template(name: &str) -> Result<()> {
    let dir = template_dir(name);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)?;
    } else {
        // legacy bare file
        let bare = templates_dir().join(format!("{name}.typ"));
        std::fs::remove_file(&bare)?;
    }
    Ok(())
}

/// Install built-in templates and keep their .typ files in sync with the
/// embedded source. No binary assets are shipped — users who want a logo
/// upload their own template with the image as an asset.
pub fn ensure_builtin_templates() {
    // blank
    let blank_dir = template_dir("blank");
    let _ = std::fs::create_dir_all(&blank_dir);
    let _ = std::fs::write(blank_dir.join("template.typ"), BLANK_TEMPLATE);

    // lab-report (logo defaults to "" — no image, centered title page)
    let report_dir = template_dir("lab-report");
    let _ = std::fs::create_dir_all(&report_dir);
    let _ = std::fs::write(report_dir.join("template.typ"), LAB_REPORT_TEMPLATE);
}

// keep old name working
pub fn ensure_default_template() {
    ensure_builtin_templates();
}

/// Parse variables from the template's `#let config = (...)` block.
fn parse_config_variables(content: &str) -> Vec<TemplateVariable> {
    let mut vars = vec![];

    // look for #let config = ( ... ) block
    let Some(start) = content.find("#let config = (") else {
        return vars;
    };
    let after = &content[start + "#let config = (".len()..];
    let Some(end) = after.find(')') else {
        return vars;
    };
    let block = &after[..end];

    for line in block.lines() {
        let trimmed = line.trim().trim_end_matches(',');
        if let Some((key, val)) = trimmed.split_once(':') {
            let key = key.trim().trim_matches('"');
            let val = val.trim();
            // extract value from quotes
            let clean_val = if val.starts_with('"') && val.len() > 1 {
                val.trim_matches('"').to_string()
            } else {
                val.to_string()
            };
            vars.push(TemplateVariable {
                key: key.to_string(),
                default_value: clean_val,
            });
        }
    }

    vars
}

pub const BLANK_TEMPLATE: &str = r#"
#set page(paper: "a4", margin: (x: 2cm, y: 2.5cm))
#set text(font: "New Computer Modern", size: 11pt, lang: "pl", number-type: "lining")
#show math.equation: set text(font: "New Computer Modern Math")
#show raw: set text(font: "New Computer Modern Mono")
#set par(justify: true)

// code blocks — light gray bg
#show raw.where(block: true): set text(size: 9pt)
#show raw.where(block: true): block.with(
  fill: luma(245),
  inset: 8pt,
  radius: 4pt,
  width: 100%,
)

{{content}}
"#;

pub const LAB_REPORT_TEMPLATE: &str = r##"// Lab Report Template
// Set `logo` to "" (empty) to skip the logo and rely on pure centered title content.

#let config = (
  course-short: "",
  course-full:  "",
  lab-title:    "",
  lab-number:   "",
  doc-type:     "",
  author:       "",
  student-id:   "",
  logo:         "",
  date:          "{{today}}",
)

#let clr = (
  rule:   rgb("#333333"),
  header: rgb("#222222"),
)

#let header-content = context {
  set text(size: 9pt, fill: clr.header)
  grid(
    columns: (1fr, 1fr),
    align(left, config.course-short),
    align(right, config.lab-title),
  )
  line(length: 100%, stroke: 0.4pt + clr.rule)
}

#let footer-content = context {
  set text(size: 9pt, fill: clr.header)
  line(length: 100%, stroke: 0.4pt + clr.rule)
  v(2pt)
  grid(
    columns: (1fr, 1fr, 1fr),
    align(left, config.author),
    align(center, str(here().page())),
    align(right, ""),
  )
}

#set text(font: "New Computer Modern", number-type: "lining")
#set page(margin: 2.5cm, header: none, footer: none)

// --- title page (always exactly 1 page) ---
// Logo fits within page width, content is vertically centered,
// date is pushed to the bottom. No overflow onto page 2.
#page(margin: 2.5cm, header: none, footer: none)[
  #align(center)[
    #v(1fr)

    #if config.logo != "" [
      #image(config.logo, width: 100%, fit: "contain")
      #v(1cm)
    ]

    #line(length: 100%, stroke: 1.5pt + clr.rule)
    #v(0.4cm)
    #text(size: 24pt, weight: "bold")[#config.doc-type]
    #v(0.4cm)
    #text(size: 16pt, weight: "bold")[#config.course-full]
    #v(0.2cm)
    #text(size: 12pt, weight: "bold")[#config.lab-number]
    #v(0.2cm)
    #text(size: 14pt)[#config.lab-title]
    #v(0.4cm)
    #line(length: 100%, stroke: 1.5pt + clr.rule)

    #v(1.5cm)
    #text(size: 14pt, style: "italic")[#config.author]
    #linebreak()
    #text(size: 14pt, style: "italic")[#config.student-id]

    #v(1fr)
    #text(size: 11pt)[#config.date]
  ]
]

#set page(
  paper: "a4",
  margin: 2.5cm,
  header: header-content,
  footer: footer-content,
)

#set text(lang: "pl", size: 11pt, font: "New Computer Modern", number-type: "lining")
#show math.equation: set text(font: "New Computer Modern Math")
#show raw: set text(font: "New Computer Modern Mono")
#set par(justify: true, leading: 0.65em)

#show raw.where(block: true): set text(size: 9pt)
#show raw.where(block: true): block.with(
  fill: luma(245),
  inset: 8pt,
  radius: 4pt,
  width: 100%,
)

{{content}}
"##;
