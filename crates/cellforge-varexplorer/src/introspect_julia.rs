/// Julia code snippets that we run silently on the kernel to get variable info.
/// These are sent as execute_request with silent=true so they don't show up
/// in the notebook outputs or increment the execution counter.
///
/// Returns JSON with all user-defined variables and their basic info,
/// matching the same schema as the Python introspection in `introspect.rs`.
/// We wrap everything in a `let ... end` block to avoid polluting the namespace.
pub const INSPECT_VARIABLES: &str = r#"
let
    _cf_result = Dict{String, Any}[]
    for _cf_n in names(Main; all=false, imported=false)
        _cf_n in (:ans, :include, :eval, :Core, :Base, :Main, :InteractiveUtils) && continue
        startswith(String(_cf_n), "_") && continue
        _cf_v = try; getfield(Main, _cf_n); catch; continue; end
        _cf_t = typeof(_cf_v)
        # skip modules, functions, and types
        _cf_t <: Module && continue
        _cf_t <: Function && continue
        _cf_t <: Type && continue

        _cf_info = Dict{String, Any}(
            "name" => String(_cf_n),
            "type" => string(_cf_t),
            "module" => string(parentmodule(_cf_t)),
        )

        try
            if hasmethod(size, Tuple{typeof(_cf_v)})
                _cf_s = size(_cf_v)
                _cf_info["shape"] = join(string.(_cf_s), ", ")
            elseif applicable(length, _cf_v)
                _cf_info["shape"] = string(length(_cf_v))
            end
        catch; end

        try
            _cf_info["size"] = Base.summarysize(_cf_v)
        catch; end

        try
            _cf_r = repr(_cf_v)
            if length(_cf_r) > 500
                _cf_r = _cf_r[1:min(500, lastindex(_cf_r))] * "..."
            end
            _cf_info["repr"] = _cf_r
        catch
            _cf_info["repr"] = "<error>"
        end

        push!(_cf_result, _cf_info)
    end

    # Build a dict keyed by variable name (matching Python schema)
    _cf_out = Dict{String, Any}()
    for _cf_item in _cf_result
        _cf_out[_cf_item["name"]] = _cf_item
    end

    if @isdefined(JSON)
        print(JSON.json(_cf_out))
    else
        try
            using JSON
            print(JSON.json(_cf_out))
        catch
            print("{}")
        end
    end
end
"#;

/// Returns Julia code for a DataFrame preview.
/// The variable name is substituted into the code.
pub fn dataframe_preview_code(var_name: &str) -> String {
    format!(
        r#"
let
    if !isdefined(Main, :{var_name})
        print("null")
    else
        _cf_df = getfield(Main, :{var_name})
        if applicable(names, _cf_df) && applicable(size, _cf_df) && ndims(_cf_df) == 2
            try
                _cf_cols = string.(names(_cf_df))
                _cf_dtypes = Dict(string(c) => string(eltype(getproperty(_cf_df, Symbol(c)))) for c in _cf_cols)
                _cf_shape = collect(size(_cf_df))
                _cf_nrows = min(50, size(_cf_df, 1))
                _cf_head = [Dict(string(c) => let v = _cf_df[i, Symbol(c)]; ismissing(v) ? "NaN" : v end for c in _cf_cols) for i in 1:_cf_nrows]
                _cf_result = Dict(
                    "columns" => _cf_cols,
                    "dtypes" => _cf_dtypes,
                    "shape" => _cf_shape,
                    "head" => _cf_head,
                )
                if @isdefined(JSON)
                    print(JSON.json(_cf_result))
                else
                    using JSON
                    print(JSON.json(_cf_result))
                end
            catch
                print("null")
            end
        else
            print("null")
        end
    end
end
"#
    )
}
