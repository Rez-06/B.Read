mod pdf;
mod subtext;

use rusqlite::Connection;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pdf::DocRegistry::default())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("bread.db");
            let conn = Connection::open(&db_path)?;
            subtext::init(&conn)?;
            eprintln!("[db] {:?}", db_path);
            app.manage(subtext::SubtextDb(std::sync::Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            subtext::highlight_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}