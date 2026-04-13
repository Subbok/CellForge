/// Python code snippets that we run silently on the kernel to get variable info.
/// These are sent as execute_request with silent=true so they don't show up
/// in the notebook outputs or increment the execution counter.
///
/// Returns JSON with all user-defined variables and their basic info.
/// We prefix everything with __bliss_ to avoid polluting the user's namespace,
/// and clean up after ourselves.
pub const INSPECT_VARIABLES: &str = r#"
import json as __bliss_json

# ipython/jupyter internals we never want to show
__bliss_skip = {
    'In', 'Out', 'get_ipython', 'exit', 'quit', 'open',
    '__bliss_json', '__bliss_skip', '__bliss_out', '__bliss_n', '__bliss_v', '__bliss_info',
}

__bliss_out = {}
for __bliss_n, __bliss_v in list(globals().items()):
    if __bliss_n.startswith('_'):
        continue
    if __bliss_n in __bliss_skip:
        continue
    # skip modules, builtins, and ipython magic
    __bliss_t = type(__bliss_v).__name__
    if __bliss_t == 'module':
        continue
    if __bliss_t in ('ZMQExitAutocall', 'BuiltinMethodType', 'builtin_function_or_method'):
        continue

    __bliss_info = {
        'name': __bliss_n,
        'type': __bliss_t,
        'module': type(__bliss_v).__module__,
    }
    try:
        if hasattr(__bliss_v, 'shape'):
            __bliss_info['shape'] = str(__bliss_v.shape)
        if hasattr(__bliss_v, 'dtype'):
            __bliss_info['dtype'] = str(__bliss_v.dtype)
        if hasattr(__bliss_v, '__len__') and not isinstance(__bliss_v, str):
            __bliss_info['size'] = len(__bliss_v)
        __bliss_info['repr'] = repr(__bliss_v)[:500]
    except Exception:
        __bliss_info['repr'] = '<error>'

    __bliss_out[__bliss_n] = __bliss_info

print(__bliss_json.dumps(__bliss_out))
del __bliss_out, __bliss_n, __bliss_v, __bliss_info, __bliss_json, __bliss_skip, __bliss_t
"#;

/// Returns a preview of a DataFrame variable. Takes the variable name as
/// a python format string argument.
pub fn dataframe_preview_code(var_name: &str) -> String {
    // we have to be careful with the variable name to avoid injection,
    // but since this only runs on the user's own kernel it's not really
    // a security issue — they can already run arbitrary code
    format!(
        r#"
import json as __bliss_json
__bliss_df = globals().get('{var_name}')
if __bliss_df is not None and hasattr(__bliss_df, 'head'):
    print(__bliss_json.dumps({{
        'columns': list(__bliss_df.columns),
        'dtypes': {{str(k): str(v) for k, v in __bliss_df.dtypes.items()}},
        'shape': list(__bliss_df.shape),
        'head': __bliss_df.head(50).fillna('NaN').to_dict(orient='records'),
    }}))
else:
    print('null')
del __bliss_json
if '__bliss_df' in dir(): del __bliss_df
"#
    )
}
