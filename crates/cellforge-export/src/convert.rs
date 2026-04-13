use crate::latex2typst;
use cellforge_notebook::format::{Cell, Notebook, Output};
use std::collections::HashMap;

/// Convert a notebook to Typst markup.
/// Returns the .typ source and a map of image filenames → base64 PNG data.
pub fn notebook_to_typst(
    notebook: &Notebook,
    template: Option<&str>,
) -> (String, HashMap<String, String>) {
    let mut body = String::new();
    let mut images: HashMap<String, String> = HashMap::new();
    let mut img_counter = 0;

    for cell in &notebook.cells {
        match cell {
            Cell::Markdown(md) => {
                body.push_str(&markdown_to_typst(md.source.as_str()));
                body.push('\n');
            }
            Cell::Code(code) => {
                let src = code.source.as_str();
                if !src.trim().is_empty() {
                    body.push_str("```python\n");
                    body.push_str(src);
                    if !src.ends_with('\n') {
                        body.push('\n');
                    }
                    body.push_str("```\n");
                }

                // collect all text outputs into one block
                let mut text_out = String::new();
                let mut _has_images = false;
                let mut _has_errors = false;

                for output in &code.outputs {
                    match output {
                        Output::Stream(s) => {
                            text_out.push_str(s.text.as_str());
                        }
                        Output::ExecuteResult(r) => {
                            if let Some(viz) = r.data.get("application/vnd.cellforge.viz") {
                                emit_viz(&mut body, viz, &mut images, &mut img_counter);
                            } else if let Some(m) = r.data.get("application/vnd.cellforge.mermaid")
                            {
                                emit_mermaid(&mut body, m);
                            } else if r.data.contains_key("application/vnd.cellforge.widget+json") {
                                // interactive widgets can't render in PDF — skip
                            } else if let Some(plain) = r.data.get("text/plain") {
                                text_out.push_str(&plain_text(plain));
                                text_out.push('\n');
                            }
                        }
                        Output::DisplayData(d) | Output::UpdateDisplayData(d) => {
                            if let Some(viz) = d.data.get("application/vnd.cellforge.viz") {
                                emit_viz(&mut body, viz, &mut images, &mut img_counter);
                            } else if d.data.contains_key("application/vnd.cellforge.mermaid") {
                                if let Some(m) = d.data.get("application/vnd.cellforge.mermaid") {
                                    emit_mermaid(&mut body, m);
                                    body.push_str(&format!("```\n{}\n```\n\n", src));
                                }
                            } else if let Some(svg) = d.data.get("image/svg+xml") {
                                _has_images = true;
                                let fname = format!("img_{img_counter}.svg");
                                img_counter += 1;
                                images.insert(fname.clone(), plain_text(svg));
                                body.push_str(&format!("#image(\"{fname}\", width: 100%)\n\n"));
                            } else if let Some(png) = d.data.get("image/png") {
                                _has_images = true;
                                let b64 = plain_text(png).replace(['\n', ' '], "");
                                let fname = format!("img_{img_counter}.png");
                                img_counter += 1;
                                images.insert(fname.clone(), b64);
                                body.push_str(&format!("#image(\"{fname}\", width: 100%)\n\n"));
                            }
                        }
                        Output::Error(e) => {
                            _has_errors = true;
                            let tb = e
                                .traceback
                                .iter()
                                .map(|l| strip_ansi(l))
                                .collect::<Vec<_>>()
                                .join("\n");
                            body.push_str("#block(fill: rgb(\"#fff0f0\"), stroke: (left: 3pt + rgb(\"#e53e3e\")), radius: 4pt, inset: 10pt, width: 100%)[\n");
                            body.push_str(&format!("#text(fill: rgb(\"#c53030\"), weight: \"bold\", size: 10pt)[{}: {}]\n",
                                escape_typst(&e.ename), escape_typst(&e.evalue)));
                            if !tb.is_empty() {
                                body.push_str(&format!("#text(size: 8pt)[```\n{}\n```]\n", tb));
                            }
                            body.push_str("]\n\n");
                        }
                    }
                }

                // emit collected text output in one styled block
                let trimmed_out = text_out.trim();
                if !trimmed_out.is_empty() {
                    body.push_str("#block(fill: rgb(\"#f0f4ff\"), stroke: (left: 3pt + rgb(\"#6c8cff\")), radius: 4pt, inset: 10pt, width: 100%)[\n");
                    body.push_str(&format!("#text(size: 9pt)[```\n{}\n```]\n", trimmed_out));
                    body.push_str("]\n");
                }
                body.push('\n');
            }
            Cell::Raw(r) => {
                let text = r.source.as_str();
                if !text.trim().is_empty() {
                    body.push_str(text);
                    body.push('\n');
                }
            }
        }
    }

    // apply template or use default
    let typ_source = if let Some(tmpl) = template {
        tmpl.replace("{{content}}", &body)
            .replace("{{title}}", &notebook_title(notebook))
    } else {
        format!("{}\n\n{}", DEFAULT_PREAMBLE, body)
    };

    (typ_source, images)
}

/// Emit a cellforge viz element — charts as SVG images, callout/progress as Typst blocks.
fn emit_viz(
    body: &mut String,
    viz: &serde_json::Value,
    images: &mut HashMap<String, String>,
    img_counter: &mut usize,
) {
    let kind = viz.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    // callout, progress, stat are better as Typst text blocks (not SVG images)
    if kind == "callout" || kind == "progress" || kind == "stat" {
        body.push_str(&viz_to_svg(viz));
    } else {
        let scale = viz.get("scale").and_then(|v| v.as_f64()).unwrap_or(1.0);
        let base = match kind {
            "bar" => 30.0,
            "pie" => 50.0,
            "hbar" => 50.0,
            "diagram" => 60.0,
            _ => 100.0, // line, etc.
        };
        let width_pct = base * scale;
        let svg = viz_to_svg(viz);
        let fname = format!("img_{}.svg", *img_counter);
        *img_counter += 1;
        images.insert(fname.clone(), svg);
        body.push_str(&format!(
            "#align(center)[#image(\"{fname}\", width: {width_pct:.0}%)]\n\n"
        ));
    }
}

