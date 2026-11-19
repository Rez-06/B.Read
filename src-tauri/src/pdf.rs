use pdfium_render::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::ipc::Response;
use tauri::State;

/// After this many page touches (renders + size lookups) the document is reopened,
/// because PDFium keeps roughly 1.5 MB per touched page until the document is dropped.
/// Measured on one image-heavy 101 MB PDF; tune with other documents.
const RECYCLE_AFTER: u32 = 60;

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

struct OpenPdf {
    path: String,
    document: PdfDocument<'static>,
    /// Pages touched since the document was last (re)opened.
    touched: u32,
}

/// Records page touches and reopens the document when too many have piled up.
fn touch(entry: &mut OpenPdf, pages: u32) -> Result<(), String> {
    entry.touched += pages;
    if entry.touched >= RECYCLE_AFTER {
        let t0 = std::time::Instant::now();
        let fresh = pdfium()?
            .load_pdf_from_file(&entry.path, None)
            .map_err(|e| e.to_string())?;
        entry.document = fresh; // the old document is dropped here
        entry.touched = 0;
        eprintln!("[recycle] reopened in {:?}", t0.elapsed());
    }
    Ok(())
}

/// All open PDFs, keyed by a numeric id the frontend holds on to.
#[derive(Default)]
pub struct DocRegistry {
    docs: Mutex<HashMap<u32, OpenPdf>>,
    next_id: AtomicU32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDoc {
    id: u32,
    page_count: u32,
    /// [width, height] of page 1 in PDF points (1/72 inch)
    first_page_size: [f32; 2],
}

#[tauri::command]
pub fn open_pdf(path: String, registry: State<'_, DocRegistry>) -> Result<OpenedDoc, String> {
    let t0 = std::time::Instant::now();
    let document = pdfium()?
        .load_pdf_from_file(&path, None)
        .map_err(|e| e.to_string())?;
    let t_load = t0.elapsed();
    let (page_count, first_page_size) = {
        let pages = document.pages();
        let count = pages.len() as u32;
        if count == 0 {
            return Err("this PDF has no pages".into());
        }
        let r = pages.page_size(0).map_err(|e| e.to_string())?;
        (count, [r.width().value, r.height().value])
    };
    eprintln!(
        "[open] {} pages | load {:?} | first page size {:?}",
        page_count,
        t_load,
        t0.elapsed() - t_load
    );
    let id = registry.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    registry
        .docs
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, OpenPdf { path, document, touched: 1 });
    Ok(OpenedDoc { id, page_count, first_page_size })
}

#[tauri::command]
pub fn close_pdf(id: u32, registry: State<'_, DocRegistry>) {
    if let Ok(mut docs) = registry.docs.lock() {
        docs.remove(&id); // dropping the document releases it
    }
}

/// Sizes (in PDF points) for pages start..start+count, clipped to the page count.
#[tauri::command]
pub fn page_sizes(
    id: u32,
    start: u32,
    count: u32,
    registry: State<'_, DocRegistry>,
) -> Result<Vec<[f32; 2]>, String> {
    let mut docs = registry.docs.lock().map_err(|e| e.to_string())?;
    let entry = docs.get_mut(&id).ok_or("document is not open")?;
    let out = {
        let pages = entry.document.pages();
        let end = (start + count).min(pages.len() as u32);
        let mut out = Vec::new();
        for i in start..end {
            let r = pages.page_size(i as _).map_err(|e| e.to_string())?;
            out.push([r.width().value, r.height().value]);
        }
        out
    };
    touch(entry, out.len() as u32)?;
    Ok(out)
}

/// Pages with matches for `query` among pages start..start+count: [(page index, match count)].
#[tauri::command]
pub fn search_pages(
    id: u32,
    query: String,
    start: u32,
    count: u32,
    registry: State<'_, DocRegistry>,
) -> Result<Vec<[u32; 2]>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let mut docs = registry.docs.lock().map_err(|e| e.to_string())?;
    let entry = docs.get_mut(&id).ok_or("document is not open")?;
    let (hits, scanned) = {
        let pages = entry.document.pages();
        let end = (start + count).min(pages.len() as u32);
        let options = PdfSearchOptions::new();
        let mut hits = Vec::new();
        for i in start..end {
            let page = pages.get(i as _).map_err(|e| e.to_string())?;
            let text = page.text().map_err(|e| e.to_string())?;
            let search = text.search(&query, &options).map_err(|e| e.to_string())?;
            let n = search.iter(PdfSearchDirection::SearchForward).count() as u32;
            if n > 0 {
                hits.push([i, n]);
            }
        }
        (hits, end.saturating_sub(start))
    };
    touch(entry, scanned)?;
    Ok(hits)
}

