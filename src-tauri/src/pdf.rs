use pdfium_render::prelude::*;
use std::path::Path;
use tauri::ipc::Response;

/// Temporary: always opens pdfium/test.pdf. A file picker comes later.
#[tauri::command]
pub fn render_page(page_index: u16, width: i32) -> Result<Response, String> {
    render(page_index, width)
        .map(Response::new)
        .map_err(|e| e.to_string())
}

/// Returns [width: u32 LE][height: u32 LE][RGBA pixels...]
fn render(page_index: u16, width: i32) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("pdfium");
    let pdfium = Pdfium::new(Pdfium::bind_to_library(
        Pdfium::pdfium_platform_library_name_at_path(&dir),
    )?);
    let document = pdfium.load_pdf_from_file(&dir.join("test.pdf"), None)?;
    let page = document.pages().get(page_index.into())?;
    let config = PdfRenderConfig::new().set_target_width(width);
    let image = page.render_with_config(&config)?.as_image()?.to_rgba8();

    let mut out = Vec::with_capacity(8 + image.as_raw().len());
    out.extend_from_slice(&image.width().to_le_bytes());
    out.extend_from_slice(&image.height().to_le_bytes());
    out.extend_from_slice(image.as_raw());
    Ok(out)
}