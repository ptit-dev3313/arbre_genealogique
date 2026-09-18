use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Une carte occupe 4 pas : 1 pas = un quart de case.
pub const PERSON_SPAN: i32 = 4;

fn legacy_grid_span() -> i32 {
    2
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Person {
    pub name: String,
    pub family_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row: Option<i32>,
}

impl Person {
    pub fn label(&self) -> String {
        format!("{} {}", self.family_name, self.name)
    }

    pub fn grid_pos(&self) -> Option<(i32, i32)> {
        Some((self.col?, self.row?))
    }

    pub fn is_placed(&self) -> bool {
        self.col.is_some() && self.row.is_some()
    }

    pub fn unplace(&mut self) {
        self.col = None;
        self.row = None;
    }

    pub fn place(&mut self, col: i32, row: i32) {
        self.col = Some(col);
        self.row = Some(snap_row(row));
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CoupleStatus {
    #[serde(rename = "Marié")]
    Married,
    #[serde(rename = "Engagé")]
    Engaged,
    #[serde(rename = "Séparé")]
    Separated,
    #[serde(rename = "Divorcé")]
    Divorced,
}

impl CoupleStatus {
    pub const ALL: [CoupleStatus; 4] = [
        CoupleStatus::Married,
        CoupleStatus::Engaged,
        CoupleStatus::Separated,
        CoupleStatus::Divorced,
    ];

    pub fn label(self) -> &'static str {
        match self {
            CoupleStatus::Married => "Marié",
            CoupleStatus::Engaged => "Engagé",
            CoupleStatus::Separated => "Séparé",
            CoupleStatus::Divorced => "Divorcé",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Couple {
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub person1: Uuid,
    pub person2: Uuid,
    pub status: CoupleStatus,
    #[serde(default)]
    pub childrens: Vec<Uuid>,
    #[serde(default)]
    pub color: Option<String>,
}

impl Couple {
    pub fn new(person1: Uuid, person2: Uuid) -> Self {
        Self {
            id: Uuid::new_v4(),
            person1,
            person2,
            status: CoupleStatus::Married,
            childrens: Vec::new(),
            color: None,
        }
    }

    pub fn pair(&self) -> (Uuid, Uuid) {
        if self.person1.as_u128() <= self.person2.as_u128() {
            (self.person1, self.person2)
        } else {
            (self.person2, self.person1)
        }
    }

    pub fn involves(&self, person_id: Uuid) -> bool {
        self.person1 == person_id
            || self.person2 == person_id
            || self.childrens.contains(&person_id)
    }

    pub fn is_pair(&self, a: Uuid, b: Uuid) -> bool {
        self.pair() == {
            if a.as_u128() <= b.as_u128() {
                (a, b)
            } else {
                (b, a)
            }
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Data {
    #[serde(default)]
    pub persons: HashMap<Uuid, Person>,
    #[serde(default)]
    pub couples: Vec<Couple>,
    #[serde(default = "legacy_grid_span")]
    pub grid_span: i32,
}

impl Default for Data {
    fn default() -> Self {
        Self {
            persons: HashMap::new(),
            couples: Vec::new(),
            grid_span: PERSON_SPAN,
        }
    }
}

impl Data {
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let text = fs::read_to_string(path.as_ref())
            .with_context(|| format!("Impossible de lire {}", path.as_ref().display()))?;
        let mut data: Data = serde_json::from_str(&text).context("data.json invalide")?;
        data.ensure_couple_ids();
        data.migrate_grid();
        Ok(data)
    }

    pub fn save(&self, path: impl AsRef<Path>) -> Result<()> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("Impossible de créer {}", parent.display()))?;
        }
        let json = serde_json::to_string_pretty(self)?;
        fs::write(path, json)
            .with_context(|| format!("Impossible d'écrire {}", path.display()))?;
        Ok(())
    }

    fn migrate_grid(&mut self) {
        if self.grid_span <= 0 {
            self.grid_span = PERSON_SPAN;
            return;
        }
        if self.grid_span == PERSON_SPAN {
            return;
        }
        let factor = PERSON_SPAN / self.grid_span;
        if factor > 1 {
            for person in self.persons.values_mut() {
                if let Some(col) = person.col {
                    person.col = Some(col * factor);
                }
                if let Some(row) = person.row {
                    person.row = Some(row * factor);
                }
            }
        }
        self.grid_span = PERSON_SPAN;
    }

    fn ensure_couple_ids(&mut self) {
        let mut seen = std::collections::HashSet::new();
        for couple in &mut self.couples {
            if couple.id.is_nil() || !seen.insert(couple.id) {
                couple.id = Uuid::new_v4();
                seen.insert(couple.id);
            }
        }
    }

    pub fn add_person(&mut self, person: Person) -> Uuid {
        let id = Uuid::new_v4();
        self.persons.insert(id, person);
        id
    }

    pub fn sorted_person_ids(&self) -> Vec<Uuid> {
        let mut ids: Vec<Uuid> = self.persons.keys().copied().collect();
        ids.sort_by_key(|id| {
            self.persons
                .get(id)
                .map(|person| (person.family_name.clone(), person.name.clone()))
                .unwrap_or_default()
        });
        ids
    }

    pub fn unplaced_ids(&self) -> Vec<Uuid> {
        self.sorted_person_ids()
            .into_iter()
            .filter(|id| self.persons.get(id).map(|p| !p.is_placed()).unwrap_or(true))
            .collect()
    }

    pub fn placed_ids(&self) -> Vec<Uuid> {
        self.sorted_person_ids()
            .into_iter()
            .filter(|id| self.persons.get(id).map(Person::is_placed).unwrap_or(false))
            .collect()
    }

    pub fn person_is_in_couple(&self, person_id: Uuid) -> bool {
        self.couples.iter().any(|couple| couple.involves(person_id))
    }

    pub fn delete_person(&mut self, person_id: Uuid) -> Result<()> {
        if !self.persons.contains_key(&person_id) {
            anyhow::bail!("Personne introuvable");
        }
        if self.person_is_in_couple(person_id) {
            anyhow::bail!("Cette personne est encore liée à un couple comme parent ou enfant.");
        }
        self.persons.remove(&person_id);
        Ok(())
    }

    pub fn person_label(&self, person_id: Uuid) -> String {
        self.persons
            .get(&person_id)
            .map(Person::label)
            .unwrap_or_else(|| "Personne inconnue".to_string())
    }

    pub fn find_couple(&self, a: Uuid, b: Uuid) -> Option<&Couple> {
        self.couples.iter().find(|couple| couple.is_pair(a, b))
    }

    pub fn couple_mut(&mut self, id: Uuid) -> Option<&mut Couple> {
        self.couples.iter_mut().find(|couple| couple.id == id)
    }

    pub fn couple(&self, id: Uuid) -> Option<&Couple> {
        self.couples.iter().find(|couple| couple.id == id)
    }

    pub fn couples_for_person(&self, person_id: Uuid) -> Vec<Uuid> {
        self.couples
            .iter()
            .filter(|couple| couple.person1 == person_id || couple.person2 == person_id)
            .map(|couple| couple.id)
            .collect()
    }

    pub fn occupies(&self, col: i32, row: i32, ignore: &[Uuid]) -> bool {
        self.persons.iter().any(|(id, person)| {
            if ignore.contains(id) {
                return false;
            }
            let Some((pcol, prow)) = person.grid_pos() else {
                return false;
            };
            boxes_overlap(col, row, pcol, prow)
        })
    }

    pub fn find_free_cell(&self, start_col: i32, start_row: i32, ignore: &[Uuid]) -> (i32, i32) {
        let start_row = snap_row(start_row);
        if !self.occupies(start_col, start_row, ignore) {
            return (start_col, start_row);
        }
        for radius in 1_i32..24 {
            for dc in -radius..=radius {
                for dr_steps in -radius..=radius {
                    if dc.abs() != radius && dr_steps.abs() != radius {
                        continue;
                    }
                    let col = start_col + dc;
                    let row = start_row + dr_steps * PERSON_SPAN;
                    if !self.occupies(col, row, ignore) {
                        return (col, row);
                    }
                }
            }
        }
        (start_col, start_row + PERSON_SPAN)
    }
}

pub fn boxes_overlap(col_a: i32, row_a: i32, col_b: i32, row_b: i32) -> bool {
    col_a < col_b + PERSON_SPAN
        && col_b < col_a + PERSON_SPAN
        && row_a < row_b + PERSON_SPAN
        && row_b < row_a + PERSON_SPAN
}

pub fn snap_row(row: i32) -> i32 {
    ((row as f32 / PERSON_SPAN as f32).round() as i32) * PERSON_SPAN
}

const APP_DATA_DIR: &str = "arbre_genealogique";
const LEGACY_APP_DATA_DIR: &str = "family-tree";
const DATA_FILE: &str = "data.json";

pub fn default_data_path() -> PathBuf {
    let path = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_DATA_DIR)
        .join(DATA_FILE);
    migrate_legacy_data(&path);
    path
}

fn migrate_legacy_data(dest: &Path) {
    if dest.exists() {
        return;
    }

    let next_to_exe = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|parent| parent.join(DATA_FILE)));
    let legacy_appdata = dirs::data_dir().map(|dir| dir.join(LEGACY_APP_DATA_DIR).join(DATA_FILE));

    for src in [PathBuf::from(DATA_FILE)]
        .into_iter()
        .chain(next_to_exe)
        .chain(legacy_appdata)
    {
        if !src.exists() || src == dest {
            continue;
        }
        if let Some(parent) = dest.parent() {
            if fs::create_dir_all(parent).is_err() {
                continue;
            }
        }
        if fs::copy(&src, dest).is_ok() {
            return;
        }
    }
}
