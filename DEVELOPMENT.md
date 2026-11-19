# B.Read (Better Read) - DEVELOPMENT

Unified desktop office app. PDF-first MVP; DOCX/PPTX later (read-only first).
Stack: Tauri 2 + Rust, React + TypeScript, pdfium-render 0.9.5 (PDFium DLL in src-tauri/pdfium/), SQLite (rusqlite, bundled).

## Status (what works, verified by hand)
- PDF viewer: continuous scroll, virtualized pages, 12-page bitmap cache, zoom 25-400% (fit width, Ctrl+wheel, Ctrl +/-/0), page box, keyboard nav.
- Page sizes load lazily in the background (reading all up front took 6-8 s on a 362-page PDF).
- Thumbnail sidebar (40-bitmap cache; renders only while the main view is idle).
- Text search across the whole document (chunked, cancellable, Bangla confirmed), result list, prev/next hit page, yellow highlights on pages.
- Selectable text layer (transparent text over glyphs); copy works incl. Bangla.
- Tabs for multiple documents; only the active viewer is mounted; page+zoom restored per tab.
- Read & Subtext v1: right panel with Transcript/Notes, manual entries with page + optional time, click to jump, current-page highlight; stored in %APPDATA%\com.lenovo.bread\bread.db, keyed by SHA-256 of the file contents (old path-keyed entries are adopted on first open).
- Shell pass 1: fixed frame (title bar + workspace), design tokens in src/styles.css.
- selection drawn as even line bands from the same rectangles as highlights; partial-word ends are estimated

## Architecture
- Rust: src-tauri/src/pdf.rs (PDFium bound once in a OnceLock; DocRegistry = id -> open document; touch() recycles a document after 60 page touches), subtext.rs (SQLite + file fingerprint), lib.rs (setup + commands).
- Frontend: App.tsx (tabs), ContinuousView.tsx (main viewer), Thumbnails.tsx, SearchBar.tsx, MatchOverlay.tsx, TextLayer.tsx, SubtextPanel.tsx.
- Page pixels: Rust returns [w u32 LE][h u32 LE][RGBA] over invoke(); drawn via ImageBitmap on canvas.

## Decisions and measured findings
- Rust render ~7-19 ms/page; invoke() and custom protocol both ~60-100 ms per 4 MB page (about 17 ms per MB transferred). PNG/JPEG compression did not beat raw. Kept raw RGBA over invoke().
- PDFium retains ~1.6 MB per touched page until the document is dropped. Fix: reopen the file after RECYCLE_AFTER = 60 touches (measured on one image-heavy 101 MB PDF only; tune with others). Result: ~25-120 MB instead of ~580 MB.
- [profile.dev.package."*"] opt-level = 3 so dependency timings in dev are meaningful.
- Render width capped at 1800 px.
- Originals are never modified.

## Known issues / limits
- Highlight and text-layer rectangles assume unrotated pages with no crop offset (checked on several PDFs, not on rotated/cropped ones).
- Copy order follows the PDF's text order (multi-column pages may copy out of order).
- Thumbnails assume every page has page 1's shape.
- Fingerprint changes if the file's bytes change (re-saved PDFs look like new documents).
- Subtext entries can't be edited yet, only added/deleted.
- Debug build only measured so far; no installer build tested.
- Toolbar is an interim design; real ribbon not built.
- selection ends inside a word can be off by about a letter; Bangla copy gives the PDF’s own text, so a PDF with bad embedded text copies badly in every reader
## Not built yet
Edit/overlay mode, annotations, saving, bookmarks/outline, DOCX/PPTX, ribbon, light theme, settings, shortcuts help.

## Commands
- Run: `bun tauri dev` (project root). Release-mode dev: `bun tauri dev --release`.
- Check Rust only: `cargo check` (from src-tauri).
- PDFium: put pdfium.dll in src-tauri/pdfium/ (from bblanchon/pdfium-binaries, pdfium-win-x64).
- Database path is printed at startup on a [db] line.

## Next
Filter box in Subtext panel, entry editing, then PDF annotations or the ribbon shell.