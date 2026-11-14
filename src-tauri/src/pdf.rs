use pdfium_render::prelude::*;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::ipc::Response;

/// PDFium can only be bound once per process, so it lives here, shared.
static PDFIUM: OnceLock<Result<Pdfium, String>> = OnceLock::new();

fn pdfium_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("pdfium")
}

fn pdfium() -> Result<&'static Pdfium, String> {
    PDFIUM
        .get_or_init(|| {
            Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&pdfium_dir()))
                .map(Pdfium::new)
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(|e| e.clone())
}

/// Temporary: always opens pdfium/test.pdf. A file picker comes later.
#[tauri::command]
pub fn page_count(path: String) -> Result<u32, String> {
    let run = || -> Result<u32, Box<dyn Error>> {
        let document = pdfium()?.load_pdf_from_file(&path, None)?;
        Ok(document.pages().len() as u32)
    };
    run().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn render_page(path: String, page_index: u16, width: i32) -> Result<Response, String> {
    render(&path, page_index, width)
        .map(Response::new)
        .map_err(|e| e.to_string())
}

/// Returns [width: u32 LE][height: u32 LE][RGBA pixels...]
fn render(path: &str, page_index: u16, width: i32) -> Result<Vec<u8>, Box<dyn Error>> {
    let document = pdfium()?.load_pdf_from_file(path, None)?;
    let page = document.pages().get(page_index.into())?;
    let config = PdfRenderConfig::new().set_target_width(width);
    let image = page.render_with_config(&config)?.as_image()?.to_rgba8();

    let mut out = Vec::with_capacity(8 + image.as_raw().len());
    out.extend_from_slice(&image.width().to_le_bytes());
    out.extend_from_slice(&image.height().to_le_bytes());
    out.extend_from_slice(image.as_raw());
    Ok(out)
}
