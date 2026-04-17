/// Octave variable introspection. Uses `whos` to list workspace variables
/// and builds a JSON object matching the Python introspection output shape:
///   { "name": { "name": "x", "type": "double", "shape": "3x3", "repr": "..." } }
///
/// Octave doesn't have a JSON library by default, so we assemble JSON with
/// printf. User-defined names that start with `__cf_` are filtered out.
pub const INSPECT_VARIABLES: &str = r#"
__cf_vars = whos;
__cf_first = true;
printf("{");
for __cf_i = 1:length(__cf_vars)
    __cf_v = __cf_vars(__cf_i);
    if strncmp(__cf_v.name, "__cf_", 5)
        continue;
    endif
    if !__cf_first
        printf(",");
    endif
    __cf_first = false;
    __cf_shape = sprintf("%dx", __cf_v.size);
    __cf_shape = __cf_shape(1:end-1);
    __cf_repr = "";
    try
        __cf_val = evalin("base", __cf_v.name);
        if ischar(__cf_val)
            __cf_repr = __cf_val(1:min(500, length(__cf_val)));
        elseif isnumeric(__cf_val) && numel(__cf_val) <= 10
            __cf_repr = mat2str(__cf_val);
        else
            __cf_repr = sprintf("<%s %s>", __cf_v.class, __cf_shape);
        endif
    catch
        __cf_repr = "<error>";
    end_try_catch
    __cf_repr = strrep(__cf_repr, "\\", "\\\\");
    __cf_repr = strrep(__cf_repr, "\"", "\\\"");
    __cf_repr = strrep(__cf_repr, "\n", "\\n");
    printf("\"%s\":{\"name\":\"%s\",\"type\":\"%s\",\"shape\":\"%s\",\"size\":%d,\"repr\":\"%s\"}",
        __cf_v.name, __cf_v.name, __cf_v.class, __cf_shape, __cf_v.bytes, __cf_repr);
endfor
printf("}\n");
clear __cf_vars __cf_first __cf_i __cf_v __cf_shape __cf_repr __cf_val
"#;

/// Preview of a matrix/dataframe-like variable. Octave doesn't have
/// dataframes; we return column vectors or matrix rows.
pub fn dataframe_preview_code(var_name: &str) -> String {
    format!(
        r#"
try
    __cf_val = evalin("base", "{var_name}");
    if isnumeric(__cf_val) && ndims(__cf_val) == 2
        [__cf_rows, __cf_cols] = size(__cf_val);
        __cf_nrows = min(50, __cf_rows);
        printf("{{");
        printf("\"columns\":[");
        for __cf_c = 1:__cf_cols
            if __cf_c > 1
                printf(",");
            endif
            printf("\"col%d\"", __cf_c);
        endfor
        printf("],");
        printf("\"dtypes\":{{");
        for __cf_c = 1:__cf_cols
            if __cf_c > 1
                printf(",");
            endif
            printf("\"col%d\":\"%s\"", __cf_c, class(__cf_val));
        endfor
        printf("}},");
        printf("\"shape\":[%d,%d],", __cf_rows, __cf_cols);
        printf("\"head\":[");
        for __cf_r = 1:__cf_nrows
            if __cf_r > 1
                printf(",");
            endif
            printf("{{");
            for __cf_c = 1:__cf_cols
                if __cf_c > 1
                    printf(",");
                endif
                printf("\"col%d\":%g", __cf_c, __cf_val(__cf_r, __cf_c));
            endfor
            printf("}}");
        endfor
        printf("]}}\n");
    else
        printf("null\n");
    endif
    clear __cf_val __cf_rows __cf_cols __cf_nrows __cf_c __cf_r
catch
    printf("null\n");
end_try_catch
"#
    )
}
