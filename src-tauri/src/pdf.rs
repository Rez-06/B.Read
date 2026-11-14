use pdfium_render::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::ipc::Response;
use tauri::State;

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

/// All open PDFs, keyed by a numeric id the frontend holds on to.
#[derive(Default)]
pub struct DocRegistry {
    docs: Mutex<HashMap<u32, PdfDocument<'static>>>,
    next_id: AtomicU32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDoc {
    id: u32,
    page_count: u32,
}

#[tauri::command]
pub fn open_pdf(path: String, registry: State<'_, DocRegistry>) -> Result<OpenedDoc, String> {
    let document = pdfium()?
        .load_pdf_from_file(&path, None)
        .map_err(|e| e.to_string())?;
    let page_count = document.pages().len() as u32;
    let id = registry.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    registry
        .docs
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, document);
    Ok(OpenedDoc { id, page_count })
}

#[tauri::command]
pub fn close_pdf(id: u32, registry: State<'_, DocRegistry>) {
    if let Ok(mut docs) = registry.docs.lock() {
        docs.remove(&id); // dropping the document releases it
    }
}

#[tauri::command]
pub fn render_page(
    id: u32,
    page_index: u16,
    width: i32,
    registry: State<'_, DocRegistry>,
) -> Result<Response, String> {
    render(&registry, id, page_index, width)
        .map(Response::new)
        .map_err(|e| e.to_string())
}

/// Returns [width: u32 LE][height: u32 LE][RGBA pixels...]
/// Returns [width: u32 LE][height: u32 LE][RGBA pixels...]
pub fn render(
    registry: &DocRegistry,
    id: u32,
    page_index: u16,
    width: i32,
) -> Result<Vec<u8>, Box<dyn Error>> {
    let t0 = std::time::Instant::now();
    let docs = registry.docs.lock().map_err(|e| e.to_string())?;
    let document = docs.get(&id).ok_or("document is not open")?;
    let page = document.pages().get(page_index.into())?;
    let t_open = t0.elapsed();

    let config = PdfRenderConfig::new().set_target_width(width);
    let bitmap = page.render_with_config(&config)?;
    let t_render = t0.elapsed();

    let image = bitmap.as_image()?.to_rgba8();
    let t_convert = t0.elapsed();

    let mut out = Vec::with_capacity(8 + image.as_raw().len());
    out.extend_from_slice(&image.width().to_le_bytes());
    out.extend_from_slice(&image.height().to_le_bytes());
    out.extend_from_slice(image.as_raw());

    eprintln!(
        "[render] page {} | get page {:?} | pdfium render {:?} | convert {:?} | total {:?} | {} KB",
        page_index,
        t_open,
        t_render - t_open,
        t_convert - t_render,
        t0.elapsed(),
        out.len() / 1024
    );
    Ok(out)
}