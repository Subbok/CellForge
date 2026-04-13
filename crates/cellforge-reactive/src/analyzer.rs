use std::collections::HashSet;
use tree_sitter::{Node, Parser, Tree};

#[derive(Debug, Clone, Default)]
pub struct CellSymbols {
    pub defs: HashSet<String>,
    pub refs: HashSet<String>,
}

static BUILTINS: &[&str] = &[
    "print",
    "len",
    "range",
    "int",
    "float",
    "str",
    "bool",
    "list",
    "dict",
    "set",
    "tuple",
    "type",
    "isinstance",
    "issubclass",
    "hasattr",
    "getattr",
    "setattr",
    "delattr",
    "super",
    "object",
    "None",
    "True",
    "False",
    "enumerate",
    "zip",
    "map",
    "filter",
    "sorted",
    "reversed",
    "any",
    "all",
    "min",
    "max",
    "sum",
    "abs",
    "round",
    "open",
    "input",
    "repr",
    "format",
    "id",
    "hash",
    "callable",
    "iter",
    "next",
    "property",
    "staticmethod",
    "classmethod",
    "ValueError",
    "TypeError",
    "KeyError",
    "IndexError",
    "AttributeError",
    "Exception",
    "RuntimeError",
    "StopIteration",
    "NotImplementedError",
    "ImportError",
    "OSError",
    "FileNotFoundError",
];

pub fn analyze(source: &str) -> CellSymbols {
    let mut parser = Parser::new();
    let lang = tree_sitter_python::LANGUAGE;
    parser.set_language(&lang.into()).expect("python grammar");

    let Some(tree) = parser.parse(source, None) else {
        return CellSymbols::default();
    };

    let mut analyzer = Analyzer::new(source.as_bytes());
    analyzer.analyze(&tree);

    let builtin_set: HashSet<&str> = BUILTINS.iter().copied().collect();
    analyzer
        .syms
        .refs
        .retain(|name| !builtin_set.contains(name.as_str()));

    analyzer.syms
}

struct Analyzer<'a> {
    src: &'a [u8],
    syms: CellSymbols,
    scopes: Vec<HashSet<String>>, // Stack of local scopes
    globals: HashSet<String>,     // Names explicitly marked as global
}

impl<'a> Analyzer<'a> {
    fn new(src: &'a [u8]) -> Self {
        Self {
            src,
            syms: CellSymbols::default(),
            scopes: vec![HashSet::new()], // Start with global scope
            globals: HashSet::new(),
        }
    }

    fn analyze(&mut self, tree: &Tree) {
        self.visit(tree.root_node());
    }

    fn is_global_scope(&self) -> bool {
        self.scopes.len() == 1
    }

    fn add_def(&mut self, name: String) {
        if self.is_global_scope() || self.globals.contains(&name) {
            self.syms.defs.insert(name);
        } else {
            // Local to a function
            if let Some(scope) = self.scopes.last_mut() {
                scope.insert(name);
            }
        }
    }

    fn add_ref(&mut self, name: String) {
        // If it's not in any local scope, it's a potential global reference
        let is_local = self.scopes.iter().any(|scope| scope.contains(&name));
        if !is_local {
            self.syms.refs.insert(name);
        }
    }

    fn visit(&mut self, node: Node) {
        let kind = node.kind();

        match kind {
            "assignment" | "augmented_assignment" => {
                if let Some(left) = node.child_by_field_name("left") {
                    self.collect_defs(left);
                }
                if let Some(right) = node.child_by_field_name("right") {
                    self.visit(right);
                }
                if kind == "augmented_assignment"
                    && let Some(left) = node.child_by_field_name("left")
                {
                    self.collect_refs(left);
                }
            }
            "function_definition" => {
                if let Some(name_node) = node.child_by_field_name("name")
                    && let Ok(name) = name_node.utf8_text(self.src)
                {
                    self.add_def(name.to_string());
                }
                // Enter function scope
                self.scopes.push(HashSet::new());

                // Add parameters to local scope
                if let Some(params) = node.child_by_field_name("parameters") {
                    self.collect_defs(params);
                }

                if let Some(body) = node.child_by_field_name("body") {
                    self.visit(body);
                }
                self.scopes.pop();
            }
            "class_definition" => {
                if let Some(name_node) = node.child_by_field_name("name")
                    && let Ok(name) = name_node.utf8_text(self.src)
                {
                    self.add_def(name.to_string());
                }
                // Classes also have scopes, but for cell deps we mostly care about the class name itself
                self.scopes.push(HashSet::new());
                if let Some(body) = node.child_by_field_name("body") {
                    self.visit(body);
                }
                self.scopes.pop();
            }
            "for_statement" => {
                // `for i in items:` — the loop variable is a definition
                if let Some(left) = node.child_by_field_name("left") {
                    self.collect_defs(left);
                }
                // the iterable is a reference
                if let Some(right) = node.child_by_field_name("right") {
                    self.visit(right);
                }
                if let Some(body) = node.child_by_field_name("body") {
                    self.visit(body);
                }
            }
            "import_statement" | "import_from_statement" => {
                self.collect_import_defs(node);
            }
            "global_statement" => {
                // All identifiers in this statement are marked as global definitions
                for i in 0..node.child_count() {
                    let child = node.child(i).unwrap();
                    if child.kind() == "identifier"
                        && let Ok(name) = child.utf8_text(self.src)
                    {
                        self.globals.insert(name.to_string());
                    }
                }
            }
            "identifier" => {
                if let Ok(name) = node.utf8_text(self.src) {
                    self.add_ref(name.to_string());
                }
            }
            "attribute" => {
                // Only the base object is a reference (e.g., in df.head, only df is ref)
                if let Some(obj) = node.child_by_field_name("object") {
                    self.visit(obj);
                }
            }
            _ => {
                // Standard recursive walk
                let mut cursor = node.walk();
                if cursor.goto_first_child() {
                    loop {
                        self.visit(cursor.node());
                        if !cursor.goto_next_sibling() {
                            break;
                        }
                    }
                }
            }
        }
    }

