use anyhow::{Context, Result};
use base64::Engine;
use std::collections::HashMap;
use std::sync::OnceLock;

use typst::LibraryExt;
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, Source, VirtualPath};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, World};

/// Compile typst source to PDF bytes.
/// `images` — notebook images (name → base64/svg), `assets` — template files (name → raw bytes)
pub fn compile_to_pdf(
    typ_source: &str,
    images: &HashMap<String, String>,
    assets: &HashMap<String, Vec<u8>>,
) -> Result<Vec<u8>> {
    let world = CellForgeWorld::new(typ_source, images, assets)?;

    let document = typst::compile(&world).output.map_err(|errs| {
        let msgs: Vec<String> = errs.iter().map(|e| format!("{:?}", e.message)).collect();
        anyhow::anyhow!("typst compile errors:\n{}", msgs.join("\n"))
    })?;

    let pdf = typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default()).map_err(|errs| {
        let msgs: Vec<String> = errs.iter().map(|e| format!("{e:?}")).collect();
        anyhow::anyhow!("pdf errors:\n{}", msgs.join("\n"))
    })?;

    Ok(pdf)
}

struct CellForgeWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    main: Source,
    files: HashMap<String, Bytes>,
}

impl CellForgeWorld {
    fn new(
        source: &str,
        images: &HashMap<String, String>,
        assets: &HashMap<String, Vec<u8>>,
    ) -> Result<Self> {
        let fonts = load_system_fonts();
        let book = FontBook::from_fonts(fonts.iter());

        let main_id = FileId::new(None, VirtualPath::new("main.typ"));
        let main = Source::new(main_id, source.to_string());

        let mut files = HashMap::new();
        for (name, data) in images {
            let bytes = if name.ends_with(".svg") {
                // SVG is raw text, not base64
                data.as_bytes().to_vec()
            } else {
                // PNG etc — base64 encoded
                base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .with_context(|| format!("decoding image {name}"))?
            };
            files.insert(name.clone(), Bytes::new(bytes));
        }

        // add template assets (images, fonts etc)
        for (name, data) in assets {
            files.insert(name.clone(), Bytes::new(data.clone()));
        }

        Ok(Self {
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(book),
            fonts,
            main,
            files,
        })
    }
}

impl World for CellForgeWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.main.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            Ok(self.main.clone())
        } else {
            Err(FileError::NotFound(id.vpath().as_rootless_path().into()))
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        let path = id.vpath().as_rootless_path().to_string_lossy().to_string();
        self.files
            .get(&path)
            .cloned()
            .ok_or_else(|| FileError::NotFound(path.into()))
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<i64>) -> Option<Datetime> {
        let now = chrono::Local::now();
        let y = now.format("%Y").to_string().parse().ok()?;
        let m = now.format("%m").to_string().parse().ok()?;
        let d = now.format("%d").to_string().parse().ok()?;
        Datetime::from_ymd(y, m, d)
    }
}

// New Computer Modern fonts embedded in the binary
const EMBEDDED_FONTS: &[&[u8]] = &[
    include_bytes!("../fonts/NewCM10-Regular.otf"),
    include_bytes!("../fonts/NewCM10-Bold.otf"),
    include_bytes!("../fonts/NewCM10-Italic.otf"),
    include_bytes!("../fonts/NewCM10-BoldItalic.otf"),
    include_bytes!("../fonts/NewCM10-Book.otf"),
    include_bytes!("../fonts/NewCM10-BookItalic.otf"),
    include_bytes!("../fonts/NewCMMono10-Regular.otf"),
    include_bytes!("../fonts/NewCMMono10-Bold.otf"),
    include_bytes!("../fonts/NewCMMono10-Italic.otf"),
    include_bytes!("../fonts/NewCMMath-Regular.otf"),
    include_bytes!("../fonts/NewCMMath-Book.otf"),
];

fn load_system_fonts() -> Vec<Font> {
    static FONTS: OnceLock<Vec<Font>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut fonts = Vec::new();

            // embedded New Computer Modern — always available
            for data in EMBEDDED_FONTS {
                for font in Font::iter(Bytes::new(data.to_vec())) {
                    fonts.push(font);
                }
            }

            // user fonts
            if let Some(home) = dirs::home_dir() {
                scan_font_dir(&home.join(".local/share/fonts"), &mut fonts);
                scan_font_dir(&home.join(".fonts"), &mut fonts);
            }

            // system fonts
            scan_font_dir(std::path::Path::new("/usr/share/fonts"), &mut fonts);
            scan_font_dir(std::path::Path::new("/usr/local/share/fonts"), &mut fonts);

            fonts
        })
        .clone()
}

