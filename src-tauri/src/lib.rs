mod pdf;
mod subtext;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// PDFs the app was launched with; the frontend picks them up once it has started.
struct PendingOpens(Mutex<Vec<String>>);

/// Keeps only arguments that are existing .pdf files, as absolute paths.
fn pdf_paths(args: impl Iterator<Item = String>, base: Option<&std::path::Path>) -> Vec<String> {
    args.filter_map(|a| {
        let raw = std::path::Path::new(&a);
        let full = match base {
            Some(b) => b.join(raw),
            None => std::path::absolute(raw).ok()?,
        };
        let is_pdf = full
            .extension()
            .map(|e| e.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false);
        (is_pdf && full.is_file()).then(|| full.to_string_lossy().into_owned())
    })
    .collect()
}

#[tauri::command]
fn take_pending_opens(state: tauri::State<'_, PendingOpens>) -> Vec<String> {
    match state.0.lock() {
        Ok(mut list) => std::mem::take(&mut *list),
        Err(_) => Vec::new(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first. A second launch hands its arguments to this instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = pdf_paths(argv.into_iter().skip(1), Some(std::path::Path::new(&cwd)));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if !paths.is_empty() {
                let _ = app.emit("open-files", paths);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pdf::DocRegistry::default())
        .setup(|app| {
            // PDFium: prefer the copy bundled with the app. The source-tree fallback
            // only exists in debug builds, so a missing DLL fails visibly in release.
            let bundled = app.path().resource_dir()?.join("pdfium");
            let pdfium_dir = if bundled.join("pdfium.dll").exists() {
                bundled
            } else if cfg!(debug_assertions) {
                std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("pdfium")
            } else {
                bundled
            };
            eprintln!("[pdfium] using {:?}", pdfium_dir);
            pdf::set_pdfium_dir(pdfium_dir);

            let launch_files = pdf_paths(std::env::args().skip(1), None);
            if !launch_files.is_empty() {
                eprintln!("[launch] files: {:?}", launch_files);
            }
            app.manage(PendingOpens(Mutex::new(launch_files)));

            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("bread.db");
            let conn = Connection::open(&db_path)?;
            subtext::init(&conn)?;
            eprintln!("[db] {:?}", db_path);
            app.manage(subtext::SubtextDb(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_opens,
            pdf::open_pdf,
            pdf::close_pdf,
            pdf::render_page,
            pdf::page_sizes,
            pdf::search_pages,
            pdf::page_matches,
            pdf::page_text,
            pdf::document_outline,
            subtext::subtext_list,
            subtext::subtext_add,
            subtext::subtext_delete,
            subtext::file_fingerprint,
            subtext::subtext_adopt,
            subtext::subtext_update,
            subtext::highlight_list,
            subtext::highlight_add,
            subtext::highlight_delete,
            subtext::session_load,
            subtext::session_save
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}