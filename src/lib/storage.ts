import { createFamily, familyForLocalStore, normalizeFamily, type FamilyDoc } from "./model";

const WORKSPACE_KEY = "arbre.local.v1";
const LANG_KEY = "arbre.lang.v1";
const PHOTOS_KEY = "arbre.show-photos.v1";

export type Workspace = { families: FamilyDoc[]; current: string };

export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) {
      const family = createFamily("Famille");
      return { families: [family], current: family.id };
    }
    const parsed = JSON.parse(raw) as Workspace;
    if (!Array.isArray(parsed.families) || !parsed.families.length) {
      const family = createFamily("Famille");
      return { families: [family], current: family.id };
    }
    const families = parsed.families.map((item) => {
      try {
        return normalizeFamily(item);
      } catch {
        return createFamily(typeof item?.name === "string" ? item.name : "Famille");
      }
    });
    const current = families.some((item) => item.id === parsed.current) ? parsed.current : families[0].id;
    return { families, current };
  } catch {
    const family = createFamily("Famille");
    return { families: [family], current: family.id };
  }
}

export function saveWorkspace(families: FamilyDoc[], current: string) {
  const payload: Workspace = {
    current,
    families: families.map(familyForLocalStore),
  };
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(payload));
}

export function loadLang(): "fr" | "en" {
  return localStorage.getItem(LANG_KEY) === "en" ? "en" : "fr";
}

export function saveLang(lang: "fr" | "en") {
  localStorage.setItem(LANG_KEY, lang);
}

export function loadShowPhotos(): boolean {
  return localStorage.getItem(PHOTOS_KEY) !== "0";
}

export function saveShowPhotos(show: boolean) {
  localStorage.setItem(PHOTOS_KEY, show ? "1" : "0");
}
