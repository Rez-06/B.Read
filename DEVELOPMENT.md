# B.Read (Better Read) - DEVELOPMENT

## Status
- M0 done: Tauri 2 + React + TS scaffold runs (`bun tauri dev`).
- M1 done: documents stay open in a DocRegistry keyed by id
- M3 core works: continuous scroll, lazy sizes, visible-page rendering, 12-page bitmap cache

## Decisions
- PDF-first MVP; DOCX/PPTX read-only later.
- PDFium on one dedicated worker thread; page bitmaps go to the UI via a custom protocol, not base64 IPC.
- Original files are never modified; edits live in an overlay layer.
- Open performance: page sizes load lazily in the background (about 16 ms per first-touched page; reading all sizes up front took 6–8 s on a 362-page PDF).

## Layout
- src-tauri/src/pdf_spike.rs: temporary spike, delete after M3 starts.
- src-tauri/pdfium/: pdfium.dll + test.pdf (not committed).

## Commands
- Run: `bun tauri dev` (from project root)
- Check Rust only: `cargo check` (from src-tauri)

## Known issues
- render commands run synchronously and may block the UI on huge pages
- Perf finding (debug+release, 900px page, 4 MB RGBA): Rust render ~7-19 ms; invoke() and custom protocol both ~60-100 ms per page, so IPC route is not the bottleneck. A protocol test with zero-filled buffers showed ~17 ms per MB regardless of PDFium.
- PNG (24-55 ms encode, 100-700 KB) and JPEG q90 (160-265 ms encode) did not beat raw RGBA overall. Decision: keep raw RGBA over invoke(); solve scrolling latency with caching + prefetch (M3), not compression.
- [profile.dev.package."*"] opt-level = 3 in Cargo.toml so dependency timings in dev builds are meaningful.
- Open question: pdfium time per page varied 5-130 ms in one run (lock contention from overlapping requests?). Re-measure under controlled conditions.
- Memory: bread.exe about 590 MB (up to 665 MB under fast scroll) with a 362-page PDF in a debug build, cause not yet identified. Webview about 200 MB

## Next
- zoom, text selection, search, thumbnails, bookmarks, and a proper close-document control.