/// Emit a mermaid diagram — can't render server-side (needs Node.js).
/// Shows a styled box with the source and a note about viewing interactively.
fn emit_mermaid(body: &mut String, m: &serde_json::Value) {
    let src = m.get("source").and_then(|v| v.as_str()).unwrap_or("");
    body.push_str("#block(fill: rgb(\"#f0f4ff\"), stroke: (left: 3pt + rgb(\"#6c8cff\")), radius: (right: 4pt), inset: 12pt, width: 100%)[\n");
    body.push_str(
        "#text(size: 9pt, fill: rgb(\"#4a6cf7\"), weight: \"bold\")[Diagram (Mermaid)]\n",
    );
    body.push_str("#linebreak()\n");
    body.push_str("#text(size: 7pt, fill: luma(140))[Renders interactively in CellForge]\n");
    body.push_str("#v(4pt)\n");
    body.push_str(&format!("```\n{}\n```\n", src));
    body.push_str("]\n\n");
}

fn notebook_title(nb: &Notebook) -> String {
    // try to get title from first markdown cell
    for cell in &nb.cells {
        if let Cell::Markdown(md) = cell {
            let src = md.source.as_str();
            for line in src.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("# ") {
                    return rest.to_string();
                }
            }
        }
    }
    "Notebook".into()
}

const DEFAULT_PREAMBLE: &str = r#"
#set page(paper: "a4", margin: (x: 2cm, y: 2.5cm))
#set text(font: "New Computer Modern", size: 11pt)
#set heading(numbering: "1.1")
#set par(justify: true)
#show raw.where(block: true): set text(size: 9pt)
#show raw.where(block: true): block.with(fill: luma(240), inset: 8pt, radius: 4pt, width: 100%)
"#;

/// Convert markdown to Typst markup.
fn markdown_to_typst(md: &str) -> String {
    let mut out = String::new();
    let lines: Vec<&str> = md.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        // display math block $$...$$
        if trimmed == "$$" {
            i += 1;
            let mut math = String::new();
            while i < lines.len() && lines[i].trim() != "$$" {
                math.push_str(lines[i]);
                math.push('\n');
                i += 1;
            }
            i += 1; // skip closing $$
            out.push_str(&format!("$ {} $\n\n", latex2typst::convert(math.trim())));
            continue;
        }
        // single-line display math $$...$$
        if trimmed.starts_with("$$") && trimmed.ends_with("$$") && trimmed.len() > 4 {
            let math = &trimmed[2..trimmed.len() - 2];
            out.push_str(&format!("$ {} $\n\n", latex2typst::convert(math.trim())));
            i += 1;
            continue;
        }

        // fenced code blocks ```...```
        if trimmed.starts_with("```") {
            let lang = trimmed.trim_start_matches('`');
            i += 1;
            let mut code = String::new();
            while i < lines.len() && !lines[i].trim_start().starts_with("```") {
                code.push_str(lines[i]);
                code.push('\n');
                i += 1;
            }
            i += 1; // skip closing ```
            out.push_str(&format!("```{lang}\n{code}```\n\n"));
            continue;
        }

        // table: consecutive lines starting with |
        if trimmed.starts_with('|') && trimmed.ends_with('|') {
            let mut rows: Vec<Vec<String>> = Vec::new();
            while i < lines.len() {
                let tl = lines[i].trim();
                if !tl.starts_with('|') {
                    break;
                }
                // skip separator lines like |---|---|
                if tl.contains("---") {
                    i += 1;
                    continue;
                }
                let cells: Vec<String> = tl
                    .split('|')
                    .filter(|s| !s.is_empty())
                    .map(|s| s.trim().to_string())
                    .collect();
                if !cells.is_empty() {
                    rows.push(cells);
                }
                i += 1;
            }
            if !rows.is_empty() {
                let ncols = rows[0].len();
                // style matching the website: thin row separators, bold header, full width
                out.push_str(&format!(concat!(
                    "#block(width: 100%, radius: 4pt, clip: true, stroke: 0.5pt + luma(200))[\n",
                    "#table(\n",
                    "  columns: ({cols}),\n",
                    "  stroke: 0.5pt + luma(220),\n",
                    "  inset: (x: 10pt, y: 7pt),\n",
                    "  align: left,\n",
                ), cols = "1fr, ".repeat(ncols).trim_end_matches(", ")));
                for (ri, row) in rows.iter().enumerate() {
                    for cell in row {
                        if ri == 0 {
                            out.push_str(&format!(
                                "  table.cell(fill: luma(240))[#text(weight: \"bold\")[{}]],\n",
                                cell
                            ));
                        } else {
                            out.push_str(&format!("  [{}],\n", cell));
                        }
                    }
                }
                out.push_str(")\n]\n\n");
            }
            continue;
        }

        // headings
        if let Some(rest) = trimmed.strip_prefix("#### ") {
            out.push_str(&format!("==== {}\n", rest));
        } else if let Some(rest) = trimmed.strip_prefix("### ") {
            out.push_str(&format!("=== {}\n", rest));
        } else if let Some(rest) = trimmed.strip_prefix("## ") {
            out.push_str(&format!("== {}\n", rest));
        } else if let Some(rest) = trimmed.strip_prefix("# ") {
            out.push_str(&format!("= {}\n", rest));
        }
        // blockquote
        else if trimmed.starts_with("> ") {
            // collect consecutive > lines into one blockquote
            let mut quote = String::new();
            while i < lines.len() && lines[i].trim().starts_with("> ") {
                if !quote.is_empty() {
                    quote.push(' ');
                }
                quote.push_str(lines[i].trim().trim_start_matches("> "));
                i += 1;
            }
            out.push_str(&format!(
                concat!(
                    "#block(inset: (left: 12pt, y: 8pt), stroke: (left: 3pt + luma(180)), ",
                    "fill: luma(248), radius: (right: 4pt), width: 100%)",
                    "[#text(fill: luma(100), style: \"italic\")[{}]]\n\n"
                ),
                quote
            ));
            continue; // i already advanced
        }
        // horizontal rule
        else if trimmed == "---" || trimmed == "***" || trimmed == "___" {
            out.push_str("#line(length: 100%)\n\n");
        }
        // list items — convert inline formatting too
        else if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            let prefix = &trimmed[..2];
            let rest = &trimmed[2..];
            out.push_str(prefix);
            out.push_str(&convert_inline(rest));
            out.push('\n');
        }
        // numbered list
        else if trimmed.len() > 2
            && trimmed.chars().next().is_some_and(|c| c.is_ascii_digit())
            && trimmed.contains(". ")
        {
            if let Some(pos) = trimmed.find(". ") {
                out.push_str(&format!("+ {}\n", convert_inline(&trimmed[pos + 2..])));
            }
        }
        // empty line → paragraph break
        else if trimmed.is_empty() {
            out.push('\n');
        }
        // regular text
        else {
            out.push_str(&convert_inline(line));
            out.push('\n');
        }

        i += 1;
    }

    out
}

