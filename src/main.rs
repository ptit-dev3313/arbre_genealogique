#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod layout;
mod model;
mod pdf;
mod render;

use std::path::PathBuf;

use app::FamilyApp;
use layout::build_from_positions;
use model::{default_data_path, Data};

fn main() -> eframe::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--export") {
        if let Err(error) = export_preview(args.get(2).cloned()) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return Ok(());
    }

    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1280.0, 820.0])
            .with_min_inner_size([900.0, 600.0])
            .with_title("Application familiale"),
        ..Default::default()
    };
    eframe::run_native(
        "Application familiale",
        native_options,
        Box::new(|cc| Ok(Box::new(FamilyApp::new(cc)))),
    )
}

fn export_preview(path: Option<String>) -> anyhow::Result<()> {
    let data = Data::load(default_data_path())?;
    if data.placed_ids().is_empty() {
        anyhow::bail!("Aucune personne n'est placée sur la grille.");
    }
    let layout = build_from_positions(&data);
    let pdf_path = PathBuf::from(path.unwrap_or_else(|| "arbre_genealogique.pdf".into()));
    crate::pdf::export_pdf(&pdf_path, &data, &layout)?;
    println!(
        "Exporté {} ({} personnes, {} couples)",
        pdf_path.display(),
        layout.metrics.people,
        layout.metrics.couples
    );
    Ok(())
}
