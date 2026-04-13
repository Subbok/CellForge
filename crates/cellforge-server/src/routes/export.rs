use axum::Json;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use cellforge_export::{compile, convert, templates};
use cellforge_notebook::format::Notebook;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct ExportReq {
    notebook: Notebook,
    template: Option<String>,
    #[serde(default)]
    variables: std::collections::HashMap<String, String>,
}

pub async fn export_pdf(Json(req): Json<ExportReq>) -> Result<Response, StatusCode> {
    templates::ensure_default_template();

    let tmpl_name = req.template.as_deref().unwrap_or("default");
    let tmpl_content = templates::read_template(tmpl_name).ok();
    let tmpl_assets = templates::template_assets(tmpl_name);

    let (mut typ_source, notebook_images) =
        convert::notebook_to_typst(&req.notebook, tmpl_content.as_deref());

    // replace variables in template config block
    // matches: key: "value" with any amount of whitespace
    for (key, value) in &req.variables {
        if value.is_empty() {
            continue;
        }

        // find `key:` followed by spaces then `"old_value"`
        let needle = format!("{key}:");
        if let Some(key_pos) = typ_source.find(&needle) {
            let after_key = &typ_source[key_pos + needle.len()..];
            // skip whitespace to find the opening quote
            if let Some(quote_offset) = after_key.find('"') {
                let after_quote = &after_key[quote_offset + 1..];
                if let Some(end_quote) = after_quote.find('"') {
                    let start = key_pos + needle.len() + quote_offset + 1;
                    let end = start + end_quote;
                    typ_source = format!("{}{value}{}", &typ_source[..start], &typ_source[end..]);
                }
            }
        }

        // also replace {{key}} placeholders
        typ_source = typ_source.replace(&format!("{{{{{key}}}}}"), value);
    }

    // auto-fill {{today}} if not already replaced by a variable
    let today = chrono::Local::now().format("%d.%m.%Y").to_string();
    typ_source = typ_source.replace("{{today}}", &today);

    // dump for debugging
    let _ = std::fs::write("/tmp/cellforge_debug.typ", &typ_source);

    // convert template assets to the format compile expects
    let assets: std::collections::HashMap<String, Vec<u8>> = tmpl_assets;

    let pdf = tokio::task::spawn_blocking(move || {
        compile::compile_to_pdf(&typ_source, &notebook_images, &assets)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|e| {
        tracing::error!("pdf export failed: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok((
        [
            (header::CONTENT_TYPE, "application/pdf"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"notebook.pdf\"",
            ),
        ],
        pdf,
    )
        .into_response())
}

#[derive(Serialize)]
pub struct TemplateEntry {
    pub name: String,
    pub variables: Vec<templates::TemplateVariable>,
    pub assets: Vec<String>,
}

pub async fn list_templates() -> Json<Vec<TemplateEntry>> {
    templates::ensure_default_template();
    let list = templates::list_templates()
        .into_iter()
        .map(|t| TemplateEntry {
            name: t.name,
            variables: t.variables,
            assets: t.assets,
        })
        .collect();
    Json(list)
}

pub async fn upload_template(
    mut multipart: axum_extra::extract::Multipart,
) -> Result<StatusCode, StatusCode> {
    let mut name = String::new();
    let mut typ_content = String::new();
    let mut assets: Vec<(String, Vec<u8>)> = vec![];

    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().unwrap_or("").to_string();
        let file_name = field.file_name().unwrap_or("").to_string();

        match field_name.as_str() {
            "name" => {
                name = field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?;
            }
            "template" => {
                typ_content = field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?;
            }
            _ if !file_name.is_empty() => {
                let data = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;
                assets.push((file_name, data.to_vec()));
            }
            _ => {}
        }
    }

    if name.is_empty() || typ_content.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    templates::save_template(&name, &typ_content).map_err(|e| {
        tracing::error!("save template: {e}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    for (filename, data) in assets {
        templates::save_template_asset(&name, &filename, &data).map_err(|e| {
            tracing::error!("save asset {filename}: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }

    Ok(StatusCode::OK)
}

/// Upload additional assets to an existing template (images, fonts, etc.)
pub async fn upload_template_assets(
    axum::extract::Path(name): axum::extract::Path<String>,
    mut multipart: axum_extra::extract::Multipart,
) -> Result<StatusCode, StatusCode> {
    // verify template exists
    let dir = templates::templates_dir().join(&name);
    if !dir.join("template.typ").exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut count = 0;
    while let Ok(Some(field)) = multipart.next_field().await {
        let file_name = field.file_name().unwrap_or("").to_string();
        if file_name.is_empty() {
            continue;
        }
        let data = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;
        templates::save_template_asset(&name, &file_name, &data).map_err(|e| {
            tracing::error!("save asset {file_name}: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
        count += 1;
    }

    if count == 0 {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(StatusCode::OK)
}

pub async fn delete_template(
    axum::extract::Path(name): axum::extract::Path<String>,
) -> Result<StatusCode, StatusCode> {
    templates::delete_template(&name).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(StatusCode::NO_CONTENT)
}