/// Convert inline markdown formatting to Typst.
fn convert_inline(line: &str) -> String {
    let mut s = line.to_string();
    // bold **text** → *text*
    while let Some(start) = s.find("**") {
        if let Some(end) = s[start + 2..].find("**") {
            let inner = s[start + 2..start + 2 + end].to_string();
            s = format!("{}*{}*{}", &s[..start], inner, &s[start + 2 + end + 2..]);
        } else {
            break;
        }
    }
    // inline math $...$ → typst math $...$
    let mut result = String::new();
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '$' && chars.peek() != Some(&'$') {
            let mut math = String::new();
            for c in chars.by_ref() {
                if c == '$' {
                    break;
                }
                math.push(c);
            }
            result.push('$');
            result.push_str(&latex2typst::convert(&math));
            result.push('$');
        } else {
            result.push(ch);
        }
    }
    result
}

/// Translate common LaTeX math commands to Typst equivalents.
fn _latex_to_typst_math(latex: &str) -> String {
    let mut s = latex.to_string();

    // \frac{a}{b} → frac(a, b)
    while let Some(pos) = s.find("\\frac{") {
        if let Some(converted) = _convert_frac(&s[pos..]) {
            s = format!("{}{}", &s[..pos], converted);
        } else {
            break;
        }
    }

    // simple command replacements
    let replacements = [
        ("\\cdot", "dot"),
        ("\\times", "times"),
        ("\\pm", "plus.minus"),
        ("\\mp", "minus.plus"),
        ("\\leq", "<="),
        ("\\geq", ">="),
        ("\\neq", "!="),
        ("\\approx", "approx"),
        ("\\infty", "infinity"),
        ("\\sqrt", "sqrt"),
        ("\\sum", "sum"),
        ("\\prod", "product"),
        ("\\int", "integral"),
        ("\\partial", "diff"),
        ("\\alpha", "alpha"),
        ("\\beta", "beta"),
        ("\\gamma", "gamma"),
        ("\\delta", "delta"),
        ("\\epsilon", "epsilon"),
        ("\\theta", "theta"),
        ("\\lambda", "lambda"),
        ("\\mu", "mu"),
        ("\\pi", "pi"),
        ("\\sigma", "sigma"),
        ("\\omega", "omega"),
        ("\\phi", "phi"),
        ("\\psi", "psi"),
        ("\\rho", "rho"),
        ("\\tau", "tau"),
        ("\\chi", "chi"),
        ("\\Delta", "Delta"),
        ("\\Sigma", "Sigma"),
        ("\\Omega", "Omega"),
        ("\\in", "in"),
        ("\\notin", "in.not"),
        ("\\subset", "subset"),
        ("\\cup", "union"),
        ("\\cap", "sect"),
        ("\\forall", "forall"),
        ("\\exists", "exists"),
        ("\\rightarrow", "arrow.r"),
        ("\\leftarrow", "arrow.l"),
        ("\\Rightarrow", "arrow.r.double"),
        ("\\Leftarrow", "arrow.l.double"),
        ("\\ldots", "dots"),
        ("\\cdots", "dots.c"),
        ("\\quad", "quad"),
        ("\\text", "\""),
        ("\\mathrm", "\""),
        ("\\begin{pmatrix}", "mat(delim: \"(\","),
        ("\\end{pmatrix}", ")"),
        ("\\begin{bmatrix}", "mat(delim: \"[\","),
        ("\\end{bmatrix}", ")"),
        ("\\\\", ";"),
        ("\\left(", "("),
        ("\\right)", ")"),
        ("\\left[", "["),
        ("\\right]", "]"),
    ];

    for (from, to) in &replacements {
        s = s.replace(from, to);
    }

    // remove remaining \command patterns — turn \foo into foo
    // but DON'T strip lone backslashes that are part of other syntax
    let mut result = String::new();
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            // peek: if next char is alphabetic, it's a \command — drop the backslash
            if chars.peek().map(|c| c.is_alphabetic()).unwrap_or(false) {
                // just skip the backslash, keep the command name
                continue;
            }
            // otherwise keep the backslash (e.g. literal)
        }
        result.push(ch);
    }

    // in typst math, braces are not used for grouping — parentheses are.
    // \frac already converted to frac(), so remaining {} are LaTeX grouping
    result = result.replace('{', "(").replace('}', ")");

    result
}

/// Convert \frac{numerator}{denominator} → frac(numerator, denominator)
fn _convert_frac(s: &str) -> Option<String> {
    let after_frac = &s["\\frac{".len()..];
    let num_end = _find_matching_brace(after_frac)?;
    let num = &after_frac[..num_end];

    let rest = &after_frac[num_end + 1..]; // skip }
    if !rest.starts_with('{') {
        return None;
    }
    let den_content = &rest[1..]; // skip {
    let den_end = _find_matching_brace(den_content)?;
    let den = &den_content[..den_end];
    let remainder = &den_content[den_end + 1..]; // skip }

    Some(format!("frac({}, {}){}", num, den, remainder))
}

fn _find_matching_brace(s: &str) -> Option<usize> {
    let mut depth = 0;
    for (i, ch) in s.chars().enumerate() {
        match ch {
            '{' => depth += 1,
            '}' => {
                if depth == 0 {
                    return Some(i);
                }
                depth -= 1;
            }
            _ => {}
        }
    }
    None
}

fn escape_typst(s: &str) -> String {
    s.replace('#', "\\#")
        .replace('$', "\\$")
        .replace('<', "\\<")
        .replace('>', "\\>")
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' || (ch == '[' && out.is_empty()) {
            // skip ESC[ ... m sequences
            if ch == '\x1b' {
                chars.next();
            } // skip [
            while let Some(&c) = chars.peek() {
                chars.next();
                if c == 'm' {
                    break;
                }
            }
        } else {
            out.push(ch);
        }
    }
    out
}

const SVG_PALETTE: &[&str] = &[
    "#4a6cf7", "#e855a0", "#2ecc71", "#e67e22", "#9b59b6", "#1abc9c", "#f1c40f", "#e74c3c",
    "#7f8c8d", "#34495e",
];

/// Generate an SVG string from cellforge viz data, for PDF export.
/// Uses print-friendly colors (darker, higher contrast on white background).
fn viz_to_svg(val: &serde_json::Value) -> String {
    let kind = val.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    match kind {
        "bar" => svg_bar(val),
        "line" => svg_line(val),
        "pie" => svg_pie(val),
        "hbar" => svg_hbar(val),
        "stat" => svg_stat(val),
        "callout" => svg_callout(val),
        "progress" => svg_progress(val),
        "diagram" => svg_diagram(val),
        _ => format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"30\"><text x=\"4\" y=\"20\" font-size=\"12\" fill=\"#888\">Unknown: {kind}</text></svg>"
        ),
    }
}

