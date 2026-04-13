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
#[derive(Deserialize)]
struct IntrospectionVar {
    name: String,
    #[serde(rename = "type")]
    var_type: String,
    value_json: String,
    size_bytes: usize,
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
    /// `vars_json` is expected to be a JSON array of objects with fields:
    /// `name`, `type`, `value_json`, `size_bytes`.
    ///
    /// Old variables originating from `language` are removed first, then new
    /// ones are inserted — provided they are transferable and under
    /// [`MAX_SHARE_SIZE`].
    pub fn update_from_kernel(&mut self, language: &str, vars_json: &str) -> anyhow::Result<()> {
        let incoming: Vec<IntrospectionVar> = serde_json::from_str(vars_json)?;

        // Remove all existing vars that came from this language.
        self.vars.retain(|_, v| v.language != language);

        for v in incoming {
            if !is_transferable(&v.var_type) {
                continue;
            }
            if v.size_bytes > MAX_SHARE_SIZE {
                continue;
            }
            self.vars.insert(
                v.name.clone(),
                SharedVariable {
                    name: v.name,
                    var_type: v.var_type,
                    language: language.to_string(),
                    value_json: v.value_json,
                    size_bytes: v.size_bytes,
                },
            );
        }

        Ok(())
    }

    /// Generate assignment code that would recreate `var` in `target_lang`.
    ///
    /// Returns `None` if the target language is unsupported.
    pub fn inject_code(var: &SharedVariable, target_lang: &str) -> Option<String> {
        let value = &var.value_json;
        match target_lang {
            "python" => Some(format!("{} = {}", var.name, value)),
            "r" => {
                let converted = value
                    .replace("True", "TRUE")
                    .replace("False", "FALSE")
                    .replace("None", "NULL");
                Some(format!("{} <- {}", var.name, converted))
            }
            "julia" => {
                let converted = value
                    .replace("True", "true")
                    .replace("False", "false")
                    .replace("None", "nothing");
                Some(format!("{} = {}", var.name, converted))
            }
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
    fn inject_code_r() {
        let var = SharedVariable {
            name: "flag".to_string(),
            var_type: "bool".to_string(),
            language: "python".to_string(),
            value_json: "True".to_string(),
            size_bytes: 4,
        };
        let code = SharedNamespace::inject_code(&var, "r").unwrap();
        assert_eq!(code, "flag <- TRUE");
    }

    #[test]
    fn inject_code_julia() {
        let var = SharedVariable {
            name: "val".to_string(),
            var_type: "NoneType".to_string(),
            language: "python".to_string(),
            value_json: "None".to_string(),
            size_bytes: 4,
        };
        let code = SharedNamespace::inject_code(&var, "julia").unwrap();
        assert_eq!(code, "val = nothing");
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