/// Match rectangles on one page as [left, top, width, height] in PDF points,
/// measured from the page's top-left corner.
#[tauri::command]
pub fn page_matches(
    id: u32,
    page_index: u32,
    query: String,
    registry: State<'_, DocRegistry>,
) -> Result<Vec<[f32; 4]>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let mut docs = registry.docs.lock().map_err(|e| e.to_string())?;
    let entry = docs.get_mut(&id).ok_or("document is not open")?;
    let rects = {
        let pages = entry.document.pages();
        let page = pages.get(page_index as _).map_err(|e| e.to_string())?;
        let page_height = page.height().value;
        let text = page.text().map_err(|e| e.to_string())?;
        let options = PdfSearchOptions::new();
        let search = text.search(&query, &options).map_err(|e| e.to_string())?;
        let mut rects: Vec<[f32; 4]> = Vec::new();
        for segments in search.iter(PdfSearchDirection::SearchForward) {
            for segment in segments.iter() {
                let b = segment.bounds();
                rects.push([
                    b.left().value,
                    page_height - b.top().value,
                    b.width().value,
                    b.height().value,
                ]);
            }
        }
        rects
    };
    touch(entry, 1)?;
    Ok(rects)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSegment {
    text: String,
    /// Rectangle in PDF points, measured from the page's top-left corner.
    left: f32,
    top: f32,
    width: f32,
    height: f32,
}

/// All text segments on one page, for the selectable text layer.
#[tauri::command]
pub fn page_text(
    id: u32,
    page_index: u32,
    registry: State<'_, DocRegistry>,
) -> Result<Vec<TextSegment>, String> {
    let mut docs = registry.docs.lock().map_err(|e| e.to_string())?;
    let entry = docs.get_mut(&id).ok_or("document is not open")?;
    let out = {
        let pages = entry.document.pages();
        let page = pages.get(page_index as _).map_err(|e| e.to_string())?;
        let page_height = page.height().value;
        let text = page.text().map_err(|e| e.to_string())?;
        let segments = text.segments();
        let mut out: Vec<TextSegment> = Vec::new();
        for segment in segments.iter() {
            let s = segment.text();
            if s.trim().is_empty() {
                continue;
            }
            let b = segment.bounds();
            out.push(TextSegment {
                text: s,
                left: b.left().value,
                top: page_height - b.top().value,
                width: b.width().value,
                height: b.height().value,
            });
        }
        out
    };
    touch(entry, 1)?;
    Ok(out)
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
pub fn render(
    registry: &DocRegistry,
    id: u32,
    page_index: u16,
    width: i32,
) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut docs = registry.docs.lock().map_err(|e| e.to_string())?;
    let entry = docs.get_mut(&id).ok_or("document is not open")?;
    let out = {
        let page = entry.document.pages().get(page_index.into())?;
        let config = PdfRenderConfig::new().set_target_width(width);
        let image = page.render_with_config(&config)?.as_image()?.to_rgba8();

        let mut out = Vec::with_capacity(8 + image.as_raw().len());
        out.extend_from_slice(&image.width().to_le_bytes());
        out.extend_from_slice(&image.height().to_le_bytes());
        out.extend_from_slice(image.as_raw());
        out
    };
    touch(entry, 1)?;
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineItem {
    title: String,
    /// 0-based page index, if the bookmark points at a page
    page: Option<u32>,
    depth: u32,
}

fn walk_outline(node: Option<PdfBookmark<'_>>, depth: u32, out: &mut Vec<OutlineItem>) {
    let mut node = node;
    while let Some(bookmark) = node {
        // Hard cap so a malformed or looping outline can't run forever.
        if out.len() >= 5000 {
            return;
        }
        let title = bookmark.title().unwrap_or_default();
        let page = bookmark
            .destination()
            .and_then(|d| d.page_index().ok())
            .map(|p| p as u32);
        out.push(OutlineItem { title, page, depth });
        if depth < 12 {
            walk_outline(bookmark.first_child(), depth + 1, out);
        }
        node = bookmark.next_sibling();
    }
}

/// The document's bookmark tree, flattened in reading order with nesting depth.
#[tauri::command]
pub fn document_outline(
    id: u32,
    registry: State<'_, DocRegistry>,
) -> Result<Vec<OutlineItem>, String> {
    let docs = registry.docs.lock().map_err(|e| e.to_string())?;
    let entry = docs.get(&id).ok_or("document is not open")?;
    let mut out = Vec::new();
    walk_outline(entry.document.bookmarks().root(), 0, &mut out);
    Ok(out)
}