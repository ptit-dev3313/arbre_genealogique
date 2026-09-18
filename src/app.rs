use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use eframe::egui::{
    self, Color32, ComboBox, DragPanButtons, Id, Modal, PointerButton, RichText, ScrollArea, Sense,
    Stroke, TextEdit, Ui, Vec2,
};
use uuid::Uuid;

use crate::layout::{
    build_from_positions, couple_hit_rect, person_rect_at, pixel_to_grid, suggested_child_cell,
    TreeLayout, BOX_HEIGHT, STEP_X,
};
use crate::model::{boxes_overlap, default_data_path, Couple, CoupleStatus, Data, Person, PERSON_SPAN};
use crate::pdf::export_pdf;
use crate::render::{color_to_hex, hex_to_color, paint_grid, paint_tree};

enum Dialog {
    None,
    Person {
        id: Option<Uuid>,
        name: String,
        family_name: String,
        col: Option<i32>,
        row: Option<i32>,
        add_to_couple: Option<Uuid>,
        error: String,
    },
    Message {
        title: String,
        body: String,
    },
}

struct DragState {
    start: egui::Pos2,
    origins: HashMap<Uuid, (i32, i32)>,
}

pub struct FamilyApp {
    data: Data,
    data_path: PathBuf,
    scene_rect: egui::Rect,
    dialog: Dialog,
    status_message: String,
    dirty: bool,
    selected: HashSet<Uuid>,
    selected_couple: Option<Uuid>,
    placing_person: Option<Uuid>,
    pick_child_for: Option<Uuid>,
    drag: Option<DragState>,
    drag_delta: (i32, i32),
    marquee: Option<(egui::Pos2, egui::Pos2)>,
    palette_filter: String,
}

impl FamilyApp {
    pub fn new(_cc: &eframe::CreationContext<'_>) -> Self {
        let data_path = default_data_path();
        let data = Data::load(&data_path).unwrap_or_default();
        Self {
            data,
            data_path,
            scene_rect: egui::Rect::from_min_size(
                egui::pos2(-24.0, -24.0),
                Vec2::new(720.0, 480.0),
            ),
            dialog: Dialog::None,
            status_message: String::new(),
            dirty: false,
            selected: HashSet::new(),
            selected_couple: None,
            placing_person: None,
            pick_child_for: None,
            drag: None,
            drag_delta: (0, 0),
            marquee: None,
            palette_filter: String::new(),
        }
    }

    fn layout(&self) -> TreeLayout {
        build_from_positions(&self.data)
    }

    fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    fn save(&mut self) {
        match self.data.save(&self.data_path) {
            Ok(()) => {
                self.dirty = false;
                self.status_message = format!("Sauvegardé dans {}", self.data_path.display());
            }
            Err(error) => self.status_message = error.to_string(),
        }
    }

    fn export_current_tree(&mut self) {
        if self.data.placed_ids().is_empty() {
            self.dialog = Dialog::Message {
                title: "Export impossible".into(),
                body: "Placez au moins une personne sur la grille.".into(),
            };
            return;
        }
        let Some(path) = rfd::FileDialog::new()
            .add_filter("PDF", &["pdf"])
            .set_file_name("arbre_genealogique.pdf")
            .save_file()
        else {
            return;
        };
        let layout = self.layout();
        match export_pdf(&path, &self.data, &layout) {
            Ok(()) => self.status_message = format!("PDF enregistré : {}", path.display()),
            Err(error) => {
                self.dialog = Dialog::Message {
                    title: "Export impossible".into(),
                    body: error.to_string(),
                };
            }
        }
    }
}

