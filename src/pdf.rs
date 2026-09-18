use std::f32::consts::PI;
use std::path::Path;

use printpdf::{
    BuiltinFont, Color, Line, LinePoint, Mm, Op, PaintMode, PdfDocument, PdfFontHandle, PdfPage,
    PdfSaveOptions, Point, Pt, Polygon, PolygonRing, Rgb, TextItem, WindingOrder,
};
use uuid::Uuid;

use crate::layout::{content_bounds, CoupleLine, PersonRect, TreeLayout, COUPLE_SYMBOL_RADIUS};
use crate::model::{CoupleStatus, Data};
use crate::render::{parse_color, PERSON_CORNER_RADIUS};

/// Cubic Bézier kappa for a quarter-circle (4/3 * tan(π/8)).
const KAPPA: f32 = 0.552_284_75;

const PX_TO_MM: f32 = 0.264583;

pub fn export_pdf(path: &Path, data: &Data, layout: &TreeLayout) -> anyhow::Result<()> {
    let (min_x, min_y, max_x, max_y) =
        content_bounds(layout).ok_or_else(|| anyhow::anyhow!("Aucune personne placée"))?;
    let width = (max_x - min_x).max(40.0);
    let height = (max_y - min_y).max(40.0);
    let margin = 12.0;
    let page_w = Mm(width * PX_TO_MM + margin * 2.0);
    let page_h = Mm(height * PX_TO_MM + margin * 2.0);

    let to_mm = |px: f32| Mm(px * PX_TO_MM);
    let map_x = |x: f32| Mm(margin) + to_mm(x - min_x);
    let map_y = |y: f32| page_h - Mm(margin) - to_mm(y - min_y);

    let mut ops = Vec::new();

    for connector in &layout.connectors {
        ops.push(Op::SetOutlineColor {
            col: pdf_color(&connector.color),
        });
        ops.push(Op::SetOutlineThickness { pt: Pt(0.55) });
        let points = connector
            .points
            .iter()
            .map(|(x, y)| Point::new(map_x(*x), map_y(*y)))
            .collect::<Vec<_>>();
        ops.push(Op::DrawLine {
            line: polyline(points, false),
        });
    }

    for couple in &layout.couple_lines {
        let Some(first) = layout.person_rects.get(&couple.first_id) else {
            continue;
        };
        let Some(second) = layout.person_rects.get(&couple.second_id) else {
            continue;
        };
        let (left, right) = ordered_pair(first, second);
        ops.push(Op::SetOutlineColor {
            col: pdf_color(&couple.color),
        });
        ops.push(Op::SetOutlineThickness { pt: Pt(0.7) });
        ops.push(Op::DrawLine {
            line: polyline(
                vec![
                    Point::new(map_x(left.right()), map_y(left.center_y())),
                    Point::new(map_x(right.x), map_y(right.center_y())),
                ],
                false,
            ),
        });
        draw_status(
            &mut ops,
            couple,
            map_x((left.right() + right.x) * 0.5),
            map_y((left.center_y() + right.center_y()) * 0.5),
        );
    }

    for (person_id, person_rect) in &layout.person_rects {
        let x = map_x(person_rect.x);
        let y = map_y(person_rect.bottom());
        let w = to_mm(person_rect.width);
        let h = to_mm(person_rect.height);
        ops.push(Op::SetFillColor {
            col: Color::Rgb(Rgb::new(1.0, 0.980, 0.941, None)),
        });
        ops.push(Op::SetOutlineColor {
            col: Color::Rgb(Rgb::new(0.278, 0.459, 0.561, None)),
        });
        ops.push(Op::SetOutlineThickness { pt: Pt(0.5) });
        ops.push(Op::DrawPolygon {
            polygon: rounded_rect(x, y, w, h, to_mm(PERSON_CORNER_RADIUS)),
        });
        ops.push(Op::SetFillColor {
            col: Color::Rgb(Rgb::new(0.149, 0.216, 0.275, None)),
        });
        let (family, given) = person_lines(data, *person_id);
        let cx = x + w * 0.5;
        centered_text(
            &mut ops,
            PdfFontHandle::Builtin(BuiltinFont::Helvetica),
            &family,
            10.0,
            cx,
            y + h * 0.32,
        );
        centered_text(
            &mut ops,
            PdfFontHandle::Builtin(BuiltinFont::HelveticaBold),
            &given,
            10.0,
            cx,
            y + h * 0.62,
        );
    }

    let mut doc = PdfDocument::new("Arbre généalogique");
    let page = PdfPage::new(page_w, page_h, ops);
    let bytes = doc
        .with_pages(vec![page])
        .save(&PdfSaveOptions::default(), &mut Vec::new());
    std::fs::write(path, bytes)?;
    Ok(())
}

fn lp(x: Mm, y: Mm, bezier: bool) -> LinePoint {
    LinePoint {
        p: Point::new(x, y),
        bezier,
    }
}

