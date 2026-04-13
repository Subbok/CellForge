/// Julia code snippets that we run silently on the kernel to get variable info.
/// These are sent as execute_request with silent=true so they don't show up
/// in the notebook outputs or increment the execution counter.
///
/// Returns JSON with all user-defined variables and their basic info,
/// matching the same schema as the Python introspection in `introspect.rs`.
/// We wrap everything in a `let ... end` block to avoid polluting the namespace.
pub const INSPECT_VARIABLES: &str = r#"
let
    _bliss_result = Dict{String, Any}[]
    for _bliss_n in names(Main; all=false, imported=false)
        _bliss_n in (:ans, :include, :eval, :Core, :Base, :Main, :InteractiveUtils) && continue
        startswith(String(_bliss_n), "_") && continue
        _bliss_v = try; getfield(Main, _bliss_n); catch; continue; end
        _bliss_t = typeof(_bliss_v)
        # skip modules, functions, and types
        _bliss_t <: Module && continue
        _bliss_t <: Function && continue
        _bliss_t <: Type && continue

        _bliss_info = Dict{String, Any}(
            "name" => String(_bliss_n),
            "type" => string(_bliss_t),
            "module" => string(parentmodule(_bliss_t)),
        )

        try
            if hasmethod(size, Tuple{typeof(_bliss_v)})
                _bliss_s = size(_bliss_v)
                _bliss_info["shape"] = join(string.(_bliss_s), ", ")
            elseif applicable(length, _bliss_v)
                _bliss_info["shape"] = string(length(_bliss_v))
            end
        catch; end

        try
            _bliss_info["size"] = Base.summarysize(_bliss_v)
        catch; end

        try
            _bliss_r = repr(_bliss_v)
            if length(_bliss_r) > 500
                _bliss_r = _bliss_r[1:min(500, lastindex(_bliss_r))] * "..."
            end
            _bliss_info["repr"] = _bliss_r
        catch
            _bliss_info["repr"] = "<error>"
        end

        push!(_bliss_result, _bliss_info)
    end

    # Build a dict keyed by variable name (matching Python schema)
    _bliss_out = Dict{String, Any}()
    for _bliss_item in _bliss_result
        _bliss_out[_bliss_item["name"]] = _bliss_item
    end

    if @isdefined(JSON)
        print(JSON.json(_bliss_out))
    else
        try
            using JSON
            print(JSON.json(_bliss_out))
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
        _bliss_df = getfield(Main, :{var_name})
        if applicable(names, _bliss_df) && applicable(size, _bliss_df) && ndims(_bliss_df) == 2
            try
                _bliss_cols = string.(names(_bliss_df))
                _bliss_dtypes = Dict(string(c) => string(eltype(getproperty(_bliss_df, Symbol(c)))) for c in _bliss_cols)
                _bliss_shape = collect(size(_bliss_df))
                _bliss_nrows = min(50, size(_bliss_df, 1))
                _bliss_head = [Dict(string(c) => let v = _bliss_df[i, Symbol(c)]; ismissing(v) ? "NaN" : v end for c in _bliss_cols) for i in 1:_bliss_nrows]
                _bliss_result = Dict(
                    "columns" => _bliss_cols,
                    "dtypes" => _bliss_dtypes,
                    "shape" => _bliss_shape,
                    "head" => _bliss_head,
                )
                if @isdefined(JSON)
                    print(JSON.json(_bliss_result))
                else
                    using JSON
                    print(JSON.json(_bliss_result))
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