    fn collect_defs(&mut self, node: Node) {
        match node.kind() {
            "identifier" => {
                if let Ok(name) = node.utf8_text(self.src) {
                    self.add_def(name.to_string());
                }
            }
            "pattern_list" | "tuple_pattern" | "tuple" | "parameters" | "default_parameter"
            | "typed_parameter" => {
                for i in 0..node.child_count() {
                    self.collect_defs(node.child(i).unwrap());
                }
            }
            "list_splat_pattern" | "dictionary_splat_pattern" => {
                if let Some(child) = node.child(0) {
                    self.collect_defs(child);
                }
            }
            _ => {
                // recurse for nested patterns
                let mut cursor = node.walk();
                if cursor.goto_first_child() {
                    loop {
                        self.collect_defs(cursor.node());
                        if !cursor.goto_next_sibling() {
                            break;
                        }
                    }
                }
            }
        }
    }

    fn collect_refs(&mut self, node: Node) {
        if node.kind() == "identifier" {
            if let Ok(name) = node.utf8_text(self.src) {
                self.add_ref(name.to_string());
            }
        } else if node.kind() == "attribute" {
            if let Some(obj) = node.child_by_field_name("object") {
                self.collect_refs(obj);
            }
        } else {
            let mut cursor = node.walk();
            if cursor.goto_first_child() {
                loop {
                    self.collect_refs(cursor.node());
                    if !cursor.goto_next_sibling() {
                        break;
                    }
                }
            }
        }
    }