impl eframe::App for FamilyApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.selected.clear();
            self.selected_couple = None;
            self.placing_person = None;
            self.pick_child_for = None;
            self.drag = None;
            self.marquee = None;
        }
        if ctx.input(|i| i.key_pressed(egui::Key::Delete) || i.key_pressed(egui::Key::Backspace))
            && !ctx.egui_wants_keyboard_input()
            && matches!(self.dialog, Dialog::None)
        {
            self.unplace_selected();
        }

        egui::Panel::left("menu")
            .resizable(true)
            .default_size(260.0)
            .min_size(220.0)
            .show(ui, |ui| self.side_panel(ui));

        egui::CentralPanel::default().show(ui, |ui| self.editor(ui));
        self.show_dialog(&ctx);
    }

    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        let _ = self.data.save(&self.data_path);
    }
}

impl FamilyApp {
    fn side_panel(&mut self, ui: &mut Ui) {
        ui.add_space(8.0);
        ui.heading("Famille");
        ui.add_space(8.0);
        if ui.button("Sauvegarder").clicked() {
            self.save();
        }
        ui.small(self.data_path.display().to_string());
        if ui.button("Exporter en PDF").clicked() {
            self.export_current_tree();
        }
        if self.dirty {
            ui.colored_label(Color32::from_rgb(180, 90, 20), "Modifications non sauvées");
        }
        ui.separator();

        if let Some(mode) = self.mode_hint() {
            ui.colored_label(Color32::from_rgb(36, 108, 168), mode);
        }

        self.selection_actions(ui);
        ui.separator();
        self.inspector(ui);
        ui.separator();

        ui.with_layout(egui::Layout::bottom_up(egui::Align::Min), |ui| {
            ui.add_space(8.0);
            ui.label(RichText::new(&self.status_message).small().weak());
            ui.with_layout(
                egui::Layout::top_down(egui::Align::Min).with_cross_justify(true),
                |ui| {
                    self.palette(ui);
                },
            );
        });
    }