fn rounded_rect(x: Mm, y: Mm, w: Mm, h: Mm, radius: Mm) -> Polygon {
    let r = Mm(radius.0.min(w.0 * 0.5).min(h.0 * 0.5));
    let k = r * KAPPA;
    let left = x;
    let right = x + w;
    let bottom = y;
    let top = y + h;
    Polygon {
        rings: vec![PolygonRing {
            points: vec![
                lp(left + r, top, false),
                lp(right - r, top, false),
                lp(right - r + k, top, true),
                lp(right, top - r + k, true),
                lp(right, top - r, false),
                lp(right, bottom + r, false),
                lp(right, bottom + k, true),
                lp(right - r + k, bottom, true),
                lp(right - r, bottom, false),
                lp(left + r, bottom, false),
                lp(left + k, bottom, true),
                lp(left, bottom + r - k, true),
                lp(left, bottom + r, false),
                lp(left, top - r, false),
                lp(left, top - k, true),
                lp(left + r - k, top, true),
                lp(left + r, top, false),
            ],
        }],
        mode: PaintMode::FillStroke,
        winding_order: WindingOrder::NonZero,
    }
}

fn polyline(points: Vec<Point>, is_closed: bool) -> Line {
    Line {
        points: points
            .into_iter()
            .map(|p| LinePoint { p, bezier: false })
            .collect(),
        is_closed,
    }
}

fn ordered_pair<'a>(
    first: &'a PersonRect,
    second: &'a PersonRect,
) -> (&'a PersonRect, &'a PersonRect) {
    if first.x <= second.x {
        (first, second)
    } else {
        (second, first)
    }
}

fn person_lines(data: &Data, person_id: Uuid) -> (String, String) {
    match data.persons.get(&person_id) {
        Some(person) => (pdf_text(&person.family_name), pdf_text(&person.name)),
        None => ("Inconnue".into(), String::new()),
    }
}

fn pdf_text(text: &str) -> String {
    text.chars()
        .map(|ch| match ch {
            'œ' | 'Œ' => 'e',
            other => other,
        })
        .filter(|ch| ch.is_ascii() || ('\u{00A0}'..='\u{00FF}').contains(ch))
        .collect()
}

fn centered_text(
    ops: &mut Vec<Op>,
    font: PdfFontHandle,
    text: &str,
    size: f32,
    center_x: Mm,
    y: Mm,
) {
    if text.is_empty() {
        return;
    }
    let width = Mm(text.chars().count() as f32 * size * 0.50 * 0.3528);
    ops.extend_from_slice(&[
        Op::StartTextSection,
        Op::SetTextCursor {
            pos: Point::new(center_x - width * 0.5, y),
        },
        Op::SetFont {
            font,
            size: Pt(size),
        },
        Op::SetLineHeight { lh: Pt(size) },
        Op::ShowText {
            items: vec![TextItem::Text(text.to_string())],
        },
        Op::EndTextSection,
    ]);
}

fn pdf_color(hex: &str) -> Color {
    let color = parse_color(hex, egui::Color32::from_rgb(130, 144, 154));
    Color::Rgb(Rgb::new(
        color.r() as f32 / 255.0,
        color.g() as f32 / 255.0,
        color.b() as f32 / 255.0,
        None,
    ))
}

fn draw_status(ops: &mut Vec<Op>, couple: &CoupleLine, x: Mm, y: Mm) {
    ops.push(Op::SetOutlineColor {
        col: pdf_color(&couple.color),
    });
    ops.push(Op::SetOutlineThickness { pt: Pt(0.55) });
    let r = Mm(COUPLE_SYMBOL_RADIUS * PX_TO_MM);
    match couple.status {
        CoupleStatus::Married => {
            stroke_circle(ops, x - Mm(5.0 * PX_TO_MM), y, r);
            stroke_circle(ops, x + Mm(5.0 * PX_TO_MM), y, r);
        }
        CoupleStatus::Separated => {
            let d = Mm(8.0 * PX_TO_MM);
            ops.push(Op::DrawLine {
                line: polyline(vec![Point::new(x - d, y + d), Point::new(x + d, y - d)], false),
            });
        }
        CoupleStatus::Divorced => {
            let d = Mm(8.0 * PX_TO_MM);
            ops.push(Op::DrawLine {
                line: polyline(vec![Point::new(x - d, y + d), Point::new(x + d, y - d)], false),
            });
            ops.push(Op::DrawLine {
                line: polyline(vec![Point::new(x + d, y + d), Point::new(x - d, y - d)], false),
            });
        }
        CoupleStatus::Engaged => {
            let s = Mm(6.0 * PX_TO_MM);
            ops.push(Op::DrawLine {
                line: polyline(
                    vec![
                        Point::new(x, y + s),
                        Point::new(x - s, y),
                        Point::new(x, y - s * 0.85),
                        Point::new(x + s, y),
                    ],
                    true,
                ),
            });
        }
    }
}

fn stroke_circle(ops: &mut Vec<Op>, cx: Mm, cy: Mm, radius: Mm) {
    let n = 32;
    let points = (0..n)
        .map(|i| {
            let angle = i as f32 / n as f32 * 2.0 * PI;
            Point::new(
                Mm(cx.0 + radius.0 * angle.cos()),
                Mm(cy.0 + radius.0 * angle.sin()),
            )
        })
        .collect();
    ops.push(Op::DrawLine {
        line: polyline(points, true),
    });
}