fn svg_bar(val: &serde_json::Value) -> String {
    let values: Vec<f64> = val
        .get("values")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_f64()).collect())
        .unwrap_or_default();
    let labels: Vec<&str> = val
        .get("labels")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let title = val.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let max = values.iter().cloned().fold(1.0_f64, f64::max);
    let bar_w = 40;
    let gap = 8;
    let chart_h = 120;
    let title_h = if title.is_empty() { 0 } else { 28 };
    let value_h = 16;
    let label_h = 20;
    let w = values.len() * (bar_w + gap) + gap;
    let h = title_h + value_h + chart_h + label_h;
    let bar_top = title_h + value_h;
    let mut s = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" style=\"font-family:sans-serif\">"
    );
    if !title.is_empty() {
        s.push_str(&format!("<text x=\"{}\" y=\"16\" text-anchor=\"middle\" fill=\"#1a1a2e\" font-size=\"12\" font-weight=\"600\">{}</text>", w/2, escape_typst(title)));
    }
    for (i, v) in values.iter().enumerate() {
        let bar_h = (v / max * chart_h as f64) as usize;
        let x = gap + i * (bar_w + gap);
        let y = bar_top + chart_h - bar_h;
        let color = SVG_PALETTE[i % SVG_PALETTE.len()];
        s.push_str(&format!("<rect x=\"{x}\" y=\"{y}\" width=\"{bar_w}\" height=\"{bar_h}\" rx=\"4\" fill=\"{color}\" opacity=\"0.85\"/>"));
        s.push_str(&format!("<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" fill=\"#4a5568\" font-size=\"10\">{v}</text>", x+bar_w/2, y.saturating_sub(4)));
        let label = labels.get(i).unwrap_or(&"");
        s.push_str(&format!("<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" fill=\"#718096\" font-size=\"10\">{label}</text>", x+bar_w/2, h-4));
    }
    s.push_str("</svg>");
    s
}

fn svg_line(val: &serde_json::Value) -> String {
    let values: Vec<f64> = val
        .get("values")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_f64()).collect())
        .unwrap_or_default();
    let labels: Vec<&str> = val
        .get("labels")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let title = val.get("title").and_then(|v| v.as_str()).unwrap_or("");
    if values.is_empty() {
        return String::new();
    }
    let max = values.iter().cloned().fold(f64::MIN, f64::max);
    let min = values.iter().cloned().fold(f64::MAX, f64::min);
    let range = if (max - min).abs() < 0.001 {
        1.0
    } else {
        max - min
    };
    let pad_x = 30;
    let pad_top = if title.is_empty() { 10 } else { 34 };
    let pad_bot = 24;
    let chart_w = (values.len() * 50).max(200);
    let chart_h = 120;
    let w = chart_w + pad_x * 2;
    let h = chart_h + pad_top + pad_bot;
    let mut s = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" style=\"font-family:sans-serif\">"
    );
    if !title.is_empty() {
        s.push_str(&format!("<text x=\"{}\" y=\"16\" text-anchor=\"middle\" fill=\"#1a1a2e\" font-size=\"12\" font-weight=\"600\">{}</text>", w/2, escape_typst(title)));
    }
    s.push_str(&format!("<line x1=\"{pad_x}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#e2e8f0\" stroke-width=\"1\"/>", pad_top+chart_h, w-pad_x, pad_top+chart_h));
    let n = values.len().max(2) - 1;
    let pts: Vec<(f64, f64)> = values
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let x = pad_x as f64 + (i as f64 / n as f64) * chart_w as f64;
            let y = pad_top as f64 + chart_h as f64 - ((v - min) / range) * chart_h as f64;
            (x, y)
        })
        .collect();
    let path: String = pts
        .iter()
        .enumerate()
        .map(|(i, (x, y))| format!("{}{x},{y}", if i == 0 { "M" } else { "L" }))
        .collect();
    s.push_str(&format!("<path d=\"{path}\" fill=\"none\" stroke=\"{}\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", SVG_PALETTE[0]));
    for (i, (x, y)) in pts.iter().enumerate() {
        s.push_str(&format!("<circle cx=\"{x}\" cy=\"{y}\" r=\"3.5\" fill=\"{}\" stroke=\"white\" stroke-width=\"1.5\"/>", SVG_PALETTE[0]));
        s.push_str(&format!("<text x=\"{x}\" y=\"{}\" text-anchor=\"middle\" fill=\"#4a5568\" font-size=\"9\">{}</text>", y - 8.0, values[i]));
        let label = labels.get(i).unwrap_or(&"");
        s.push_str(&format!("<text x=\"{x}\" y=\"{}\" text-anchor=\"middle\" fill=\"#718096\" font-size=\"9\">{label}</text>", h - 4));
    }
    s.push_str("</svg>");
    s
}

fn svg_pie(val: &serde_json::Value) -> String {
    let values: Vec<f64> = val
        .get("values")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_f64()).collect())
        .unwrap_or_default();
    let labels: Vec<&str> = val
        .get("labels")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let title = val.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let total: f64 = values.iter().sum();
    let total = if total == 0.0 { 1.0 } else { total };
    let cx = 100.0;
    let cy = 100.0;
    let r = 80.0;
    let legend_x = (cx * 2.0 + 30.0) as usize;
    let w = legend_x + 140;
    let h = f64::max(
        cy * 2.0,
        labels.len() as f64 * 20.0 + if title.is_empty() { 10.0 } else { 34.0 },
    ) as usize;
    let mut s = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" style=\"font-family:sans-serif\">"
    );
    if !title.is_empty() {
        s.push_str(&format!("<text x=\"{cx}\" y=\"16\" text-anchor=\"middle\" fill=\"#1a1a2e\" font-size=\"12\" font-weight=\"600\">{}</text>", escape_typst(title)));
    }
    let mut angle: f64 = -std::f64::consts::FRAC_PI_2;
    for (i, v) in values.iter().enumerate() {
        let slice = (v / total) * std::f64::consts::PI * 2.0;
        let x1 = cx + r * angle.cos();
        let y1 = cy + r * angle.sin();
        let x2 = cx + r * (angle + slice).cos();
        let y2 = cy + r * (angle + slice).sin();
        let large = if slice > std::f64::consts::PI { 1 } else { 0 };
        let color = SVG_PALETTE[i % SVG_PALETTE.len()];
        s.push_str(&format!("<path d=\"M{cx},{cy} L{x1},{y1} A{r},{r} 0 {large} 1 {x2},{y2} Z\" fill=\"{color}\" opacity=\"0.85\" stroke=\"white\" stroke-width=\"2\"/>"));
        angle += slice;
    }
    let legend_top = if title.is_empty() { 10 } else { 34 };
    for (i, label) in labels.iter().enumerate() {
        let y = legend_top + i * 20 + 10;
        let pct = values.get(i).unwrap_or(&0.0) / total * 100.0;
        let color = SVG_PALETTE[i % SVG_PALETTE.len()];
        s.push_str(&format!("<rect x=\"{legend_x}\" y=\"{}\" width=\"10\" height=\"10\" rx=\"2\" fill=\"{color}\"/>", y - 8));
        s.push_str(&format!(
            "<text x=\"{}\" y=\"{y}\" fill=\"#4a5568\" font-size=\"11\">{label} ({pct:.1}%)</text>",
            legend_x + 16
        ));
    }
    s.push_str("</svg>");
    s
}