fn scan_font_dir(dir: &std::path::Path, fonts: &mut Vec<Font>) {
    if !dir.is_dir() {
        return;
    }
    walk_files(dir, &mut |path| {
        if let Some("ttf" | "otf" | "ttc" | "otc") = path.extension().and_then(|e| e.to_str())
            && let Ok(data) = std::fs::read(path)
        {
            for font in Font::iter(Bytes::new(data)) {
                fonts.push(font);
            }
        }
    });
}

fn walk_files(dir: &std::path::Path, cb: &mut dyn FnMut(&std::path::Path)) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            walk_files(&p, cb);
        } else {
            cb(&p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compile_minimal_typst_to_pdf() {
        let source = r#"
#set page(paper: "a4")
Hello, world!
"#;
        let images = HashMap::new();
        let assets = HashMap::new();

        let result = compile_to_pdf(source, &images, &assets);
        assert!(
            result.is_ok(),
            "minimal typst should compile: {:?}",
            result.err()
        );

        let pdf = result.unwrap();
        // PDF files start with %PDF
        assert!(
            pdf.starts_with(b"%PDF"),
            "output should be a valid PDF, starts with: {:?}",
            &pdf[..4.min(pdf.len())]
        );
        assert!(pdf.len() > 100, "PDF should have meaningful content");
    }

    #[test]
    fn compile_with_math() {
        let source = r#"
#set page(paper: "a4")
#set text(font: "New Computer Modern")
The formula: $ x^2 + y^2 = z^2 $
"#;
        let result = compile_to_pdf(source, &HashMap::new(), &HashMap::new());
        assert!(result.is_ok(), "math should compile: {:?}", result.err());
    }

    #[test]
    fn compile_with_code_block() {
        let source = r#"
#set page(paper: "a4")
```python
print("hello")
```
"#;
        let result = compile_to_pdf(source, &HashMap::new(), &HashMap::new());
        assert!(
            result.is_ok(),
            "code block should compile: {:?}",
            result.err()
        );
    }

    #[test]
    fn compile_invalid_typst_returns_error() {
        let source = r#"#set page(paper: "nonexistent_size_xyz")"#;
        let result = compile_to_pdf(source, &HashMap::new(), &HashMap::new());
        // this should produce a compile error, not panic
        assert!(result.is_err(), "invalid typst should fail gracefully");
    }

    #[test]
    fn compile_empty_source() {
        // empty source should still produce a valid (blank) PDF
        let result = compile_to_pdf("", &HashMap::new(), &HashMap::new());
        assert!(
            result.is_ok(),
            "empty source should compile: {:?}",
            result.err()
        );
    }

    #[test]
    fn compile_with_table() {
        let source = r#"
#set page(paper: "a4")
#table(
  columns: (1fr, 1fr),
  [A], [B],
  [1], [2],
)
"#;
        let result = compile_to_pdf(source, &HashMap::new(), &HashMap::new());
        assert!(result.is_ok(), "table should compile: {:?}", result.err());
    }

    #[test]
    fn cf_world_missing_file_returns_not_found() {
        let world = CellForgeWorld::new("Hello", &HashMap::new(), &HashMap::new())
            .expect("world creation should succeed");
        let fake_id = FileId::new(None, VirtualPath::new("nonexistent.png"));
        let result = world.file(fake_id);
        assert!(result.is_err(), "missing file should return error");
    }

    #[test]
    fn cf_world_source_returns_main() {
        let src = "Test content";
        let world = CellForgeWorld::new(src, &HashMap::new(), &HashMap::new()).unwrap();
        let main_src = world
            .source(world.main())
            .expect("main source should exist");
        assert_eq!(main_src.text(), src);
    }

    #[test]
    fn load_system_fonts_has_embedded() {
        let fonts = load_system_fonts();
        // we embed 11 New Computer Modern font files, each should yield at least one Font
        assert!(
            fonts.len() >= 11,
            "should have at least 11 embedded fonts, got {}",
            fonts.len()
        );
    }
}
