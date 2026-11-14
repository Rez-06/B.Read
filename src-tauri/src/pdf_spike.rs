use pdfium_render::prelude::*;
use std::path::Path;
use std::time::Instant;

/// Temporary spike: render page 1 of test.pdf to out.png and print timings.
pub fn render_first_page() -> Result<(), Box<dyn std::error::Error>> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("pdfium");

    let t0 = Instant::now();
    let bindings = Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&dir))?;
    let pdfium = Pdfium::new(bindings);
    println!("[spike] DLL loaded in {:?}", t0.elapsed());

    let t1 = Instant::now();
    let document = pdfium.load_pdf_from_file(&dir.join("test.pdf"), None)?;
    println!("[spike] opened, {} pages, in {:?}", document.pages().len(), t1.elapsed());

    let t2 = Instant::now();
    let page = document.pages().get(0)?;
    let config = PdfRenderConfig::new().set_target_width(1200);
    let image = page.render_with_config(&config)?.as_image()?;
    println!("[spike] page 1 rendered {}x{} in {:?}", image.width(), image.height(), t2.elapsed());

    let out = dir.parent().unwrap().parent().unwrap().join("spike-out.png");
    image.save(&out)?;
    println!("[spike] saved {:?}", out);
    Ok(())
}