fn svg_hbar(val: &serde_json::Value) -> String {
    let values: Vec<f64> = val
        .get("values")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_f64()).collect())
        .unwrap_or_default();
    let labels: Vec<&str> = val
        .get("labels")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let title = val.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let max = values.iter().cloned().fold(1.0_f64, f64::max);
    let bar_h = 24;
    let gap = 6;
    let label_w = 80;
    let chart_w = 250;
    let title_h = if title.is_empty() { 0 } else { 28 };
    let w = label_w + chart_w + 60;
    let h = title_h + values.len() * (bar_h + gap) + gap;
    let mut s = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" style=\"font-family:sans-serif\">"
    );
    if !title.is_empty() {
        s.push_str(&format!("<text x=\"{}\" y=\"16\" text-anchor=\"middle\" fill=\"#1a1a2e\" font-size=\"12\" font-weight=\"600\">{}</text>", w/2, escape_typst(title)));
    }
    for (i, v) in values.iter().enumerate() {
        let bw = (v / max * chart_w as f64) as usize;
        let y = title_h + gap + i * (bar_h + gap);
        let color = SVG_PALETTE[i % SVG_PALETTE.len()];
        let label = labels.get(i).unwrap_or(&"");
        s.push_str(&format!("<text x=\"{}\" y=\"{}\" text-anchor=\"end\" fill=\"#4a5568\" font-size=\"11\">{label}</text>", label_w - 6, y + bar_h / 2 + 4));
        s.push_str(&format!("<rect x=\"{label_w}\" y=\"{y}\" width=\"{bw}\" height=\"{bar_h}\" rx=\"4\" fill=\"{color}\" opacity=\"0.85\"/>"));
        s.push_str(&format!(
            "<text x=\"{}\" y=\"{}\" fill=\"#718096\" font-size=\"10\">{v}</text>",
            label_w + bw + 6,
            y + bar_h / 2 + 4
        ));
    }
    s.push_str("</svg>");
    s
}

fn svg_stat(val: &serde_json::Value) -> String {
    // Stat tiles render as compact Typst blocks, not SVG — SVG would stretch to 80% page width
    let label = val.get("label").and_then(|v| v.as_str()).unwrap_or("");
    let value = val.get("value").and_then(|v| v.as_str()).unwrap_or("");
    let delta = val.get("delta").and_then(|v| v.as_str());
    let caption = val.get("caption").and_then(|v| v.as_str());
    let mut out = format!(
        "#block(stroke: 0.5pt + luma(200), radius: 6pt, inset: 12pt, width: auto)[\n\
         #text(size: 9pt, fill: luma(120))[{}]\n\
         #linebreak()\n\
         #text(size: 20pt, weight: \"bold\")[{}]",
        escape_typst(label),
        escape_typst(value)
    );
    if let Some(d) = delta {
        let color = if d.starts_with('-') { "red" } else { "green" };
        out.push_str(&format!(
            " #text(size: 11pt, fill: {})[{}]",
            color,
            escape_typst(d)
        ));
    }
    out.push('\n');
    if let Some(c) = caption {
        out.push_str(&format!(
            "#linebreak()\n#text(size: 8pt, fill: luma(140))[{}]\n",
            escape_typst(c)
        ));
    }
    out.push_str("]\n\n");
    out
}

fn svg_callout(val: &serde_json::Value) -> String {
    // callout uses viz_to_typst which is text-based — better for PDF
    viz_to_typst_callout(val)
}

fn svg_progress(val: &serde_json::Value) -> String {
    // progress uses viz_to_typst — just text for PDF
    viz_to_typst_progress(val)
}

fn svg_diagram(val: &serde_json::Value) -> String {
    let edges: Vec<(String, String, String)> = val
        .get("edges")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .map(|e| {
                    let arr = e.as_array();
                    let a = arr
                        .and_then(|a| a.first())
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let b = arr
                        .and_then(|a| a.get(1))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let l = arr
                        .and_then(|a| a.get(2))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    (a, b, l)
                })
                .collect()
        })
        .unwrap_or_default();
    let kind = val
        .get("diagram_kind")
        .and_then(|v| v.as_str())
        .unwrap_or("flow");
    let title = val.get("title").and_then(|v| v.as_str()).unwrap_or("");

    if kind == "sequence" {
        svg_sequence_diagram(&edges, title)
    } else {
        svg_flow_diagram(&edges, title)
    }
}

