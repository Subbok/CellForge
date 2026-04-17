//! Variable bridge for multi-kernel notebooks.
//!
//! Provides a shared namespace that can sync variables between kernels
//! running different languages (Python, R, Julia). Only "transferable"
//! types under [`MAX_SHARE_SIZE`] are eligible for sharing.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Maximum size (in bytes) of a variable that may be shared across kernels.
pub const MAX_SHARE_SIZE: usize = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Transferable-type whitelists
// ---------------------------------------------------------------------------

const PYTHON_TYPES: &[&str] = &[
    "int",
    "float",
    "str",
    "bool",
    "list",
    "dict",
    "NoneType",
    "numpy.ndarray",
    "DataFrame",
    "Series",
];

const R_TYPES: &[&str] = &[
    "numeric",
    "integer",
    "double",
    "character",
    "logical",
    "data.frame",
    "tibble",
    "matrix",
    "array",
    "list",
];

const JULIA_TYPES: &[&str] = &[
    "Int64",
    "Int32",
    "Float64",
    "Float32",
    "String",
    "Bool",
    "Vector",
    "Matrix",
    "Array",
    "Dict",
    "DataFrame",
    "Nothing",
];

/// Returns `true` when `var_type` belongs to any language's whitelist.
pub fn is_transferable(var_type: &str) -> bool {
    PYTHON_TYPES.contains(&var_type)
        || R_TYPES.contains(&var_type)
        || JULIA_TYPES.contains(&var_type)
}

// ---------------------------------------------------------------------------
// SharedVariable
// ---------------------------------------------------------------------------

/// A single variable that is eligible for cross-kernel sharing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedVariable {
    pub name: String,
    pub var_type: String,
    pub language: String,
    pub value_json: String,
    pub size_bytes: usize,
}

// ---------------------------------------------------------------------------
// SharedNamespace
// ---------------------------------------------------------------------------

/// Holds all currently shared variables, keyed by variable name.
pub struct SharedNamespace {
    pub vars: HashMap<String, SharedVariable>,
}

/// Helper struct matching the JSON objects we expect from kernel introspection.
/// `value_json` and `size_bytes` are optional — variables without a JSON-serialised
/// value cannot be shared across kernels, but still count towards the namespace.
#[derive(Deserialize)]
struct IntrospectionVar {
    name: String,
    #[serde(rename = "type")]
    var_type: String,
    #[serde(default)]
    value_json: Option<String>,
    #[serde(default)]
    size_bytes: Option<usize>,
}

impl SharedNamespace {
    /// Create an empty namespace.
    pub fn new() -> Self {
        Self {
            vars: HashMap::new(),
        }
    }

    /// Update the namespace with the latest variable snapshot from a kernel.
    ///
    /// `language` identifies the source kernel (e.g. `"python"`, `"r"`, `"julia"`).
    /// `vars_json` may be either:
    /// - a JSON **array** of objects: `[{"name": ..., "type": ...}, ...]`, or
    /// - a JSON **object** keyed by name: `{"x": {"name": "x", "type": "int", ...}, ...}`
    ///   (this is what the introspection scripts actually emit).
    ///
    /// Variables without `value_json` are skipped — they can't be injected
    /// into a different kernel. Variables over [`MAX_SHARE_SIZE`] are skipped too.
    ///
    /// Old variables originating from `language` are removed first.
    pub fn update_from_kernel(&mut self, language: &str, vars_json: &str) -> anyhow::Result<()> {
        // Try array first (legacy format), then fall back to object-keyed-by-name.
        let parsed: serde_json::Value = serde_json::from_str(vars_json)?;
        let incoming: Vec<IntrospectionVar> = match parsed {
            serde_json::Value::Array(_) => serde_json::from_value(parsed)?,
            serde_json::Value::Object(map) => map
                .into_values()
                .filter_map(|v| serde_json::from_value::<IntrospectionVar>(v).ok())
                .collect(),
            _ => anyhow::bail!("expected array or object for vars_json"),
        };

        // Remove all existing vars that came from this language.
        self.vars.retain(|_, v| v.language != language);

        for v in incoming {
            if !is_transferable(&v.var_type) {
                continue;
            }
            let Some(value_json) = v.value_json else {
                continue; // introspection didn't produce a serialisable value
            };
            let size_bytes = v.size_bytes.unwrap_or(value_json.len());
            if size_bytes > MAX_SHARE_SIZE {
                continue;
            }
            self.vars.insert(
                v.name.clone(),
                SharedVariable {
                    name: v.name,
                    var_type: v.var_type,
                    language: language.to_string(),
                    value_json,
                    size_bytes,
                },
            );
        }

        Ok(())
    }