    fn collect_import_defs(&mut self, node: Node) {
        for i in 0..node.child_count() {
            let child = node.child(i).unwrap();
            match child.kind() {
                "dotted_name" => {
                    // import os.path -> we take the first part as the bound name
                    if let Some(first) = child.child(0)
                        && let Ok(name) = first.utf8_text(self.src)
                    {
                        self.add_def(name.to_string());
                    }
                }
                "aliased_import" => {
                    if let Some(alias) = child.child_by_field_name("alias")
                        && let Ok(name) = alias.utf8_text(self.src)
                    {
                        self.add_def(name.to_string());
                    } else if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(self.src)
                    {
                        self.add_def(name.to_string());
                    }
                }
                "import_from_statement" => {
                    // nested recursion
                    self.collect_import_defs(child);
                }
                _ => {
                    if child.kind() == "identifier"
                        && let Ok(name) = child.utf8_text(self.src)
                    {
                        // case for 'from x import y' where y is identifier
                        self.add_def(name.to_string());
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- simple assignment ---

    #[test]
    fn simple_assignment() {
        let s = analyze("x = 42");
        assert!(s.defs.contains("x"));
        assert!(s.refs.is_empty());
    }

    #[test]
    fn tuple_unpacking() {
        let s = analyze("a, b = 1, 2");
        assert!(s.defs.contains("a"));
        assert!(s.defs.contains("b"));
    }

    #[test]
    fn augmented_assignment_refs_lhs() {
        let s = analyze("x += 1");
        assert!(s.defs.contains("x"));
        assert!(
            s.refs.contains("x"),
            "augmented assignment should also ref the lhs"
        );
    }

    // --- references ---

    #[test]
    fn simple_reference() {
        let s = analyze("y = x + 1");
        assert!(s.defs.contains("y"));
        assert!(s.refs.contains("x"));
    }

    #[test]
    fn attribute_only_refs_base() {
        let s = analyze("df.head()");
        assert!(s.refs.contains("df"));
        assert!(
            !s.refs.contains("head"),
            "attribute access should not count as ref"
        );
    }

    #[test]
    fn chained_attribute() {
        let s = analyze("result = obj.attr.method()");
        assert!(s.defs.contains("result"));
        assert!(s.refs.contains("obj"));
        assert!(!s.refs.contains("attr"));
        assert!(!s.refs.contains("method"));
    }

    // --- builtins are filtered ---

    #[test]
    fn builtins_not_in_refs() {
        let s = analyze("x = len([1, 2, 3])");
        assert!(s.defs.contains("x"));
        assert!(!s.refs.contains("len"), "builtins should be filtered out");
        assert!(!s.refs.contains("print"));
    }

    #[test]
    fn none_true_false_filtered() {
        let s = analyze("x = None\ny = True\nz = False");
        assert!(!s.refs.contains("None"));
        assert!(!s.refs.contains("True"));
        assert!(!s.refs.contains("False"));
    }

    // --- imports ---

    #[test]
    fn import_statement() {
        let s = analyze("import numpy");
        assert!(s.defs.contains("numpy"));
    }

    #[test]
    fn import_dotted() {
        let s = analyze("import os.path");
        assert!(
            s.defs.contains("os"),
            "dotted import should define the first component"
        );
    }

    #[test]
    fn import_alias() {
        let s = analyze("import numpy as np");
        assert!(s.defs.contains("np"), "alias should be the defined name");
        assert!(
            !s.defs.contains("numpy"),
            "original name should not be defined when aliased"
        );
    }

    #[test]
    fn from_import() {
        let s = analyze("from os import getcwd");
        assert!(s.defs.contains("getcwd"));
    }

    #[test]
    fn from_import_alias() {
        let s = analyze("from pandas import DataFrame as DF");
        assert!(s.defs.contains("DF"));
        assert!(!s.defs.contains("DataFrame"));
    }

    // --- functions ---

    #[test]
    fn function_def_is_global_def() {
        let s = analyze("def foo(x):\n    return x + 1");
        assert!(s.defs.contains("foo"));
        assert!(
            !s.defs.contains("x"),
            "parameter should not be a global def"
        );
    }

    #[test]
    fn function_params_are_local() {
        let s = analyze("def add(a, b):\n    return a + b");
        assert!(s.defs.contains("add"));
        assert!(!s.refs.contains("a"), "params should be local, not refs");
        assert!(!s.refs.contains("b"));
    }

    #[test]
    fn function_body_refs_external() {
        let s = analyze("def process():\n    return df.head()");
        assert!(s.defs.contains("process"));
        assert!(
            s.refs.contains("df"),
            "function body should ref external names"
        );
    }

    #[test]
    fn local_var_in_function_not_global() {
        let s = analyze("def foo():\n    temp = 42\n    return temp");
        assert!(s.defs.contains("foo"));
        assert!(
            !s.defs.contains("temp"),
            "local var should not be global def"
        );
        assert!(
            !s.refs.contains("temp"),
            "local var should not be global ref"
        );
    }

    // --- classes ---

    #[test]
    fn class_def_is_global_def() {
        let s = analyze("class MyClass:\n    pass");
        assert!(s.defs.contains("MyClass"));
    }

    #[test]
    fn class_body_refs_external() {
        let s = analyze("class MyModel:\n    data = load_data()");
        assert!(s.defs.contains("MyModel"));
        assert!(s.refs.contains("load_data"));
    }

    // --- global statement ---

    #[test]
    fn global_statement_promotes_to_def() {
        let s = analyze("def foo():\n    global counter\n    counter = 0");
        assert!(s.defs.contains("foo"));
        assert!(
            s.defs.contains("counter"),
            "global keyword should promote to global def"
        );
    }

    // --- for loops / comprehensions ---

    #[test]
    fn for_loop_target_is_def() {
        let s = analyze("for i in items:\n    pass");
        assert!(s.defs.contains("i"));
        assert!(s.refs.contains("items"));
    }

    // --- multiline / realistic cells ---

    #[test]
    fn realistic_data_science_cell() {
        let s = analyze(
            "import pandas as pd\ndf = pd.read_csv('data.csv')\nresult = df.groupby('col').mean()",
        );
        assert!(s.defs.contains("pd"));
        assert!(s.defs.contains("df"));
        assert!(s.defs.contains("result"));
        // pd is both defined and used
        assert!(
            s.refs.contains("pd"),
            "pd is used after being defined in the same cell"
        );
    }

    #[test]
    fn empty_source() {
        let s = analyze("");
        assert!(s.defs.is_empty());
        assert!(s.refs.is_empty());
    }

    #[test]
    fn comment_only() {
        let s = analyze("# this is a comment");
        assert!(s.defs.is_empty());
        assert!(s.refs.is_empty());
    }

    #[test]
    fn syntax_error_returns_default() {
        // tree-sitter is error-tolerant, but should not panic
        let s = analyze("def (broken syntax {{{");
        // just check it doesn't crash — exact output depends on error recovery
        let _ = s;
    }
}