fn svg_flow_diagram(edges: &[(String, String, String)], title: &str) -> String {
    let mut nodes: Vec<String> = Vec::new();
    for (a, b, _) in edges {
        if !nodes.contains(a) {
            nodes.push(a.clone());
        }
        if !nodes.contains(b) {
            nodes.push(b.clone());
        }
    }
    let nw = 120_usize;
    let nh = 36_usize;
    let gx = 60_usize;
    let gy = 60_usize;
    let cols = nodes.len().min(4);
    let rows = nodes.len().div_ceil(cols);
    let th = if title.is_empty() { 0 } else { 28 };
    let w = cols * (nw + gx) + gx;
    let h = th + rows * (nh + gy) + gy;
    let mut pos: std::collections::HashMap<String, (usize, usize)> =
        std::collections::HashMap::new();
    for (i, n) in nodes.iter().enumerate() {
        let col = i % cols;
        let row = i / cols;
        pos.insert(
            n.clone(),
            (
                gx + col * (nw + gx) + nw / 2,
                th + gy + row * (nh + gy) + nh / 2,
            ),
        );
    }
    let mut s = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" style=\"font-family:sans-serif\">"
    );
    s.push_str("<defs><marker id=\"a\" viewBox=\"0 0 10 7\" refX=\"10\" refY=\"3.5\" markerWidth=\"8\" markerHeight=\"6\" orient=\"auto\"><polygon points=\"0 0,10 3.5,0 7\" fill=\"#4a6cf7\"/></marker></defs>");
    if !title.is_empty() {
        s.push_str(&format!("<text x=\"{}\" y=\"18\" text-anchor=\"middle\" fill=\"#1a1a2e\" font-size=\"12\" font-weight=\"600\">{}</text>", w/2, escape_typst(title)));
    }
    for (a, b, l) in edges {
        if let (Some(&(x1, y1)), Some(&(x2, y2))) = (pos.get(a), pos.get(b)) {
            s.push_str(&format!("<line x1=\"{x1}\" y1=\"{y1}\" x2=\"{x2}\" y2=\"{y2}\" stroke=\"#4a6cf7\" stroke-width=\"1.5\" marker-end=\"url(#a)\" opacity=\"0.7\"/>"));
            if !l.is_empty() {
                s.push_str(&format!("<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" fill=\"#718096\" font-size=\"9\" font-style=\"italic\">{}</text>", (x1+x2)/2, (y1+y2)/2-6, escape_typst(l)));
            }
        }
    }
    for n in &nodes {
        if let Some(&(x, y)) = pos.get(n) {
            s.push_str(&format!("<rect x=\"{}\" y=\"{}\" width=\"{nw}\" height=\"{nh}\" rx=\"8\" fill=\"#f0f4ff\" stroke=\"#6c8cff\" stroke-width=\"1.5\"/>", x-nw/2, y-nh/2));
            s.push_str(&format!("<text x=\"{x}\" y=\"{}\" text-anchor=\"middle\" fill=\"#1a1a2e\" font-size=\"11\" font-weight=\"500\">{}</text>", y+4, escape_typst(n)));
        }
    }
    s.push_str("</svg>");
    s
}

fn svg_sequence_diagram(edges: &[(String, String, String)], title: &str) -> String {
    let mut actors: Vec<String> = Vec::new();
    for (a, b, _) in edges {
        if !actors.contains(a) {
            actors.push(a.clone());
        }
        if !actors.contains(b) {
            actors.push(b.clone());
        }
    }
    let aw = 100_usize;
    let ag = 40_usize;
    let rh = 36_usize;
    let th = if title.is_empty() { 0 } else { 28 };
    let hh = 30;
    let w = actors.len() * (aw + ag) + ag;
    let h = th + hh + edges.len() * rh + 20;
    let mut ax: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (i, a) in actors.iter().enumerate() {
        ax.insert(a.clone(), ag + i * (aw + ag) + aw / 2);
    }
    let mut s = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" style=\"font-family:sans-serif\">"
    );
    s.push_str("<defs><marker id=\"sa\" viewBox=\"0 0 10 7\" refX=\"10\" refY=\"3.5\" markerWidth=\"8\" markerHeight=\"6\" orient=\"auto\"><polygon points=\"0 0,10 3.5,0 7\" fill=\"#4a6cf7\"/></marker></defs>");
    if !title.is_empty() {
        s.push_str(&format!("<text x=\"{}\" y=\"18\" text-anchor=\"middle\" fill=\"#1a1a2e\" font-size=\"12\" font-weight=\"600\">{}</text>", w/2, escape_typst(title)));
    }
    let lt = th + hh;
    for a in &actors {
        let x = ax[a];
        s.push_str(&format!("<text x=\"{x}\" y=\"{}\" text-anchor=\"middle\" fill=\"#1a1a2e\" font-size=\"11\" font-weight=\"600\">{}</text>", th+18, escape_typst(a)));
        s.push_str(&format!("<line x1=\"{x}\" y1=\"{lt}\" x2=\"{x}\" y2=\"{}\" stroke=\"#cbd5e0\" stroke-width=\"1\" stroke-dasharray=\"4 3\"/>", h-10));
    }
    for (i, (from, to, label)) in edges.iter().enumerate() {
        let y = lt + i * rh + rh / 2;
        let x1 = ax.get(from).copied().unwrap_or(0);
        let x2 = ax.get(to).copied().unwrap_or(0);
        let dash = if x2 < x1 {
            " stroke-dasharray=\"6 3\""
        } else {
            ""
        };
        s.push_str(&format!("<line x1=\"{x1}\" y1=\"{y}\" x2=\"{x2}\" y2=\"{y}\" stroke=\"#4a6cf7\" stroke-width=\"1.5\"{dash} marker-end=\"url(#sa)\" opacity=\"0.8\"/>"));
        if !label.is_empty() {
            s.push_str(&format!("<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" fill=\"#4a5568\" font-size=\"9\">{}</text>", (x1+x2)/2, y-6, escape_typst(label)));
        }
    }
    s.push_str("</svg>");
    s
}

fn viz_to_typst_callout(val: &serde_json::Value) -> String {
    let text = val.get("text").and_then(|v| v.as_str()).unwrap_or("");
    let ckind = val
        .get("callout_kind")
        .and_then(|v| v.as_str())
        .unwrap_or("info");
    let ctitle = val.get("callout_title").and_then(|v| v.as_str());
    let (color, icon) = match ckind {
        "warning" => ("rgb(\"#b45309\")", "⚠️"),
        "error" => ("rgb(\"#dc2626\")", "❌"),
        "success" => ("rgb(\"#16a34a\")", "✅"),
        _ => ("rgb(\"#2563eb\")", "ℹ️"),
    };
    let mut out = format!(
        "#block(stroke: (left: 3pt + {color}), fill: luma(248), radius: (right: 4pt), inset: 10pt, width: 100%)[\n{icon} "
    );
    if let Some(t) = ctitle {
        out.push_str(&format!("#text(weight: \"bold\")[{}] ", escape_typst(t)));
    }
    out.push_str(&format!("{}\n]\n\n", escape_typst(text)));
    out
}

fn viz_to_typst_progress(val: &serde_json::Value) -> String {
    let value = val.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let max = val.get("max").and_then(|v| v.as_f64()).unwrap_or(100.0);
    let label = val.get("label").and_then(|v| v.as_str()).unwrap_or("");
    let pct = if max > 0.0 {
        (value / max * 100.0).min(100.0)
    } else {
        0.0
    };
    format!(
        "#block(inset: 6pt, width: 100%)[{} — {:.0}%]\n\n",
        escape_typst(label),
        pct
    )
}

