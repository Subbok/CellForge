use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Info about a single variable in the user's kernel namespace.
/// We get this by running introspection code silently after each execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariableInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub var_type: String,
    pub module: Option<String>,
    pub shape: Option<String>,
    pub dtype: Option<String>,
    pub size: Option<usize>,
    pub repr: String,
}

/// When the user clicks on a dataframe in the variable explorer
/// we fetch a preview of the first N rows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataFramePreview {
    pub columns: Vec<String>,
    pub dtypes: HashMap<String, String>,
    pub shape: (usize, usize),
    pub head: Vec<serde_json::Value>, // each row as a json object
    pub describe: Option<serde_json::Value>,
}
