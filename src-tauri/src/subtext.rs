use rusqlite::{params, Connection};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

pub struct SubtextDb(pub Mutex<Connection>);

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS subtext (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_key TEXT NOT NULL,
            kind TEXT NOT NULL,
            page INTEGER NOT NULL,
            seconds INTEGER,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS subtext_doc ON subtext(doc_key);
        CREATE TABLE IF NOT EXISTS highlights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_key TEXT NOT NULL,
            page INTEGER NOT NULL,
            rects TEXT NOT NULL,
            color TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS highlights_doc ON highlights(doc_key);",
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: i64,
    kind: String,
    /// 1-based page number
    page: i64,
    seconds: Option<i64>,
    body: String,
}

#[tauri::command]
pub fn subtext_list(doc_key: String, db: State<'_, SubtextDb>) -> Result<Vec<Entry>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, page, seconds, body FROM subtext
             WHERE doc_key = ?1
             ORDER BY (seconds IS NULL), seconds, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![doc_key], |r| {
            Ok(Entry {
                id: r.get(0)?,
                kind: r.get(1)?,
                page: r.get(2)?,
                seconds: r.get(3)?,
                body: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let out = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string());
    out
}

#[tauri::command]
pub fn subtext_add(
    doc_key: String,
    kind: String,
    page: i64,
    seconds: Option<i64>,
    body: String,
    db: State<'_, SubtextDb>,
) -> Result<(), String> {
    if kind != "transcript" && kind != "note" {
        return Err("unknown entry kind".into());
    }
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("entry is empty".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO subtext (doc_key, kind, page, seconds, body) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![doc_key, kind, page, seconds, body],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn subtext_delete(id: i64, db: State<'_, SubtextDb>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM subtext WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// SHA-256 of the file's contents, computed off the UI thread.
#[tauri::command]
pub async fn file_fingerprint(path: String) -> Result<String, String> {
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        use sha2::{Digest, Sha256};
        use std::io::Read;
        let t0 = std::time::Instant::now();
        let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = file.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        eprintln!("[fingerprint] {:?} hashed in {:?}", path, t0.elapsed());
               let digest = hasher.finalize();
        let bytes: &[u8] = digest.as_ref();
        Ok(format!(
            "sha256:{}",
            bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
        ))
    })
    .await
    .map_err(|e| e.to_string())?;
    result
}

/// One-time migration: entries saved under the file's path move to its content fingerprint.
#[tauri::command]
pub fn subtext_adopt(
    path: String,
    fingerprint: String,
    db: State<'_, SubtextDb>,
) -> Result<u64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let n = conn
        .execute(
            "UPDATE subtext SET doc_key = ?1 WHERE doc_key = ?2",
            params![fingerprint, path],
        )
        .map_err(|e| e.to_string())?;
    if n > 0 {
        eprintln!("[subtext] adopted {n} entries for {path:?}");
    }
    Ok(n as u64)
}
#[tauri::command]
pub fn subtext_update(
    id: i64,
    page: i64,
    seconds: Option<i64>,
    body: String,
    db: State<'_, SubtextDb>,
) -> Result<(), String> {
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("entry is empty".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE subtext SET page = ?1, seconds = ?2, body = ?3 WHERE id = ?4",
            params![page, seconds, body, id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("entry no longer exists".into());
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Highlight {
    id: i64,
    /// 0-based page index
    page: i64,
    /// [left, top, width, height] in PDF points from the page's top-left corner
    rects: Vec<[f32; 4]>,
    color: String,
    text: String,
}

#[tauri::command]
pub fn highlight_list(
    doc_key: String,
    db: State<'_, SubtextDb>,
) -> Result<Vec<Highlight>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, page, rects, color, text FROM highlights WHERE doc_key = ?1 ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![doc_key], |r| {
            let rects_json: String = r.get(2)?;
            Ok(Highlight {
                id: r.get(0)?,
                page: r.get(1)?,
                rects: serde_json::from_str(&rects_json).unwrap_or_default(),
                color: r.get(3)?,
                text: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let out = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string());
    out
}

#[tauri::command]
pub fn highlight_add(
    doc_key: String,
    page: i64,
    rects: Vec<[f32; 4]>,
    color: String,
    text: String,
    db: State<'_, SubtextDb>,
) -> Result<(), String> {
    if rects.is_empty() {
        return Err("nothing selected".into());
    }
    if color.len() > 20 {
        return Err("bad colour".into());
    }
    let rects_json = serde_json::to_string(&rects).map_err(|e| e.to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO highlights (doc_key, page, rects, color, text) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![doc_key, page, rects_json, color, text],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn highlight_delete(id: i64, db: State<'_, SubtextDb>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM highlights WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

use rusqlite::OptionalExtension;

fn ensure_session_table(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS session (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// The saved session as a JSON string, if there is one.
#[tauri::command]
pub fn session_load(db: State<'_, SubtextDb>) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    ensure_session_table(&conn)?;
    conn.query_row("SELECT value FROM session WHERE key = 'main'", [], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn session_save(value: String, db: State<'_, SubtextDb>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    ensure_session_table(&conn)?;
    conn.execute(
        "INSERT INTO session (key, value) VALUES ('main', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}