    /// Generate assignment code that would recreate `var` in `target_lang`.
    ///
    /// Returns `None` if the target language is unsupported OR if `var`'s value
    /// can't be safely transliterated (e.g. a dict going into R, or a nested
    /// list into Julia). We prefer to skip rather than inject invalid syntax
    /// that would wedge the target kernel.
    pub fn inject_code(var: &SharedVariable, target_lang: &str) -> Option<String> {
        let value = &var.value_json;
        let parsed: serde_json::Value = serde_json::from_str(value).ok()?;
        match target_lang {
            "python" => to_python_literal(&parsed).map(|v| format!("{} = {}", var.name, v)),
            "r" => to_r_literal(&parsed).map(|v| format!("{} <- {}", var.name, v)),
            "julia" => to_julia_literal(&parsed).map(|v| format!("{} = {}", var.name, v)),
            _ => None,
        }
    }

    /// Return injection code for every shared variable whose source language
    /// differs from `target_lang`.
    pub fn injection_code_for(&self, target_lang: &str) -> Vec<String> {
        let mut out = Vec::new();
        for var in self.vars.values() {
            if var.language == target_lang {
                continue;
            }
            if let Some(code) = Self::inject_code(var, target_lang) {
                out.push(code);
            }
        }
        out.sort(); // deterministic order
        out
    }
}

impl Default for SharedNamespace {
    fn default() -> Self {
        Self::new()
    }
}

/// Serialise a parsed JSON value as a Python literal.
/// JSON `true`/`false`/`null` become Python `True`/`False`/`None`.
fn to_python_literal(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Null => Some("None".into()),
        serde_json::Value::Bool(b) => Some(if *b { "True".into() } else { "False".into() }),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::String(s) => Some(format!(
            "\"{}\"",
            s.replace('\\', "\\\\").replace('"', "\\\"")
        )),
        serde_json::Value::Array(arr) => {
            let parts: Vec<String> = arr.iter().filter_map(to_python_literal).collect();
            if parts.len() != arr.len() {
                return None;
            }
            Some(format!("[{}]", parts.join(", ")))
        }
        serde_json::Value::Object(map) => {
            let mut parts = Vec::with_capacity(map.len());
            for (k, val) in map {
                let v = to_python_literal(val)?;
                parts.push(format!(
                    "\"{}\": {}",
                    k.replace('\\', "\\\\").replace('"', "\\\""),
                    v
                ));
            }
            Some(format!("{{{}}}", parts.join(", ")))
        }
    }
}

/// Serialise a parsed JSON value as an R literal.
/// Returns `None` for shapes that can't be safely represented (objects / nested arrays).
fn to_r_literal(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Null => Some("NULL".into()),
        serde_json::Value::Bool(b) => Some(if *b { "TRUE".into() } else { "FALSE".into() }),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::String(s) => Some(format!(
            "\"{}\"",
            s.replace('\\', "\\\\").replace('"', "\\\"")
        )),
        serde_json::Value::Array(arr) => {
            // Only uniform vectors of primitives — R's c() can't mix types cleanly
            // and nested arrays aren't vectors either.
            let mut parts = Vec::with_capacity(arr.len());
            for item in arr {
                match item {
                    serde_json::Value::Null
                    | serde_json::Value::Bool(_)
                    | serde_json::Value::Number(_)
                    | serde_json::Value::String(_) => parts.push(to_r_literal(item)?),
                    _ => return None,
                }
            }
            Some(format!("c({})", parts.join(", ")))
        }
        serde_json::Value::Object(_) => None, // no clean R equivalent for arbitrary dicts
    }
}

