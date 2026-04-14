/// Python code snippets that we run silently on the kernel to get variable info.
/// These are sent as execute_request with silent=true so they don't show up
/// in the notebook outputs or increment the execution counter.
///
/// Returns JSON with all user-defined variables and their basic info.
/// We prefix everything with __cf_ to avoid polluting the user's namespace,
/// and clean up after ourselves.
pub const INSPECT_VARIABLES: &str = r#"
import json as __cf_json

# ipython/jupyter internals we never want to show
__cf_skip = {
    'In', 'Out', 'get_ipython', 'exit', 'quit', 'open',
    '__cf_json', '__cf_skip', '__cf_out', '__cf_n', '__cf_v', '__cf_info',
}

__cf_out = {}
for __cf_n, __cf_v in list(globals().items()):
    if __cf_n.startswith('_'):
        continue
    if __cf_n in __cf_skip:
        continue
    # skip modules, builtins, and ipython magic
    __cf_t = type(__cf_v).__name__
    if __cf_t == 'module':
        continue
    if __cf_t in ('ZMQExitAutocall', 'BuiltinMethodType', 'builtin_function_or_method'):
        continue

    __cf_info = {
        'name': __cf_n,
        'type': __cf_t,
        'module': type(__cf_v).__module__,
    }
    try:
        if hasattr(__cf_v, 'shape'):
            __cf_info['shape'] = str(__cf_v.shape)
        if hasattr(__cf_v, 'dtype'):
            __cf_info['dtype'] = str(__cf_v.dtype)
        if hasattr(__cf_v, '__len__') and not isinstance(__cf_v, str):
            __cf_info['size'] = len(__cf_v)
        __cf_info['repr'] = repr(__cf_v)[:500]
    except Exception:
        __cf_info['repr'] = '<error>'

    __cf_out[__cf_n] = __cf_info

print(__cf_json.dumps(__cf_out))
del __cf_out, __cf_n, __cf_v, __cf_info, __cf_json, __cf_skip, __cf_t
"#;

/// Returns a preview of a DataFrame variable. Takes the variable name as
/// a python format string argument.
pub fn dataframe_preview_code(var_name: &str) -> String {
    // we have to be careful with the variable name to avoid injection,
    // but since this only runs on the user's own kernel it's not really
    // a security issue — they can already run arbitrary code
    format!(
        r#"
import json as __cf_json
__cf_df = globals().get('{var_name}')
if __cf_df is not None and hasattr(__cf_df, 'head'):
    print(__cf_json.dumps({{
        'columns': list(__cf_df.columns),
        'dtypes': {{str(k): str(v) for k, v in __cf_df.dtypes.items()}},
        'shape': list(__cf_df.shape),
        'head': __cf_df.head(50).fillna('NaN').to_dict(orient='records'),
    }}))
else:
    print('null')
del __cf_json
if '__cf_df' in dir(): del __cf_df
"#
    )
}
