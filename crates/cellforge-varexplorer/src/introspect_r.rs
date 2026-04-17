/// R code snippets that we run silently on the kernel to get variable info.
/// These are sent as execute_request with silent=true so they don't show up
/// in the notebook outputs or increment the execution counter.
///
/// Returns JSON with all user-defined variables and their basic info,
/// matching the same schema as the Python introspection in `introspect.rs`.
/// We wrap everything in `local({...})` to avoid polluting the user's namespace.
pub const INSPECT_VARIABLES: &str = r#"
local({
    vars <- ls(envir = .GlobalEnv)
    result <- list()
    for (n in vars) {
        if (startsWith(n, ".") || startsWith(n, "__")) next
        v <- get(n, envir = .GlobalEnv)
        cls <- class(v)[1]
        # skip functions and environments
        if (cls %in% c("function", "environment")) next

        sz <- tryCatch(as.numeric(object.size(v)), error = function(e) NA)
        shp <- tryCatch({
            d <- dim(v)
            if (!is.null(d)) {
                paste(d, collapse = ", ")
            } else {
                paste(length(v))
            }
        }, error = function(e) NA)
        rp <- tryCatch({
            s <- paste(capture.output(str(v, max.level = 1, give.attr = FALSE)), collapse = "\n")
            if (nchar(s) > 500) s <- paste0(substr(s, 1, 500), "...")
            s
        }, error = function(e) "<error>")
        mod <- tryCatch({
            pkg <- environmentName(environment(v))
            if (nchar(pkg) == 0) NA else pkg
        }, error = function(e) NA)

        info <- list(
            name = n,
            type = cls,
            shape = shp,
            size = sz,
            repr = rp,
            module = mod
        )
        # value_json / size_bytes for cross-kernel sharing — only for
        # simple transferable types (scalars and short vectors of primitives)
        if (cls %in% c("numeric", "integer", "double", "character", "logical") &&
            length(v) <= 1000 &&
            requireNamespace("jsonlite", quietly = TRUE)) {
            vj <- tryCatch(jsonlite::toJSON(v, auto_unbox = length(v) == 1), error = function(e) NULL)
            if (!is.null(vj)) {
                info$value_json <- as.character(vj)
                info$size_bytes <- nchar(info$value_json)
            }
        }
        result[[n]] <- info
    }
    if (requireNamespace("jsonlite", quietly = TRUE)) {
        cat(jsonlite::toJSON(result, auto_unbox = TRUE, null = "null", na = "null"))
    } else {
        # minimal fallback without jsonlite
        cat("{}")
    }
})
"#;

/// Returns R code for a DataFrame (data.frame / tibble) preview.
/// The variable name is substituted into the code.
pub fn dataframe_preview_code(var_name: &str) -> String {
    format!(
        r#"
local({{
    if (!exists("{var_name}", envir = .GlobalEnv)) {{
        cat("null")
    }} else {{
        .cf_df <- get("{var_name}", envir = .GlobalEnv)
        if (is.data.frame(.cf_df)) {{
            .cf_cols <- colnames(.cf_df)
            .cf_dtypes <- sapply(.cf_cols, function(c) class(.cf_df[[c]])[1])
            names(.cf_dtypes) <- .cf_cols
            .cf_head <- head(.cf_df, 50)
            .cf_shape <- dim(.cf_df)
            .cf_result <- list(
                columns = .cf_cols,
                dtypes = as.list(.cf_dtypes),
                shape = .cf_shape,
                head = .cf_head
            )
            if (requireNamespace("jsonlite", quietly = TRUE)) {{
                cat(jsonlite::toJSON(.cf_result, auto_unbox = TRUE, dataframe = "rows", null = "null", na = "string"))
            }} else {{
                cat("null")
            }}
        }} else {{
            cat("null")
        }}
    }}
}})
"#
    )
}
