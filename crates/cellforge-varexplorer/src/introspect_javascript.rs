/// JavaScript (ijavascript) variable introspection. Runs in Node.js context
/// where user variables land on `global`. We filter out Node.js internals and
/// functions, then emit JSON matching the Python shape:
///   { "name": { "name": "x", "type": "Number", "repr": "42", "size": null } }
pub const INSPECT_VARIABLES: &str = r#"
(() => {
    const __cf_skip = new Set([
        'global', 'globalThis', 'process', 'Buffer', 'console',
        'setTimeout', 'setInterval', 'setImmediate',
        'clearTimeout', 'clearInterval', 'clearImmediate',
        'queueMicrotask', 'require', 'module', 'exports',
        '__filename', '__dirname', 'atob', 'btoa', 'fetch',
        'crypto', 'performance', 'structuredClone',
        'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams',
        'AbortController', 'AbortSignal', 'Event', 'EventTarget',
        'MessageChannel', 'MessagePort', 'WebAssembly',
        '$$', '$$done$$', '$$async$$', '$$mimer$$', '$$html$$', '$$svg$$',
        '$$png$$', '$$jpeg$$', '$$mime$$', '$$defaultMimer$$',
    ]);

    const __cf_out = {};
    for (const __cf_k of Object.getOwnPropertyNames(global)) {
        if (__cf_k.startsWith('_')) continue;
        if (__cf_skip.has(__cf_k)) continue;
        let __cf_v;
        try { __cf_v = global[__cf_k]; } catch (e) { continue; }
        const __cf_t = typeof __cf_v;
        if (__cf_t === 'function') continue;
        if (__cf_t === 'undefined') continue;

        const __cf_info = { name: __cf_k };
        if (__cf_v === null) {
            __cf_info.type = 'null';
            __cf_info.repr = 'null';
        } else if (Array.isArray(__cf_v)) {
            __cf_info.type = 'Array';
            __cf_info.size = __cf_v.length;
            __cf_info.shape = String(__cf_v.length);
            try { __cf_info.repr = JSON.stringify(__cf_v).slice(0, 500); }
            catch (e) { __cf_info.repr = '<unserializable>'; }
        } else if (__cf_t === 'object') {
            __cf_info.type = __cf_v.constructor?.name ?? 'Object';
            try { __cf_info.repr = JSON.stringify(__cf_v).slice(0, 500); }
            catch (e) { __cf_info.repr = String(__cf_v).slice(0, 500); }
        } else {
            __cf_info.type = __cf_t.charAt(0).toUpperCase() + __cf_t.slice(1);
            __cf_info.repr = String(__cf_v).slice(0, 500);
        }
        __cf_out[__cf_k] = __cf_info;
    }
    console.log(JSON.stringify(__cf_out));
})();
"#;

/// Preview of an array variable as a "table" (best effort for JS).
pub fn dataframe_preview_code(var_name: &str) -> String {
    format!(
        r#"
(() => {{
    try {{
        const v = global['{var_name}'];
        if (!Array.isArray(v) || v.length === 0) {{
            console.log('null');
            return;
        }}
        const first = v[0];
        const cols = (typeof first === 'object' && first !== null)
            ? Object.keys(first)
            : ['value'];
        const rows = v.slice(0, 50).map(row =>
            (typeof row === 'object' && row !== null)
                ? row
                : {{ value: row }}
        );
        const dtypes = {{}};
        for (const c of cols) dtypes[c] = typeof (rows[0]?.[c]);
        console.log(JSON.stringify({{
            columns: cols,
            dtypes: dtypes,
            shape: [v.length, cols.length],
            head: rows,
        }}));
    }} catch (e) {{
        console.log('null');
    }}
}})();
"#
    )
}