/// Fallback Typst-only renderer — used for types that don't suit SVG (callout, progress).
#[allow(dead_code)]
fn viz_to_typst(val: &serde_json::Value) -> String {
    let kind = val.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    match kind {
        "bar" | "hbar" => {
            let values = val
                .get("values")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let labels = val
                .get("labels")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let title = val.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let mut out = String::new();
            if !title.is_empty() {
                out.push_str(&format!(
                    "#text(weight: \"bold\", size: 11pt)[{}]\n",
                    escape_typst(title)
                ));
            }
            out.push_str("#table(\n  columns: (auto, auto),\n  stroke: 0.5pt + luma(220),\n  inset: (x: 10pt, y: 6pt),\n");
            out.push_str("  table.cell(fill: luma(240))[#text(weight: \"bold\")[Label]], table.cell(fill: luma(240))[#text(weight: \"bold\")[Value]],\n");
            for (i, v) in values.iter().enumerate() {
                let label = labels.get(i).and_then(|l| l.as_str()).unwrap_or("");
                let val_str = if let Some(n) = v.as_f64() {
                    format!("{n}")
                } else {
                    v.to_string()
                };
                out.push_str(&format!("  [{}], [{}],\n", escape_typst(label), val_str));
            }
            out.push_str(")\n\n");
            out
        }
        "line" => {
            let values = val
                .get("values")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let labels = val
                .get("labels")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let title = val.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let mut out = String::new();
            if !title.is_empty() {
                out.push_str(&format!(
                    "#text(weight: \"bold\", size: 11pt)[{}]\n",
                    escape_typst(title)
                ));
            }
            // render as inline comma-separated values with labels
            let pairs: Vec<String> = values
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let label = labels.get(i).and_then(|l| l.as_str()).unwrap_or("");
                    let val_str = if let Some(n) = v.as_f64() {
                        format!("{n}")
                    } else {
                        v.to_string()
                    };
                    if label.is_empty() {
                        val_str
                    } else {
                        format!("{label}: {val_str}")
                    }
                })
                .collect();
            out.push_str(&format!(
                "#block(fill: luma(245), inset: 8pt, radius: 4pt, width: 100%)[{}]\n\n",
                pairs.join(" → ")
            ));
            out
        }
        "pie" => {
            let values = val
                .get("values")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let labels = val
                .get("labels")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let title = val.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let total: f64 = values.iter().filter_map(|v| v.as_f64()).sum();
            let mut out = String::new();
            if !title.is_empty() {
                out.push_str(&format!(
                    "#text(weight: \"bold\", size: 11pt)[{}]\n",
                    escape_typst(title)
                ));
            }
            for (i, v) in values.iter().enumerate() {
                let label = labels.get(i).and_then(|l| l.as_str()).unwrap_or("");
                let pct = if total > 0.0 {
                    v.as_f64().unwrap_or(0.0) / total * 100.0
                } else {
                    0.0
                };
                out.push_str(&format!("- {}: {:.1}%\n", escape_typst(label), pct));
            }
            out.push('\n');
            out
        }
        "stat" => {
            let label = val.get("label").and_then(|v| v.as_str()).unwrap_or("");
            let value = val.get("value").and_then(|v| v.as_str()).unwrap_or("");
            let delta = val.get("delta").and_then(|v| v.as_str());
            let caption = val.get("caption").and_then(|v| v.as_str());
            let mut out = format!(
                "#block(stroke: 0.5pt + luma(200), radius: 6pt, inset: 12pt, width: auto)[\n\
                 #text(size: 9pt, fill: luma(120))[{}]\n\
                 #linebreak()\n\
                 #text(size: 22pt, weight: \"bold\")[{}]",
                escape_typst(label),
                escape_typst(value)
            );
            if let Some(d) = delta {
                let color = if d.starts_with('-') { "red" } else { "green" };
                out.push_str(&format!(
                    " #text(size: 11pt, fill: {})[{}]",
                    color,
                    escape_typst(d)
                ));
            }
            out.push('\n');
            if let Some(c) = caption {
                out.push_str(&format!(
                    "#linebreak()\n#text(size: 8pt, fill: luma(140))[{}]\n",
                    escape_typst(c)
                ));
            }
            out.push_str("]\n\n");
            out
        }
        "callout" => {
            let text = val.get("text").and_then(|v| v.as_str()).unwrap_or("");
            let ckind = val
                .get("callout_kind")
                .and_then(|v| v.as_str())
                .unwrap_or("info");
            let ctitle = val.get("callout_title").and_then(|v| v.as_str());
            let (color, icon) = match ckind {
                "warning" => ("rgb(\"#b45309\")", "⚠️"),
                "error" => ("rgb(\"#dc2626\")", "❌"),
                "success" => ("rgb(\"#16a34a\")", "✅"),
                _ => ("rgb(\"#2563eb\")", "ℹ️"),
            };
            let mut out = format!(
                "#block(stroke: (left: 3pt + {color}), fill: luma(248), radius: (right: 4pt), inset: 10pt, width: 100%)[\n\
                 {icon} "
            );
            if let Some(t) = ctitle {
                out.push_str(&format!("#text(weight: \"bold\")[{}] ", escape_typst(t)));
            }
            out.push_str(&format!("{}\n]\n\n", escape_typst(text)));
            out
        }
        "progress" => {
            let value = val.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let max = val.get("max").and_then(|v| v.as_f64()).unwrap_or(100.0);
            let label = val.get("label").and_then(|v| v.as_str()).unwrap_or("");
            let pct = if max > 0.0 {
                (value / max * 100.0).min(100.0)
            } else {
                0.0
            };
            format!(
                "#block(inset: 6pt, width: 100%)[{} — {:.0}%]\n\n",
                escape_typst(label),
                pct
            )
        }
        _ => format!(
            "#text(fill: luma(140), size: 9pt)[Unknown cellforge element: {}]\n\n",
            kind
        ),
    }
}