    fn mode_hint(&self) -> Option<&'static str> {
        if self.placing_person.is_some() {
            Some("Cliquez une case pour poser la personne.")
        } else if self.pick_child_for.is_some() {
            Some("Cliquez une personne sur l'arbre pour l'ajouter comme enfant.")
        } else {
            None
        }
    }

    fn selection_actions(&mut self, ui: &mut Ui) {
        ui.label(RichText::new("Sélection").strong());
        ui.label(format!("{} personne(s)", self.selected.len()));
        if self.selected.len() == 2 {
            if ui.button("Mettre en couple").clicked() {
                self.create_couple_from_selection();
            }
        }
        if !self.selected.is_empty() {
            if ui.button("Retirer de la grille").clicked() {
                self.unplace_selected();
            }
        }
        if self.selected.len() == 1 {
            if ui.button("Modifier la personne").clicked() {
                if let Some(id) = self.selected.iter().copied().next() {
                    self.open_edit_person(id);
                }
            }
            if ui.button("Supprimer la personne").clicked() {
                if let Some(id) = self.selected.iter().copied().next() {
                    match self.data.delete_person(id) {
                        Ok(()) => {
                            self.selected.remove(&id);
                            self.mark_dirty();
                        }
                        Err(error) => {
                            self.dialog = Dialog::Message {
                                title: "Suppression impossible".into(),
                                body: error.to_string(),
                            };
                        }
                    }
                }
            }
        }
    }

    fn inspector(&mut self, ui: &mut Ui) {
        if let Some(couple_id) = self.selected_couple {
            self.couple_inspector(ui, couple_id);
            return;
        }
        if self.selected.len() == 1 {
            if let Some(id) = self.selected.iter().copied().next() {
                let couple_ids = self.data.couples_for_person(id);
                if couple_ids.len() == 1 {
                    self.couple_inspector(ui, couple_ids[0]);
                } else if couple_ids.len() > 1 {
                    ui.label(RichText::new("Couples").strong());
                    for cid in couple_ids {
                        let label = self.couple_label(cid);
                        if ui.selectable_label(false, label).clicked() {
                            self.selected_couple = Some(cid);
                        }
                    }
                }
            }
        }
    }

    fn couple_label(&self, couple_id: Uuid) -> String {
        let Some(couple) = self.data.couple(couple_id) else {
            return "Couple".into();
        };
        format!(
            "{} · {}",
            self.data.person_label(couple.person1),
            self.data.person_label(couple.person2)
        )
    }

    fn couple_inspector(&mut self, ui: &mut Ui, couple_id: Uuid) {
        ui.label(RichText::new("Couple").strong());
        ui.label(self.couple_label(couple_id));
        let Some(couple) = self.data.couple(couple_id).cloned() else {
            return;
        };

        let mut status = couple.status;
        ComboBox::from_id_salt("couple_status")
            .selected_text(status.label())
            .show_ui(ui, |ui| {
                for value in CoupleStatus::ALL {
                    ui.selectable_value(&mut status, value, value.label());
                }
            });
        if status != couple.status {
            if let Some(c) = self.data.couple_mut(couple_id) {
                c.status = status;
                self.mark_dirty();
            }
        }

        let mut use_color = couple.color.is_some();
        let mut rgb = couple
            .color
            .as_deref()
            .map(hex_to_color)
            .unwrap_or([130, 144, 154]);
        ui.horizontal(|ui| {
            if ui.checkbox(&mut use_color, "Couleur").changed() {
                if let Some(c) = self.data.couple_mut(couple_id) {
                    c.color = if use_color {
                        Some(color_to_hex(rgb))
                    } else {
                        None
                    };
                    self.mark_dirty();
                }
            }
            if use_color && ui.color_edit_button_srgb(&mut rgb).changed() {
                if let Some(c) = self.data.couple_mut(couple_id) {
                    c.color = Some(color_to_hex(rgb));
                    self.mark_dirty();
                }
            }
        });

        ui.add_space(6.0);
        ui.label("Enfants");
        let children = couple.childrens.clone();
        for child_id in &children {
            ui.horizontal(|ui| {
                ui.label(self.data.person_label(*child_id));
                if ui.small_button("×").clicked() {
                    if let Some(c) = self.data.couple_mut(couple_id) {
                        c.childrens.retain(|id| id != child_id);
                        self.mark_dirty();
                    }
                }
            });
        }
        ui.horizontal(|ui| {
            if ui.button("Ajouter un enfant").clicked() {
                let pos = suggested_child_cell(&self.data, couple_id);
                self.open_person_dialog(None, pos.map(|p| p.0), pos.map(|p| p.1), Some(couple_id));
            }
            let picking = self.pick_child_for == Some(couple_id);
            if ui
                .selectable_label(picking, "Choisir sur l'arbre")
                .clicked()
            {
                self.pick_child_for = if picking { None } else { Some(couple_id) };
                self.placing_person = None;
            }
        });
        if ui.button("Supprimer le couple").clicked() {
            self.data.couples.retain(|c| c.id != couple_id);
            self.selected_couple = None;
            self.pick_child_for = None;
            self.mark_dirty();
        }
    }

    fn palette(&mut self, ui: &mut Ui) {
        ui.label(RichText::new("Non placés").strong());
        if ui
            .add_sized(
                [ui.available_width(), 28.0],
                egui::Button::new("Ajouter une personne"),
            )
            .clicked()
        {
            self.open_person_dialog(None, None, None, None);
        }
        ui.add_space(4.0);
        ui.add(TextEdit::singleline(&mut self.palette_filter).hint_text("Filtrer"));
        let query = self.palette_filter.to_lowercase();
        let ids = self.data.unplaced_ids();
        ScrollArea::vertical()
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                for id in ids {
                    let label = self.data.person_label(id);
                    if !query.is_empty() && !label.to_lowercase().contains(&query) {
                        continue;
                    }
                    let selected = self.placing_person == Some(id);
                    if ui.selectable_label(selected, label).clicked() {
                        self.placing_person = Some(id);
                        self.pick_child_for = None;
                        self.selected.clear();
                        self.selected.insert(id);
                        self.selected_couple = None;
                    }
                }
            });
    }

    fn editor(&mut self, ui: &mut Ui) {
        ui.horizontal(|ui| {
            ui.heading("Arbre");
            let layout = self.layout();
            ui.label(format!(
                "{} placée(s) · {} couple(s)",
                layout.metrics.people, layout.metrics.couples
            ));
            ui.label(
                RichText::new(
                    "Clic droit : déplacer la vue · maintenir le clic : sélectionner · glisser une carte : déplacer",
                )
                .small()
                .weak(),
            );
        });

        let layout = self.layout();

        egui::Frame::canvas(ui.style()).show(ui, |ui| {
            ui.set_min_height(ui.available_height());
            let outer = ui.max_rect();
            let mut scene_rect = self.scene_rect;
            egui::Scene::new()
                .zoom_range(0.05..=20.0)
                .max_inner_size([20_000.0, 20_000.0])
                .drag_pan_buttons(DragPanButtons::MIDDLE)
                .show(ui, &mut scene_rect, |ui| {
                    self.scene_contents(ui, &layout);
                });
            if outer.contains(ui.input(|i| i.pointer.latest_pos()).unwrap_or(egui::Pos2::ZERO))
                && ui.input(|i| i.pointer.button_down(PointerButton::Secondary))
            {
                let delta = ui.input(|i| i.pointer.delta());
                if delta != Vec2::ZERO {
                    let scale = (outer.size() / scene_rect.size()).min_elem().max(0.001);
                    scene_rect = scene_rect.translate(-delta / scale);
                }
            }
            self.scene_rect = scene_rect;
        });
    }

    fn scene_contents(&mut self, ui: &mut Ui, layout: &TreeLayout) {
        let origin = egui::pos2(0.0, 0.0);
        let canvas = egui::Rect::from_min_size(origin, Vec2::new(layout.width, layout.height));
        let additive = ui.input(|i| i.modifiers.shift || i.modifiers.ctrl || i.modifiers.command);
        let bg = ui.allocate_rect(canvas, Sense::click_and_drag());

        paint_grid(ui, origin, layout.width, layout.height);
        let preview = self.preview_rects();
        let selected: Vec<Uuid> = self.selected.iter().copied().collect();
        paint_tree(
            ui,
            &self.data,
            layout,
            origin,
            &selected,
            self.selected_couple,
            &preview,
        );
        if let Some((start, end)) = self.marquee {
            ui.painter().rect_stroke(
                egui::Rect::from_two_pos(start, end),
                0.0,
                Stroke::new(1.2_f32, Color32::from_rgb(36, 108, 168)),
                egui::StrokeKind::Middle,
            );
        }

        let mut person_clicked = None;
        let mut person_double = None;
        let mut couple_clicked = None;
        let mut consumed = false;

        for couple in &layout.couple_lines {
            let Some(first) = layout.person_rects.get(&couple.first_id) else {
                continue;
            };
            let Some(second) = layout.person_rects.get(&couple.second_id) else {
                continue;
            };
            let hit = couple_hit_rect(first, second, origin);
            let response = ui.interact(hit, Id::new(("couple", couple.couple_id)), Sense::click());
            if response.clicked() {
                couple_clicked = Some(couple.couple_id);
            }
        }

        for (person_id, person_rect) in &layout.person_rects {
            let draw = preview.get(person_id).unwrap_or(person_rect);
            let rect = draw.egui_rect(origin);
            let response = ui.interact(
                rect,
                Id::new(("person", *person_id)),
                Sense::click_and_drag(),
            );
            if response.double_clicked() {
                person_double = Some(*person_id);
                consumed = true;
            } else if response.clicked() {
                person_clicked = Some(*person_id);
                consumed = true;
            }
            if response.drag_started_by(PointerButton::Primary) {
                if !self.selected.contains(person_id) {
                    self.selected.clear();
                    self.selected.insert(*person_id);
                    self.selected_couple = None;
                }
                self.start_drag(response.interact_pointer_pos());
                consumed = true;
            }
            if response.dragged_by(PointerButton::Primary) {
                if let Some(pos) = response.interact_pointer_pos() {
                    self.update_drag_pointer(pos);
                }
                consumed = true;
            }
            if response.drag_stopped_by(PointerButton::Primary) {
                self.apply_drag();
                consumed = true;
            }
        }

        if let Some(id) = person_double {
            self.open_edit_person(id);
            return;
        }
        if let Some(id) = person_clicked {
            self.on_person_click(id, additive);
            return;
        }
        if let Some(couple_id) = couple_clicked {
            self.selected_couple = Some(couple_id);
            if let Some(couple) = self.data.couple(couple_id) {
                self.selected.clear();
                self.selected.insert(couple.person1);
                self.selected.insert(couple.person2);
            }
            self.placing_person = None;
            self.pick_child_for = None;
            return;
        }
        if consumed {
            return;
        }

        let primary = ui.input(|i| i.pointer.button_down(PointerButton::Primary));
        if let Some(pos) = bg.interact_pointer_pos() {
            if bg.drag_started() && primary {
                self.marquee = Some((pos, pos));
            }
            if bg.dragged_by(PointerButton::Primary) {
                if let Some((start, _)) = self.marquee {
                    self.marquee = Some((start, pos));
                }
            }
        }
        if bg.drag_stopped() {
            if let Some((start, end)) = self.marquee.take() {
                let rect = egui::Rect::from_two_pos(start, end);
                if rect.width() > 6.0 || rect.height() > 6.0 {
                    self.select_in_rect(layout, rect, origin, additive);
                } else {
                    self.on_empty_click(start);
                }
            }
        } else if bg.clicked() && !ui.input(|i| i.pointer.button_released(PointerButton::Secondary))
        {
            if let Some(pos) = bg.interact_pointer_pos() {
                self.on_empty_click(pos);
            }
        }
    }

    fn start_drag(&mut self, pos: Option<egui::Pos2>) {
        let Some(pos) = pos else {
            return;
        };
        let mut origins = HashMap::new();
        for id in &self.selected {
            if let Some(person) = self.data.persons.get(id) {
                if let Some(grid) = person.grid_pos() {
                    origins.insert(*id, grid);
                }
            }
        }
        if origins.is_empty() {
            return;
        }
        self.drag = Some(DragState {
            start: pos,
            origins,
        });
        self.drag_delta = (0, 0);
        self.marquee = None;
    }

    fn update_drag_pointer(&mut self, pos: egui::Pos2) {
        let Some(drag) = &self.drag else {
            return;
        };
        self.drag_delta = (
            ((pos.x - drag.start.x) / STEP_X).round() as i32,
            (((pos.y - drag.start.y) / BOX_HEIGHT).round() as i32) * PERSON_SPAN,
        );
    }

    fn preview_rects(&self) -> HashMap<Uuid, crate::layout::PersonRect> {
        let mut map = HashMap::new();
        let Some(drag) = &self.drag else {
            return map;
        };
        let (dc, dr) = self.drag_delta;
        for (id, (col, row)) in &drag.origins {
            map.insert(*id, person_rect_at(*id, col + dc, row + dr));
        }
        map
    }

    fn apply_drag(&mut self) {
        let Some(drag) = self.drag.take() else {
            return;
        };
        let (dc, dr) = self.drag_delta;
        self.drag_delta = (0, 0);
        if dc == 0 && dr == 0 {
            return;
        }
        let proposed: Vec<(Uuid, i32, i32)> = drag
            .origins
            .iter()
            .map(|(id, (col, row))| (*id, col + dc, row + dr))
            .collect();
        for (i, (_, c1, r1)) in proposed.iter().enumerate() {
            for (_, c2, r2) in proposed.iter().skip(i + 1) {
                if boxes_overlap(*c1, *r1, *c2, *r2) {
                    self.status_message = "Chevauchement dans le bloc déplacé.".into();
                    return;
                }
            }
        }
        let ignore: Vec<Uuid> = proposed.iter().map(|(id, _, _)| *id).collect();
        for (_, col, row) in &proposed {
            if self.data.occupies(*col, *row, &ignore) {
                self.status_message = "Cette case est déjà occupée.".into();
                return;
            }
        }
        for (id, col, row) in proposed {
            if let Some(person) = self.data.persons.get_mut(&id) {
                person.place(col, row);
            }
        }
        self.mark_dirty();
    }

    fn on_person_click(&mut self, id: Uuid, additive: bool) {
        if let Some(couple_id) = self.pick_child_for {
            if let Some(couple) = self.data.couple_mut(couple_id) {
                if couple.person1 != id && couple.person2 != id && !couple.childrens.contains(&id) {
                    couple.childrens.push(id);
                    self.mark_dirty();
                    self.status_message = "Enfant ajouté au couple.".into();
                }
            }
            self.pick_child_for = None;
            return;
        }
        self.selected_couple = None;
        self.placing_person = None;
        if additive {
            if !self.selected.remove(&id) {
                self.selected.insert(id);
            }
        } else {
            self.selected.clear();
            self.selected.insert(id);
        }
        if self.selected.len() == 1 {
            let person = id;
            let couples = self.data.couples_for_person(person);
            if couples.len() == 1 {
                self.selected_couple = Some(couples[0]);
            }
        }
    }

    fn on_empty_click(&mut self, pos: egui::Pos2) {
        let (col, row) = pixel_to_grid(pos.x, pos.y);
        if let Some(id) = self.placing_person.take() {
            self.place_person(id, col, row);
            return;
        }
        if self.pick_child_for.take().is_some() {
            return;
        }
        self.selected.clear();
        self.selected_couple = None;
    }

    fn place_person(&mut self, id: Uuid, col: i32, row: i32) {
        if self.data.occupies(col, row, &[id]) {
            self.status_message = "Cette case est déjà occupée.".into();
            self.placing_person = Some(id);
            return;
        }
        if let Some(person) = self.data.persons.get_mut(&id) {
            person.place(col, row);
            self.selected.clear();
            self.selected.insert(id);
            self.mark_dirty();
            self.status_message = "Personne placée.".into();
        }
    }

    fn select_in_rect(
        &mut self,
        layout: &TreeLayout,
        rect: egui::Rect,
        origin: egui::Pos2,
        additive: bool,
    ) {
        if !additive {
            self.selected.clear();
        }
        for (id, person_rect) in &layout.person_rects {
            if rect.intersects(person_rect.egui_rect(origin)) {
                self.selected.insert(*id);
            }
        }
        self.selected_couple = None;
    }

    fn unplace_selected(&mut self) {
        let ids: Vec<Uuid> = self.selected.iter().copied().collect();
        for id in ids {
            if let Some(person) = self.data.persons.get_mut(&id) {
                person.unplace();
            }
        }
        self.selected.clear();
        self.selected_couple = None;
        self.mark_dirty();
    }

    fn create_couple_from_selection(&mut self) {
        let mut ids: Vec<Uuid> = self.selected.iter().copied().collect();
        if ids.len() != 2 {
            return;
        }
        ids.sort();
        let a = ids[0];
        let b = ids[1];
        if let Some(existing) = self.data.find_couple(a, b) {
            self.selected_couple = Some(existing.id);
            self.status_message = "Ce couple existe déjà.".into();
            return;
        }
        let couple = Couple::new(a, b);
        self.selected_couple = Some(couple.id);
        self.data.couples.push(couple);
        self.mark_dirty();
        self.status_message = "Couple créé.".into();
    }

    fn open_edit_person(&mut self, id: Uuid) {
        let Some(person) = self.data.persons.get(&id) else {
            return;
        };
        self.dialog = Dialog::Person {
            id: Some(id),
            name: person.name.clone(),
            family_name: person.family_name.clone(),
            col: person.col,
            row: person.row,
            add_to_couple: None,
            error: String::new(),
        };
    }

    fn open_person_dialog(
        &mut self,
        id: Option<Uuid>,
        col: Option<i32>,
        row: Option<i32>,
        add_to_couple: Option<Uuid>,
    ) {
        self.dialog = Dialog::Person {
            id,
            name: String::new(),
            family_name: String::new(),
            col,
            row,
            add_to_couple,
            error: String::new(),
        };
    }

    fn show_dialog(&mut self, ctx: &egui::Context) {
        match &self.dialog {
            Dialog::None => {}
            Dialog::Person { .. } => self.show_person_dialog(ctx),
            Dialog::Message { title, body } => {
                let title = title.clone();
                let body = body.clone();
                let modal = Modal::new(Id::new("message")).show(ctx, |ui| {
                    ui.heading(&title);
                    ui.add_space(8.0);
                    ui.label(body);
                    ui.add_space(12.0);
                    if ui.button("OK").clicked() {
                        ui.close();
                    }
                });
                if modal.should_close() {
                    self.dialog = Dialog::None;
                }
            }
        }
    }

    fn show_person_dialog(&mut self, ctx: &egui::Context) {
        let Dialog::Person {
            id,
            name,
            family_name,
            col,
            row,
            add_to_couple,
            error,
        } = &self.dialog
        else {
            return;
        };
        let mut name = name.clone();
        let mut family_name = family_name.clone();
        let id = *id;
        let col = *col;
        let row = *row;
        let add_to_couple = *add_to_couple;
        let mut error = error.clone();
        let mut save = false;
        let mut cancel = false;

        let modal = Modal::new(Id::new("person")).show(ctx, |ui| {
            ui.heading(if id.is_some() {
                "Modifier une personne"
            } else {
                "Ajouter une personne"
            });
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                ui.label("Prénom");
                ui.add(TextEdit::singleline(&mut name).desired_width(220.0));
            });
            ui.horizontal(|ui| {
                ui.label("Nom");
                ui.add(TextEdit::singleline(&mut family_name).desired_width(220.0));
            });
            if let (Some(col), Some(row)) = (col, row) {
                ui.label(format!("Case : ({col}, {row})"));
            }
            if !error.is_empty() {
                ui.colored_label(Color32::from_rgb(170, 40, 40), &error);
            }
            ui.add_space(12.0);
            ui.horizontal(|ui| {
                if ui.button("Annuler").clicked() {
                    cancel = true;
                }
                if ui.button("Enregistrer").clicked() {
                    save = true;
                }
            });
        });

        if cancel || (modal.should_close() && !save) {
            self.dialog = Dialog::None;
            return;
        }
        if save {
            if name.trim().is_empty() && family_name.trim().is_empty() {
                error = "Indiquez au moins un prénom ou un nom.".into();
                self.dialog = Dialog::Person {
                    id,
                    name,
                    family_name,
                    col,
                    row,
                    add_to_couple,
                    error,
                };
                return;
            }
            if let Some(id) = id {
                if let Some(person) = self.data.persons.get_mut(&id) {
                    person.name = name.trim().to_string();
                    person.family_name = family_name.trim().to_string();
                }
            } else {
                let mut person = Person {
                    name: name.trim().to_string(),
                    family_name: family_name.trim().to_string(),
                    col: None,
                    row: None,
                };
                if let (Some(col), Some(row)) = (col, row) {
                    if !self.data.occupies(col, row, &[]) {
                        person.place(col, row);
                    }
                }
                let new_id = self.data.add_person(person);
                if let Some(couple_id) = add_to_couple {
                    if let Some(couple) = self.data.couple_mut(couple_id) {
                        couple.childrens.push(new_id);
                    }
                    self.selected_couple = Some(couple_id);
                }
                self.selected.clear();
                self.selected.insert(new_id);
            }
            self.mark_dirty();
            self.dialog = Dialog::None;
            return;
        }
        self.dialog = Dialog::Person {
            id,
            name,
            family_name,
            col,
            row,
            add_to_couple,
            error,
        };
    }
}
