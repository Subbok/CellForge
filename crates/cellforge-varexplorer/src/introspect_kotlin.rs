/// Kotlin (kotlin-jupyter) variable introspection. kotlin-jupyter exposes
/// a `notebook` global with `variablesState.variables` — a map of user
/// variables declared at the top level. This is the only practical way
/// to enumerate them from user code (each cell compiles into its own
/// script class, so direct reflection doesn't work).
///
/// Emits JSON matching the Python shape:
///   { "name": { "name": "x", "type": "Int", "repr": "42" } }
pub const INSPECT_VARIABLES: &str = r#"
try {
    val __cf_vars = notebook.variablesState.variables
    val __cf_sb = StringBuilder("{")
    var __cf_first = true
    for ((__cf_n, __cf_desc) in __cf_vars) {
        if (__cf_n.startsWith("__cf_") || __cf_n.startsWith("_")) continue
        val __cf_v = try { __cf_desc.value } catch (e: Exception) { null }
        val __cf_t = __cf_v?.javaClass?.simpleName ?: "Unknown"
        val __cf_repr = try {
            val s = __cf_v?.toString() ?: "null"
            if (s.length > 500) s.substring(0, 500) else s
        } catch (e: Exception) { "<error>" }
        val __cf_repr_esc = __cf_repr
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
        if (!__cf_first) __cf_sb.append(",")
        __cf_first = false
        __cf_sb.append("\"$__cf_n\":{\"name\":\"$__cf_n\",\"type\":\"$__cf_t\",\"repr\":\"$__cf_repr_esc\"}")
    }
    __cf_sb.append("}")
    println(__cf_sb.toString())
} catch (e: Exception) {
    println("{}")
}
"#;

/// Preview a List/Array of maps as a dataframe-like table.
pub fn dataframe_preview_code(var_name: &str) -> String {
    format!(
        r#"
try {{
    val __cf_v = notebook.variablesState.variables["{var_name}"]?.value
    if (__cf_v is List<*> && __cf_v.isNotEmpty()) {{
        val __cf_first = __cf_v.first()
        val __cf_cols: List<String> = if (__cf_first is Map<*, *>)
            __cf_first.keys.map {{ it.toString() }}
        else listOf("value")
        val __cf_head = __cf_v.take(50).map {{ row ->
            if (row is Map<*, *>) row.entries.associate {{ it.key.toString() to it.value }}
            else mapOf("value" to row)
        }}
        val __cf_sb = StringBuilder("{{")
        __cf_sb.append("\"columns\":[${{__cf_cols.joinToString(",") {{ "\"$it\"" }}}}],")
        __cf_sb.append("\"dtypes\":{{${{__cf_cols.joinToString(",") {{ "\"$it\":\"Any\"" }}}}}},")
        __cf_sb.append("\"shape\":[${{__cf_v.size}},${{__cf_cols.size}}],")
        __cf_sb.append("\"head\":[")
        __cf_sb.append(__cf_head.joinToString(",") {{ row ->
            "{{" + row.entries.joinToString(",") {{ e ->
                val vs = (e.value?.toString() ?: "null").replace("\"", "\\\"")
                "\"${{e.key}}\":\"$vs\""
            }} + "}}"
        }})
        __cf_sb.append("]}}")
        println(__cf_sb.toString())
    }} else {{
        println("null")
    }}
}} catch (e: Exception) {{
    println("null")
}}
"#
    )
}
