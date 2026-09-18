use egui::{pos2, Color32, CornerRadius, FontId, Pos2, Rect, Stroke, StrokeKind, Ui, Vec2};
use uuid::Uuid;

use crate::layout::{TreeLayout, BOX_HEIGHT, STEP_X};
use crate::model::{CoupleStatus, Data};

pub const PERSON_CORNER_RADIUS: f32 = 8.0;

pub fn parse_color(hex: &str, fallback: Color32) -> Color32 {
    let hex = hex.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return fallback;
    }
    let Ok(value) = u32::from_str_radix(hex, 16) else {
        return fallback;
    };
    Color32::from_rgb(
        ((value >> 16) & 0xff) as u8,
        ((value >> 8) & 0xff) as u8,
        (value & 0xff) as u8,
    )
}

pub fn paint_grid(ui: &mut Ui, origin: Pos2, width: f32, height: f32) {
    let painter = ui.painter();
    let mut x = 0.0;
    let mut col = 0;
    while x <= width {
        let (color, stroke) = match col % 4 {
            0 => (Color32::from_rgb(196, 206, 214), 1.15_f32),
            2 => (Color32::from_rgb(214, 221, 227), 0.8_f32),
            _ => (Color32::from_rgb(232, 236, 240), 0.45_f32),
        };
        painter.line_segment(
            [
                pos2(origin.x + x, origin.y),
                pos2(origin.x + x, origin.y + height),
            ],
            Stroke::new(stroke, color),
        );
        x += STEP_X;
        col += 1;
    }
    let mut y = 0.0;
    while y <= height {
        painter.line_segment(
            [
                pos2(origin.x, origin.y + y),
                pos2(origin.x + width, origin.y + y),
            ],
            Stroke::new(1.15_f32, Color32::from_rgb(196, 206, 214)),
        );
        y += BOX_HEIGHT;
    }
}

pub fn paint_tree(
    ui: &mut Ui,
    data: &Data,
    layout: &TreeLayout,
    origin: Pos2,
    selected: &[Uuid],
    selected_couple: Option<Uuid>,
    preview_rects: &std::collections::HashMap<Uuid, crate::layout::PersonRect>,
) -> Rect {
    let painter = ui.painter();
    for connector in &layout.connectors {
        let color = parse_color(&connector.color, Color32::from_rgb(130, 144, 154));
        let points: Vec<Pos2> = connector
            .points
            .iter()
            .map(|(x, y)| pos2(origin.x + *x, origin.y + *y))
            .collect();
        for pair in points.windows(2) {
            painter.line_segment([pair[0], pair[1]], Stroke::new(1.6_f32, color));
        }
    }

    for couple in &layout.couple_lines {
        let Some(first) = layout.person_rects.get(&couple.first_id) else {
            continue;
        };
        let Some(second) = layout.person_rects.get(&couple.second_id) else {
            continue;
        };
        let color = parse_color(&couple.color, Color32::from_rgb(130, 144, 154));
        let (from, to) = couple_anchor(first, second, origin);
        let width = if selected_couple == Some(couple.couple_id) {
            3.4_f32
        } else {
            2.0_f32
        };
        painter.line_segment([from, to], Stroke::new(width, color));
        paint_symbol(painter, couple.status, from, to, color);
    }

    for (person_id, person_rect) in &layout.person_rects {
        let draw_rect = preview_rects.get(person_id).unwrap_or(person_rect);
        let rect = Rect::from_min_size(
            pos2(origin.x + draw_rect.x, origin.y + draw_rect.y),
            Vec2::new(draw_rect.width, draw_rect.height),
        );
        let selected = selected.contains(person_id);
        painter.rect(
            rect,
            CornerRadius::same(PERSON_CORNER_RADIUS as u8),
            if selected {
                Color32::from_rgb(232, 244, 255)
            } else {
                Color32::from_rgb(255, 250, 240)
            },
            Stroke::new(
                if selected { 2.4_f32 } else { 1.4_f32 },
                if selected {
                    Color32::from_rgb(36, 108, 168)
                } else {
                    Color32::from_rgb(71, 117, 143)
                },
            ),
            StrokeKind::Middle,
        );
        painter.text(
            rect.center(),
            egui::Align2::CENTER_CENTER,
            wrapped_label(data, *person_id),
            FontId::proportional(13.0),
            Color32::from_rgb(38, 55, 70),
        );
    }

    Rect::from_min_size(origin, Vec2::new(layout.width, layout.height))
}

fn couple_anchor(
    first: &crate::layout::PersonRect,
    second: &crate::layout::PersonRect,
    origin: Pos2,
) -> (Pos2, Pos2) {
    let (left, right) = if first.x <= second.x {
        (first, second)
    } else {
        (second, first)
    };
    (
        pos2(origin.x + left.right(), origin.y + left.center_y()),
        pos2(origin.x + right.x, origin.y + right.center_y()),
    )
}

fn paint_symbol(
    painter: &egui::Painter,
    status: CoupleStatus,
    first: Pos2,
    second: Pos2,
    color: Color32,
) {
    let center = pos2((first.x + second.x) * 0.5, (first.y + second.y) * 0.5);
    let stroke = Stroke::new(1.6_f32, color);
    match status {
        CoupleStatus::Married => {
            painter.circle_stroke(pos2(center.x - 5.0, center.y), 7.0, stroke);
            painter.circle_stroke(pos2(center.x + 5.0, center.y), 7.0, stroke);
        }
        CoupleStatus::Engaged => {
            painter.text(
                center,
                egui::Align2::CENTER_CENTER,
                "♥",
                FontId::proportional(14.0),
                color,
            );
        }
        CoupleStatus::Separated => {
            painter.line_segment(
                [
                    pos2(center.x - 8.0, center.y - 8.0),
                    pos2(center.x + 8.0, center.y + 8.0),
                ],
                stroke,
            );
        }
        CoupleStatus::Divorced => {
            painter.line_segment(
                [
                    pos2(center.x - 8.0, center.y - 8.0),
                    pos2(center.x + 8.0, center.y + 8.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    pos2(center.x + 8.0, center.y - 8.0),
                    pos2(center.x - 8.0, center.y + 8.0),
                ],
                stroke,
            );
        }
    }
}

pub fn wrapped_label(data: &Data, person_id: Uuid) -> String {
    let person = match data.persons.get(&person_id) {
        Some(person) => person,
        None => return "Personne inconnue".into(),
    };
    format!("{}\n{}", person.family_name, person.name)
}

pub fn color_to_hex(color: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2])
}

pub fn hex_to_color(hex: &str) -> [u8; 3] {
    let color = parse_color(hex, Color32::from_rgb(130, 144, 154));
    [color.r(), color.g(), color.b()]
}
