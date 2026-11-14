# B.Read (Better Read) - DEVELOPMENT

## Status
- M0 done: Tauri 2 + React + TS scaffold runs (`bun tauri dev`).
- M1 done: page 1 renders in the app window via a Tauri command + canvas

## Decisions
- PDF-first MVP; DOCX/PPTX read-only later.
- PDFium on one dedicated worker thread; page bitmaps go to the UI via a custom protocol, not base64 IPC.
- Original files are never modified; edits live in an overlay layer.

## Layout
- src-tauri/src/pdf_spike.rs: temporary spike, delete after M3 starts.
- src-tauri/pdfium/: pdfium.dll + test.pdf (not committed).

## Commands
- Run: `bun tauri dev` (from project root)
- Check Rust only: `cargo check` (from src-tauri)

## Known issues
- First DLL load once took 2.6 s (probably antivirus scanning), re-measure later.

## Next
- Page navigation, then open-any-PDF