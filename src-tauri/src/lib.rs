mod pdf;

use tauri::http::Response;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pdf::DocRegistry::default())
        // Experiment: serve page pixels over http://pdfpage.localhost/<doc>/<page>/<width>
        .register_asynchronous_uri_scheme_protocol("pdfpage", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            std::thread::spawn(move || {
                let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
                let result = (|| -> Result<Vec<u8>, String> {
                    if parts.len() != 3 {
                        return Err("expected /<doc>/<page>/<width>".into());
                    }
                    let id: u32 = parts[0].parse().map_err(|_| "bad doc id")?;
                    let page: u16 = parts[1].parse().map_err(|_| "bad page")?;
                    let width: i32 = parts[2].parse().map_err(|_| "bad width")?;
                    let registry = app.state::<pdf::DocRegistry>();
                    pdf::render(&registry, id, page, width).map_err(|e| e.to_string())
                })();
                let response = match result {
                    Ok(bytes) => Response::builder()
                        .status(200)
                        .header("Content-Type", "application/octet-stream")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(bytes)
                        .unwrap(),
                    Err(msg) => Response::builder()
                        .status(500)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(msg.into_bytes())
                        .unwrap(),
                };
                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![
            pdf::open_pdf,
            pdf::close_pdf,
            pdf::render_page
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}