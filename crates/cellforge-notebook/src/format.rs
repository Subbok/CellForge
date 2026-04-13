use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashMap;

// nbformat v4 types. we need to match the jupyter notebook json schema exactly
// so that we can read and write .ipynb files without losing data.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notebook {
    pub metadata: NotebookMetadata,
    pub nbformat: u32,
    pub nbformat_minor: u32,
    pub cells: Vec<Cell>,
}

impl Notebook {
    pub fn new_empty(kernel_name: &str, display_name: &str, language: &str) -> Self {
        Notebook {
            metadata: NotebookMetadata {
                kernelspec: Some(KernelspecMetadata {
                    name: kernel_name.to_string(),
                    display_name: display_name.to_string(),
                    language: Some(language.to_string()),
                }),
                language_info: Some(LanguageInfoMetadata {
                    name: language.to_string(),
                    ..Default::default()
                }),
                extra: Default::default(),
            },
            nbformat: 4,
            nbformat_minor: 5,
            cells: vec![Cell::Code(CodeCell::new_empty())],
        }
    }
}

// metadata structs - the `extra` fields catch anything we don't explicitly model
// so we don't silently drop custom metadata that some tools add.

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NotebookMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kernelspec: Option<KernelspecMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_info: Option<LanguageInfoMetadata>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelspecMetadata {
    pub name: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LanguageInfoMetadata {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codemirror_mode: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_extension: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mimetype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pygments_lexer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nbconvert_exporter: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// The annoying thing about nbformat: `source` and `text` fields can be either
// a plain string OR an array of strings. We normalize to a single String internally
// but have to handle both on deser and write back as array on ser.

#[derive(Debug, Clone, PartialEq)]
pub struct MultilineString(pub String);

impl MultilineString {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for MultilineString {
    fn from(s: String) -> Self {
        MultilineString(s)
    }
}

impl From<&str> for MultilineString {
    fn from(s: &str) -> Self {
        MultilineString(s.to_string())
    }
}

impl Serialize for MultilineString {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // Serialize as array of lines (standard nbformat convention).
        // Each line except the last includes its trailing newline.
        let s = &self.0;
        if s.is_empty() {
            return serializer.serialize_str("");
        }
        let lines: Vec<&str> = s.split_inclusive('\n').collect();
        lines.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for MultilineString {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum StringOrArray {
            String(String),
            Array(Vec<String>),
        }
        match StringOrArray::deserialize(deserializer)? {
            StringOrArray::String(s) => Ok(MultilineString(s)),
            StringOrArray::Array(v) => Ok(MultilineString(v.join(""))),
        }
    }
}

// --- cells ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "cell_type")]
pub enum Cell {
    #[serde(rename = "code")]
    Code(CodeCell),
    #[serde(rename = "markdown")]
    Markdown(MarkdownCell),
    #[serde(rename = "raw")]
    Raw(RawCell),
}

impl Cell {
    pub fn id(&self) -> Option<&str> {
        match self {
            Cell::Code(c) => c.id.as_deref(),
            Cell::Markdown(c) => c.id.as_deref(),
            Cell::Raw(c) => c.id.as_deref(),
        }
    }

    pub fn source(&self) -> &str {
        match self {
            Cell::Code(c) => c.source.as_str(),
            Cell::Markdown(c) => c.source.as_str(),
            Cell::Raw(c) => c.source.as_str(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeCell {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub source: MultilineString,
    #[serde(default)]
    pub metadata: serde_json::Value,
    #[serde(default)]
    pub outputs: Vec<Output>,
    pub execution_count: Option<u32>,
}

impl CodeCell {
    pub fn new_empty() -> Self {
        CodeCell {
            id: Some(uuid::Uuid::new_v4().to_string()),
            source: MultilineString(String::new()),
            metadata: serde_json::Value::Object(Default::default()),
            outputs: vec![],
            execution_count: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownCell {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub source: MultilineString,
    #[serde(default)]
    pub metadata: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<HashMap<String, serde_json::Value>>,
}

impl MarkdownCell {
    pub fn new_empty() -> Self {
        MarkdownCell {
            id: Some(uuid::Uuid::new_v4().to_string()),
            source: MultilineString(String::new()),
            metadata: serde_json::Value::Object(Default::default()),
            attachments: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawCell {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub source: MultilineString,
    #[serde(default)]
    pub metadata: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<HashMap<String, serde_json::Value>>,
}

// --- output types (the stuff that shows up below code cells) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "output_type")]
pub enum Output {
    #[serde(rename = "execute_result")]
    ExecuteResult(ExecuteResultOutput),
    #[serde(rename = "display_data")]
    DisplayData(DisplayDataOutput),
    #[serde(rename = "update_display_data")]
    UpdateDisplayData(DisplayDataOutput),
    #[serde(rename = "stream")]
    Stream(StreamOutput),
    #[serde(rename = "error")]
    Error(ErrorOutput),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteResultOutput {
    pub execution_count: Option<u32>,
    pub data: MimeBundle,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayDataOutput {
    pub data: MimeBundle,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamOutput {
    pub name: String, // "stdout" | "stderr"
    pub text: MultilineString,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorOutput {
    pub ename: String,
    pub evalue: String,
    pub traceback: Vec<String>,
}

pub type MimeBundle = HashMap<String, serde_json::Value>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiline_string_deserialize_string() {
        let json = r#""hello world""#;
        let ms: MultilineString = serde_json::from_str(json).unwrap();
        assert_eq!(ms.0, "hello world");
    }

    #[test]
    fn multiline_string_deserialize_array() {
        let json = r#"["line1\n", "line2\n", "line3"]"#;
        let ms: MultilineString = serde_json::from_str(json).unwrap();
        assert_eq!(ms.0, "line1\nline2\nline3");
    }

    #[test]
    fn multiline_string_serialize_to_array() {
        let ms = MultilineString("line1\nline2\nline3".to_string());
        let json = serde_json::to_string(&ms).unwrap();
        assert_eq!(json, r#"["line1\n","line2\n","line3"]"#);
    }

    #[test]
    fn multiline_string_empty() {
        let ms = MultilineString(String::new());
        let json = serde_json::to_string(&ms).unwrap();
        assert_eq!(json, r#""""#);
    }

    #[test]
    fn cell_code_roundtrip() {
        let json = r#"{
            "cell_type": "code",
            "id": "abc123",
            "source": ["import pandas as pd\n", "df = pd.read_csv('data.csv')"],
            "metadata": {},
            "outputs": [],
            "execution_count": 1
        }"#;
        let cell: Cell = serde_json::from_str(json).unwrap();
        match &cell {
            Cell::Code(c) => {
                assert_eq!(c.id.as_deref(), Some("abc123"));
                assert_eq!(
                    c.source.as_str(),
                    "import pandas as pd\ndf = pd.read_csv('data.csv')"
                );
                assert_eq!(c.execution_count, Some(1));
            }
            _ => panic!("Expected code cell"),
        }
        // Roundtrip
        let serialized = serde_json::to_string(&cell).unwrap();
        let _: Cell = serde_json::from_str(&serialized).unwrap();
    }

    #[test]
    fn cell_markdown_roundtrip() {
        let json = r##"{
            "cell_type": "markdown",
            "id": "md1",
            "source": "# Hello\n\nThis is **bold**.",
            "metadata": {}
        }"##;
        let cell: Cell = serde_json::from_str(json).unwrap();
        match &cell {
            Cell::Markdown(c) => {
                assert_eq!(c.source.as_str(), "# Hello\n\nThis is **bold**.");
            }
            _ => panic!("Expected markdown cell"),
        }
    }

    #[test]
    fn output_stream() {
        let json = r#"{
            "output_type": "stream",
            "name": "stdout",
            "text": ["hello\n", "world"]
        }"#;
        let output: Output = serde_json::from_str(json).unwrap();
        match &output {
            Output::Stream(s) => {
                assert_eq!(s.name, "stdout");
                assert_eq!(s.text.as_str(), "hello\nworld");
            }
            _ => panic!("Expected stream output"),
        }
    }

    #[test]
    fn output_execute_result() {
        let json = r#"{
            "output_type": "execute_result",
            "execution_count": 5,
            "data": {
                "text/plain": "42",
                "text/html": "<b>42</b>"
            },
            "metadata": {}
        }"#;
        let output: Output = serde_json::from_str(json).unwrap();
        match &output {
            Output::ExecuteResult(r) => {
                assert_eq!(r.execution_count, Some(5));
                assert!(r.data.contains_key("text/plain"));
            }
            _ => panic!("Expected execute_result"),
        }
    }

    #[test]
    fn notebook_full_roundtrip() {
        let json = r##"{
            "metadata": {
                "kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"},
                "language_info": {"name": "python", "version": "3.11.0"},
                "custom_field": "should be preserved"
            },
            "nbformat": 4,
            "nbformat_minor": 5,
            "cells": [
                {"cell_type": "code", "id": "c1", "source": "x = 1", "metadata": {}, "outputs": [], "execution_count": null},
                {"cell_type": "markdown", "id": "m1", "source": "# Title", "metadata": {}}
            ]
        }"##;
        let nb: Notebook = serde_json::from_str(json).unwrap();
        assert_eq!(nb.cells.len(), 2);
        assert_eq!(
            nb.metadata.extra.get("custom_field").unwrap(),
            "should be preserved"
        );

        // roundtrip through serialize → deserialize
        let serialized = serde_json::to_string_pretty(&nb).unwrap();
        let nb2: Notebook = serde_json::from_str(&serialized).unwrap();
        assert_eq!(nb2.cells.len(), 2);
        assert_eq!(
            nb2.metadata.extra.get("custom_field").unwrap(),
            "should be preserved"
        );
    }

    #[test]
    fn new_empty_notebook() {
        let nb = Notebook::new_empty("python3", "Python 3", "python");
        assert_eq!(nb.nbformat, 4);
        assert_eq!(nb.nbformat_minor, 5);
        assert_eq!(nb.cells.len(), 1);
        match &nb.cells[0] {
            Cell::Code(c) => {
                assert!(c.id.is_some());
                assert_eq!(c.source.as_str(), "");
            }
            _ => panic!("Expected code cell"),
        }
        let ks = nb.metadata.kernelspec.as_ref().unwrap();
        assert_eq!(ks.name, "python3");
    }

    #[test]
    fn multiline_string_single_line_no_newline() {
        let ms = MultilineString("hello".to_string());
        let json = serde_json::to_string(&ms).unwrap();
        assert_eq!(json, r#"["hello"]"#);
    }

    #[test]
    fn multiline_string_trailing_newline() {
        let ms = MultilineString("line1\nline2\n".to_string());
        let json = serde_json::to_string(&ms).unwrap();
        assert_eq!(json, r#"["line1\n","line2\n"]"#);
    }

    #[test]
    fn cell_raw_roundtrip() {
        let json = r#"{
            "cell_type": "raw",
            "id": "r1",
            "source": "raw text",
            "metadata": {}
        }"#;
        let cell: Cell = serde_json::from_str(json).unwrap();
        match &cell {
            Cell::Raw(c) => assert_eq!(c.source.as_str(), "raw text"),
            _ => panic!("Expected raw cell"),
        }
    }

    #[test]
    fn cell_id_accessor() {
        let json = r#"{"cell_type": "code", "id": "test-id", "source": "", "metadata": {}, "outputs": [], "execution_count": null}"#;
        let cell: Cell = serde_json::from_str(json).unwrap();
        assert_eq!(cell.id(), Some("test-id"));
        assert_eq!(cell.source(), "");
    }

    #[test]
    fn output_display_data() {
        let json = r#"{
            "output_type": "display_data",
            "data": {"image/png": "base64data"},
            "metadata": {}
        }"#;
        let output: Output = serde_json::from_str(json).unwrap();
        match &output {
            Output::DisplayData(d) => assert!(d.data.contains_key("image/png")),
            _ => panic!("Expected display_data"),
        }
    }

    #[test]
    fn output_error() {
        let json = r#"{
            "output_type": "error",
            "ename": "NameError",
            "evalue": "name 'x' is not defined",
            "traceback": [
                "\u001b[0;31m---------------------------------------------------------------------------\u001b[0m",
                "\u001b[0;31mNameError\u001b[0m: name 'x' is not defined"
            ]
        }"#;
        let output: Output = serde_json::from_str(json).unwrap();
        match &output {
            Output::Error(e) => {
                assert_eq!(e.ename, "NameError");
                assert_eq!(e.traceback.len(), 2);
            }
            _ => panic!("Expected error output"),
        }
    }
}