fn plain_text(val: &serde_json::Value) -> String {
    match val {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .map(|v| v.as_str().unwrap_or(""))
            .collect::<Vec<_>>()
            .join(""),
        _ => val.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- markdown_to_typst: headings ---

    #[test]
    fn heading_h1() {
        let result = markdown_to_typst("# Hello");
        assert!(
            result.contains("= Hello"),
            "H1 should become '= Hello', got: {result}"
        );
    }

    #[test]
    fn heading_h2() {
        let result = markdown_to_typst("## Section");
        assert!(result.contains("== Section"), "got: {result}");
    }

    #[test]
    fn heading_h3() {
        let result = markdown_to_typst("### Subsection");
        assert!(result.contains("=== Subsection"), "got: {result}");
    }

    #[test]
    fn heading_h4() {
        let result = markdown_to_typst("#### Deep");
        assert!(result.contains("==== Deep"), "got: {result}");
    }

    // --- markdown_to_typst: bold ---

    #[test]
    fn bold_text() {
        let result = markdown_to_typst("This is **bold** text");
        // markdown **bold** becomes typst *bold*
        assert!(
            result.contains("*bold*"),
            "**bold** should become *bold*, got: {result}"
        );
        // should NOT contain the original **
        assert!(
            !result.contains("**bold**"),
            "original ** should be converted, got: {result}"
        );
    }

    // --- markdown_to_typst: code blocks ---

    #[test]
    fn fenced_code_block() {
        let md = "```python\nprint('hi')\n```";
        let result = markdown_to_typst(md);
        assert!(
            result.contains("```python"),
            "should preserve language hint, got: {result}"
        );
        assert!(
            result.contains("print('hi')"),
            "should preserve code content, got: {result}"
        );
    }

    #[test]
    fn fenced_code_block_no_lang() {
        let md = "```\nsome code\n```";
        let result = markdown_to_typst(md);
        assert!(result.contains("some code"), "got: {result}");
    }

    // --- markdown_to_typst: lists ---

    #[test]
    fn unordered_list_dash() {
        let result = markdown_to_typst("- item one\n- item two");
        assert!(result.contains("- item one"), "got: {result}");
        assert!(result.contains("- item two"), "got: {result}");
    }

    #[test]
    fn unordered_list_star() {
        let result = markdown_to_typst("* first\n* second");
        assert!(result.contains("* first"), "got: {result}");
        assert!(result.contains("* second"), "got: {result}");
    }

    #[test]
    fn ordered_list() {
        let result = markdown_to_typst("1. alpha\n2. beta\n3. gamma");
        // numbered lists convert to + prefix
        assert!(result.contains("+ alpha"), "got: {result}");
        assert!(result.contains("+ beta"), "got: {result}");
        assert!(result.contains("+ gamma"), "got: {result}");
    }

    // --- markdown_to_typst: inline math ---

    #[test]
    fn inline_math() {
        let result = markdown_to_typst("The formula $x^2$ is nice");
        // should contain typst math delimiters
        assert!(
            result.contains('$'),
            "inline math should have $, got: {result}"
        );
    }

    // --- markdown_to_typst: display math ---

    #[test]
    fn display_math_multiline() {
        let md = "$$\nx^2 + y^2\n$$";
        let result = markdown_to_typst(md);
        assert!(
            result.contains("$ "),
            "display math should be wrapped in $ ... $, got: {result}"
        );
    }

    #[test]
    fn display_math_single_line() {
        let md = "$$E = mc^2$$";
        let result = markdown_to_typst(md);
        assert!(result.contains("$ "), "got: {result}");
    }

    // --- markdown_to_typst: tables ---

    #[test]
    fn table_basic() {
        let md = "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
        let result = markdown_to_typst(md);
        assert!(
            result.contains("#table("),
            "table should produce #table(), got: {result}"
        );
        // header row should be bold
        assert!(
            result.contains("weight: \"bold\""),
            "header should be bold, got: {result}"
        );
        // data cells should be present
        assert!(result.contains("[1]"), "got: {result}");
        assert!(result.contains("[4]"), "got: {result}");
    }

    #[test]
    fn table_three_columns() {
        let md = "| X | Y | Z |\n|---|---|---|\n| a | b | c |";
        let result = markdown_to_typst(md);
        assert!(
            result.contains("1fr, 1fr, 1fr"),
            "3 cols -> 3x 1fr, got: {result}"
        );
    }

    // --- markdown_to_typst: blockquote ---

    #[test]
    fn blockquote() {
        let result = markdown_to_typst("> This is a quote");
        assert!(
            result.contains("italic"),
            "blockquote should be italic, got: {result}"
        );
        assert!(
            result.contains("This is a quote"),
            "quote text should be present, got: {result}"
        );
    }

    // --- markdown_to_typst: horizontal rule ---

    #[test]
    fn horizontal_rule() {
        for marker in &["---", "***", "___"] {
            let result = markdown_to_typst(marker);
            assert!(
                result.contains("#line("),
                "{marker} should produce #line(), got: {result}"
            );
        }
    }

    // --- markdown_to_typst: empty ---

    #[test]
    fn empty_markdown() {
        let result = markdown_to_typst("");
        assert!(result.is_empty() || result.trim().is_empty());
    }

    // --- convert_inline ---

    #[test]
    fn convert_inline_bold() {
        let result = convert_inline("**hello** world");
        assert!(result.contains("*hello*"), "got: {result}");
        assert!(
            !result.contains("**"),
            "should not contain **, got: {result}"
        );
    }

    #[test]
    fn convert_inline_math() {
        let result = convert_inline("value is $x + 1$ here");
        // should keep $ delimiters and convert latex inside
        assert!(result.contains('$'), "got: {result}");
    }

    #[test]
    fn convert_inline_no_formatting() {
        let result = convert_inline("plain text");
        assert_eq!(result, "plain text");
    }

    // --- escape_typst ---

    #[test]
    fn escape_typst_special_chars() {
        assert_eq!(escape_typst("#"), "\\#");
        assert_eq!(escape_typst("$"), "\\$");
        assert_eq!(escape_typst("<>"), "\\<\\>");
        assert_eq!(escape_typst("no specials"), "no specials");
    }

    #[test]
    fn escape_typst_mixed() {
        assert_eq!(escape_typst("a # b $ c"), "a \\# b \\$ c");
    }

    // --- strip_ansi ---

    #[test]
    fn strip_ansi_removes_color_codes() {
        let ansi = "\x1b[31mRed text\x1b[0m";
        let result = strip_ansi(ansi);
        assert_eq!(result, "Red text", "got: {result}");
    }

    #[test]
    fn strip_ansi_no_codes() {
        assert_eq!(strip_ansi("normal text"), "normal text");
    }

    #[test]
    fn strip_ansi_multiple_codes() {
        let ansi = "\x1b[1m\x1b[33mBold yellow\x1b[0m";
        let result = strip_ansi(ansi);
        assert_eq!(result, "Bold yellow", "got: {result}");
    }

    // --- plain_text ---

    #[test]
    fn plain_text_string() {
        let val = serde_json::json!("hello");
        assert_eq!(plain_text(&val), "hello");
    }

    #[test]
    fn plain_text_array() {
        let val = serde_json::json!(["line1", "line2", "line3"]);
        assert_eq!(plain_text(&val), "line1line2line3");
    }

    #[test]
    fn plain_text_number() {
        let val = serde_json::json!(42);
        assert_eq!(plain_text(&val), "42");
    }
}
