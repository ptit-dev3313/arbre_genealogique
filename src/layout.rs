use std::collections::HashMap;

use uuid::Uuid;

use crate::model::{snap_row, CoupleStatus, Data, PERSON_SPAN};

pub const BOX_WIDTH: f32 = 148.0;
pub const BOX_HEIGHT: f32 = 58.0;
pub const STEP_X: f32 = BOX_WIDTH / PERSON_SPAN as f32;
pub const STEP_Y: f32 = BOX_HEIGHT / PERSON_SPAN as f32;
pub const MIN_COLS: i32 = 48;
pub const MIN_ROWS: i32 = 36;
pub const COUPLE_SYMBOL_RADIUS: f32 = 7.0;

#[derive(Clone, Debug)]
pub struct PersonRect {
    #[allow(dead_code)]
    pub person_id: Uuid,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl PersonRect {
    pub fn right(&self) -> f32 {
        self.x + self.width
    }

    pub fn bottom(&self) -> f32 {
        self.y + self.height
    }

    pub fn center_x(&self) -> f32 {
        self.x + self.width * 0.5
    }

    pub fn center_y(&self) -> f32 {
        self.y + self.height * 0.5
    }

    pub fn egui_rect(&self, origin: egui::Pos2) -> egui::Rect {
        egui::Rect::from_min_size(
            egui::pos2(origin.x + self.x, origin.y + self.y),
            egui::vec2(self.width, self.height),
        )
    }
}

#[derive(Clone, Debug)]
pub struct Connector {
    pub points: Vec<(f32, f32)>,
    pub color: String,
}

#[derive(Clone, Debug)]
pub struct CoupleLine {
    pub couple_id: Uuid,
    pub first_id: Uuid,
    pub second_id: Uuid,
    pub status: CoupleStatus,
    pub color: String,
}

#[derive(Clone, Debug, Default)]
pub struct LayoutMetrics {
    pub people: usize,
    pub couples: usize,
}

#[derive(Clone, Debug)]
pub struct TreeLayout {
    pub couple_lines: Vec<CoupleLine>,
    pub person_rects: HashMap<Uuid, PersonRect>,
    pub connectors: Vec<Connector>,
    pub width: f32,
    pub height: f32,
    pub metrics: LayoutMetrics,
}

pub fn grid_to_pixel(col: i32, row: i32) -> (f32, f32) {
    (col as f32 * STEP_X, row as f32 * STEP_Y)
}

pub fn pixel_to_grid(x: f32, y: f32) -> (i32, i32) {
    let col = (x / STEP_X).floor() as i32;
    let row = ((y / BOX_HEIGHT).floor() as i32) * PERSON_SPAN;
    (col, row)
}

pub fn person_rect_at(person_id: Uuid, col: i32, row: i32) -> PersonRect {
    let (x, y) = grid_to_pixel(col, row);
    PersonRect {
        person_id,
        x,
        y,
        width: BOX_WIDTH,
        height: BOX_HEIGHT,
    }
}

pub fn canvas_size(data: &Data) -> (f32, f32) {
    let mut max_col = MIN_COLS;
    let mut max_row = MIN_ROWS;
    let mut min_col = 0;
    let mut min_row = 0;
    for person in data.persons.values() {
        if let Some((col, row)) = person.grid_pos() {
            min_col = min_col.min(col);
            min_row = min_row.min(row);
            max_col = max_col.max(col + PERSON_SPAN);
            max_row = max_row.max(row + PERSON_SPAN);
        }
    }
    let width = ((max_col - min_col).max(MIN_COLS) as f32 + 4.0) * STEP_X;
    let height = ((max_row - min_row).max(MIN_ROWS) as f32 + 4.0) * STEP_Y;
    (width, height)
}

pub fn build_from_positions(data: &Data) -> TreeLayout {
    let mut person_rects = HashMap::new();
    for (id, person) in &data.persons {
        if let Some((col, row)) = person.grid_pos() {
            person_rects.insert(*id, person_rect_at(*id, col, row));
        }
    }

    let mut couple_lines = Vec::new();
    let mut connectors = Vec::new();
    for couple in &data.couples {
        let Some(first) = person_rects.get(&couple.person1) else {
            continue;
        };
        let Some(second) = person_rects.get(&couple.person2) else {
            continue;
        };
        let color = couple
            .color
            .clone()
            .unwrap_or_else(|| "#829099".to_string());
        couple_lines.push(CoupleLine {
            couple_id: couple.id,
            first_id: couple.person1,
            second_id: couple.person2,
            status: couple.status,
            color: color.clone(),
        });

        let (left, right) = if first.x <= second.x {
            (first, second)
        } else {
            (second, first)
        };
        let mid_x = (left.right() + right.x) * 0.5;
        let mid_y = (left.center_y() + right.center_y()) * 0.5;

        for child_id in &couple.childrens {
            let Some(child) = person_rects.get(child_id) else {
                continue;
            };
            connectors.push(Connector {
                points: orthogonal_parent_child(mid_x, mid_y, child),
                color: color.clone(),
            });
        }
    }

    let (width, height) = canvas_size(data);
    let metrics = LayoutMetrics {
        people: person_rects.len(),
        couples: couple_lines.len(),
    };
    TreeLayout {
        couple_lines,
        person_rects,
        connectors,
        width,
        height,
        metrics,
    }
}

fn orthogonal_parent_child(mid_x: f32, mid_y: f32, child: &PersonRect) -> Vec<(f32, f32)> {
    let start_y = if child.center_y() >= mid_y {
        mid_y + COUPLE_SYMBOL_RADIUS
    } else {
        mid_y - COUPLE_SYMBOL_RADIUS
    };
    let start = (mid_x, start_y);
    let end = (child.center_x(), child.y);
    if (start.0 - end.0).abs() < 1.0 {
        return vec![start, end];
    }
    let elbow_y = start_y + (end.1 - start_y) * 0.5;
    vec![start, (start.0, elbow_y), (end.0, elbow_y), end]
}

pub fn content_bounds(layout: &TreeLayout) -> Option<(f32, f32, f32, f32)> {
    let mut min_x = f32::MAX;
    let mut min_y = f32::MAX;
    let mut max_x = f32::MIN;
    let mut max_y = f32::MIN;
    let mut any = false;
    for rect in layout.person_rects.values() {
        any = true;
        min_x = min_x.min(rect.x);
        min_y = min_y.min(rect.y);
        max_x = max_x.max(rect.right());
        max_y = max_y.max(rect.bottom());
    }
    for connector in &layout.connectors {
        for (x, y) in &connector.points {
            any = true;
            min_x = min_x.min(*x);
            min_y = min_y.min(*y);
            max_x = max_x.max(*x);
            max_y = max_y.max(*y);
        }
    }
    if !any {
        return None;
    }
    let pad = 24.0;
    Some((min_x - pad, min_y - pad, max_x + pad, max_y + pad))
}

pub fn couple_hit_rect(first: &PersonRect, second: &PersonRect, origin: egui::Pos2) -> egui::Rect {
    let (left, right) = if first.x <= second.x {
        (first, second)
    } else {
        (second, first)
    };
    let a = egui::pos2(origin.x + left.right(), origin.y + left.center_y());
    let b = egui::pos2(origin.x + right.x, origin.y + right.center_y());
    egui::Rect::from_two_pos(a, b).expand(10.0)
}

pub fn suggested_child_cell(data: &Data, couple_id: Uuid) -> Option<(i32, i32)> {
    let couple = data.couple(couple_id)?;
    let p1 = data.persons.get(&couple.person1)?.grid_pos()?;
    let p2 = data.persons.get(&couple.person2)?.grid_pos()?;
    let col = (p1.0 + p2.0) / 2;
    let row = snap_row(p1.1.max(p2.1) + PERSON_SPAN);
    Some(data.find_free_cell(col, row, &[]))
}