/// Serialise a parsed JSON value as a Julia literal.
fn to_julia_literal(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Null => Some("nothing".into()),
        serde_json::Value::Bool(b) => Some(if *b { "true".into() } else { "false".into() }),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::String(s) => Some(format!(
            "\"{}\"",
            s.replace('\\', "\\\\").replace('"', "\\\"")
        )),
        serde_json::Value::Array(arr) => {
            let mut parts = Vec::with_capacity(arr.len());
            for item in arr {
                match item {
                    serde_json::Value::Null
                    | serde_json::Value::Bool(_)
                    | serde_json::Value::Number(_)
                    | serde_json::Value::String(_) => parts.push(to_julia_literal(item)?),
                    _ => return None,
                }
            }
            Some(format!("[{}]", parts.join(", ")))
        }
        serde_json::Value::Object(_) => None,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_transferable_filters_correctly() {
        // Transferable types
        assert!(is_transferable("int"));
        assert!(is_transferable("float"));
        assert!(is_transferable("str"));
        assert!(is_transferable("numpy.ndarray"));
        assert!(is_transferable("DataFrame"));
        assert!(is_transferable("numeric"));
        assert!(is_transferable("data.frame"));
        assert!(is_transferable("Int64"));
        assert!(is_transferable("Bool"));

        // Non-transferable types
        assert!(!is_transferable("RandomForestClassifier"));
        assert!(!is_transferable("lm"));
        assert!(!is_transferable("torch.Tensor"));
        assert!(!is_transferable("SomeCustomType"));
    }

    #[test]
    fn inject_code_python() {
        let var = SharedVariable {
            name: "x".to_string(),
            var_type: "numeric".to_string(),
            language: "r".to_string(),
            value_json: "42".to_string(),
            size_bytes: 8,
        };
        let code = SharedNamespace::inject_code(&var, "python").unwrap();
        assert_eq!(code, "x = 42");
    }

    #[test]
    fn inject_code_python_bool_to_pythonic() {
        let var = SharedVariable {
            name: "flag".to_string(),
            var_type: "bool".to_string(),
            language: "r".to_string(),
            value_json: "true".to_string(),
            size_bytes: 4,
        };
        let code = SharedNamespace::inject_code(&var, "python").unwrap();
        assert_eq!(code, "flag = True");
    }

    #[test]
    fn inject_code_r() {
        let var = SharedVariable {
            name: "flag".to_string(),
            var_type: "bool".to_string(),
            language: "python".to_string(),
            value_json: "true".to_string(),
            size_bytes: 4,
        };
        let code = SharedNamespace::inject_code(&var, "r").unwrap();
        assert_eq!(code, "flag <- TRUE");
    }

    #[test]
    fn inject_code_r_vector() {
        let var = SharedVariable {
            name: "nums".to_string(),
            var_type: "list".to_string(),
            language: "python".to_string(),
            value_json: "[1, 2, 3]".to_string(),
            size_bytes: 9,
        };
        let code = SharedNamespace::inject_code(&var, "r").unwrap();
        assert_eq!(code, "nums <- c(1, 2, 3)");
    }

    #[test]
    fn inject_code_julia() {
        let var = SharedVariable {
            name: "val".to_string(),
            var_type: "NoneType".to_string(),
            language: "python".to_string(),
            value_json: "null".to_string(),
            size_bytes: 4,
        };
        let code = SharedNamespace::inject_code(&var, "julia").unwrap();
        assert_eq!(code, "val = nothing");
    }

    #[test]
    fn inject_code_r_skips_objects() {
        let var = SharedVariable {
            name: "d".to_string(),
            var_type: "dict".to_string(),
            language: "python".to_string(),
            value_json: r#"{"a": 1}"#.to_string(),
            size_bytes: 8,
        };
        // Objects have no clean R equivalent → skip injection rather than
        // produce invalid syntax that would wedge the kernel.
        assert!(SharedNamespace::inject_code(&var, "r").is_none());
    }

    #[test]
    fn injection_code_filters_same_language() {
        let mut ns = SharedNamespace::new();
        let json = r#"[
            {"name": "a", "type": "int",   "value_json": "1", "size_bytes": 8},
            {"name": "b", "type": "float", "value_json": "2.5", "size_bytes": 8}
        ]"#;
        ns.update_from_kernel("python", json).unwrap();

        // Asking for python injection should yield nothing — both vars are from python.
        let codes = ns.injection_code_for("python");
        assert!(codes.is_empty());

        // Asking for R injection should yield both.
        let codes = ns.injection_code_for("r");
        assert_eq!(codes.len(), 2);
    }

    #[test]
    fn skips_oversized_variables() {
        let mut ns = SharedNamespace::new();
        let big = MAX_SHARE_SIZE + 1;
        let json = format!(
            r#"[{{"name": "huge", "type": "str", "value_json": "\"big\"", "size_bytes": {}}}]"#,
            big
        );
        ns.update_from_kernel("python", &json).unwrap();
        assert!(ns.vars.is_empty());
    }

    #[test]
    fn skips_non_transferable_types() {
        let mut ns = SharedNamespace::new();
        let json = r#"[
            {"name": "model", "type": "RandomForestClassifier", "value_json": "{}", "size_bytes": 100}
        ]"#;
        ns.update_from_kernel("python", json).unwrap();
        assert!(ns.vars.is_empty());
    }
}
