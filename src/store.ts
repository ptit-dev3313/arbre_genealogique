import type { User } from "@supabase/supabase-js";
import { create } from "zustand";
import {
  acquireLock,
  authError,
  deleteCloudFamily,
  deletePersonPhoto,
  heartbeatLock,
  leaveCloudFamily,
  listCloudFamilies,
  publishFamily,
  releaseLock,
  restoreLegacySession,
  saveFamily,
  signedPhotoUrls,
  uploadPersonPhoto,
} from "./lib/cloud";
import { t, type Lang, type Msg } from "./lib/i18n";
import { layoutFromViewport } from "./lib/layoutMode";
import { buildLayout, cameraCenterOn, cameraFit, type Camera } from "./lib/layout";
import { downloadSchematicPdf } from "./lib/pdf";
import { exportFamilyZip } from "./lib/bundle";
import {
  boxesOverlap,
  canDeletePerson,
  canEditCurrentTree,
  canEditPerson,
  canManageFamily,
  createFamily,
  createTree,
  currentTree,
  DEFAULT_COUPLE_COLOR,
  detachCloud,
  findCouple,
  findFreeCell,
  suggestedChildCell,
  isCloud,
  isCloudMember,
  isOwner,
  mutateBlock,
  newId,
  normalizeFamily,
  normalizeLabels,
  occupies,
  preferEditableTree,
  personIsInCouple,
  snapRow,
  uniqueTreeName,
  validateFamilyName,
  type Couple,
  type FamilyDoc,
  type PeopleClip,
  type Person,
  type Placement,
} from "./lib/model";
import { urlToJpegDataUrl } from "./lib/photo";
import { cloudConfigured, supabase } from "./lib/supabase";
import { loadLang, loadShowPhotos, loadWorkspace, saveLang, saveShowPhotos, saveWorkspace } from "./lib/storage";

export type Modal =
  | { kind: "auth" }
  | { kind: "account" }
  | { kind: "password" }
  | { kind: "person"; personId?: string; childOf?: string; partnerOf?: string }
  | { kind: "share" }
  | { kind: "display" }
  | { kind: "confirm"; message: string; action: () => void }
  | { kind: "message"; message: string };

type Store = {
  ready: boolean;
  families: FamilyDoc[];
  currentId: string;
  lang: Lang;
  showPhotos: boolean;
  viewing: boolean;
  selected: string[];
  selectedCouple?: string;
  placingId?: string;
  dropPreview?: { id: string; col: number; row: number };
  pickChildFor?: string;
  pickPartnerFor?: string;
  status: string;
  modal?: Modal;
  user: User | null;
  saving: boolean;
  dirty: boolean;
  editSeq: number;
  pushFailedSeq?: number;
  lockToken?: string;
  lockHolder?: string;
  photoUrls: Record<string, string>;
  canMutate: () => boolean;
  camera: Camera;
  compact: boolean;
  portrait: boolean;
  sheet?: "people" | "edit" | "family";
  boot: () => Promise<void>;
  persist: () => void;
  family: () => FamilyDoc;
  patchFamily: (fn: (family: FamilyDoc) => FamilyDoc, opts?: { dirty?: boolean }) => void;
  setLang: (lang: Lang) => void;
  setStatus: (key?: Msg | string) => void;
  setModal: (modal?: Modal) => void;
  setViewing: (viewing: boolean) => void;
  setShowPhotos: (show: boolean) => void;
  setCamera: (camera: Camera) => void;
  fitCamera: () => void;
  syncLayout: () => void;
  setSheet: (sheet?: "people" | "edit" | "family") => void;
  selectPerson: (id: string, additive?: boolean) => void;
  selectMany: (ids: string[], additive?: boolean) => void;
  selectCouple: (id?: string) => void;
  clearSelection: () => void;
  switchFamily: (id: string) => Promise<void>;
  addFamily: () => void;
  renameFamily: (name: string) => void;
  deleteFamily: () => Promise<void>;
  addTree: () => void;
  renameTree: (name: string) => void;
  deleteTree: () => void;
  switchTree: (id: string) => void;
  focusPersonOnTree: (treeId: string, personId: string) => void;
  addPerson: (person: Person, placement?: Placement) => string;
  updatePerson: (id: string, person: Person) => void;
  deletePerson: (id: string) => void;
  placePerson: (id: string, col: number, row: number) => boolean;
  unplaceSelected: () => void;
  applyMove: (origins: Record<string, Placement>, dCol: number, dRow: number) => boolean;
  makeCouple: () => void;
  updateCouple: (id: string, patch: Partial<Couple>) => void;
  deleteCouple: (id: string) => void;
  addChild: (coupleId: string, childId: string) => void;
  removeChild: (coupleId: string, childId: string) => void;
  addLabelToSelected: (label: string) => void;
  copyPeople: (wholeTree?: boolean) => Promise<void>;
  pastePeople: () => Promise<void>;
  linkCouple: (a: string, b: string) => void;
  goOnline: () => Promise<void>;
  goOffline: () => Promise<void>;
  pullCloud: () => Promise<void>;
  pushCloud: () => Promise<void>;
  exportPdf: () => Promise<void>;
  exportFamilyJson: () => Promise<void>;
  ensureLock: () => Promise<boolean>;
  refreshPhotos: () => Promise<void>;
};

function cloneFamily(family: FamilyDoc): FamilyDoc {
  return structuredClone(family);
}

let peopleClip: PeopleClip | undefined;

function placeClipPeople(
  get: () => { patchFamily: Store["patchFamily"] },
  people: { origId: string; col?: number; row?: number }[],
  idOf: (item: { origId: string; col?: number; row?: number }) => string,
) {
  get().patchFamily((family) => {
    if (!canEditCurrentTree(family)) return family;
    const tree = currentTree(family);
    const placements = { ...tree.placements };
    let working: FamilyDoc = {
      ...family,
      trees: family.trees.map((item) => (item.id === tree.id ? { ...item, placements } : item)),
    };
    const placed = people.filter((item) => {
      const id = idOf(item);
      return Boolean(id) && Boolean(family.persons[id]) && !(id in placements);
    });
    const anchored = placed.filter((item) => item.col != null && item.row != null);
    const minCol = anchored.length ? Math.min(...anchored.map((item) => item.col!)) : 0;
    const minRow = anchored.length ? Math.min(...anchored.map((item) => item.row!)) : 0;
    const origin = findFreeCell(working, 0, 0, []);
    for (const item of placed) {
      const id = idOf(item);
      let col: number;
      let row: number;
      if (item.col != null && item.row != null) {
        col = origin.col + (item.col - minCol);
        row = snapRow(origin.row + (item.row - minRow));
      } else {
        const free = findFreeCell(working, origin.col, origin.row, []);
        col = free.col;
        row = free.row;
      }
      if (occupies(working, col, row, [])) {
        const free = findFreeCell(working, col, row, []);
        col = free.col;
        row = free.row;
      }
      placements[id] = { col, row };
      working = {
        ...working,
        trees: working.trees.map((treeItem) =>
          treeItem.id === tree.id ? { ...treeItem, placements: { ...placements } } : treeItem,
        ),
      };
    }
    return working;
  });
}

const bootWorkspace = loadWorkspace();

export const useApp = create<Store>((set, get) => ({
  ready: true,
  families: bootWorkspace.families,
  currentId: bootWorkspace.current,
  lang: loadLang(),
  showPhotos: loadShowPhotos(),
  viewing: false,
  selected: [],
  selectedCouple: undefined,
  placingId: undefined,
  dropPreview: undefined,
  pickChildFor: undefined,
  pickPartnerFor: undefined,
  status: "",
  modal: undefined,
  user: null,
  saving: false,
  dirty: false,
  editSeq: 0,
  pushFailedSeq: undefined,
  photoUrls: {},
  camera: { x: 24, y: 24, scale: 1 },
  compact: layoutFromViewport(window.innerWidth, window.innerHeight).compact,
  portrait: layoutFromViewport(window.innerWidth, window.innerHeight).portrait,
  sheet: undefined,

  family: () => {
    const { families, currentId } = get();
    return families.find((item) => item.id === currentId) ?? families[0] ?? createFamily("Famille");
  },

  persist: () => {
    const { families, currentId } = get();
    if (!families.length) return;
    saveWorkspace(families, currentId);
  },

  canMutate: () => !mutateBlock(get().family(), get().user, get().lockToken, get().lockHolder),

  patchFamily: (fn, opts) => {
    const dirty = opts?.dirty !== false;
    if (dirty) {
      const block = mutateBlock(get().family(), get().user, get().lockToken, get().lockHolder);
      if (block) {
        get().setStatus(block);
        if (!get().lockToken) void get().ensureLock();
        return;
      }
    }
    const { families, currentId } = get();
    const next = families.map((family) => (family.id === currentId ? normalizeFamily(fn(cloneFamily(family))) : family));
    set({ families: next, dirty: dirty ? true : get().dirty, editSeq: dirty ? get().editSeq + 1 : get().editSeq });
    get().persist();
  },

  setLang: (lang) => {
    saveLang(lang);
    set({ lang });
  },

  setStatus: (key) => {
    if (!key) {
      set({ status: "" });
      return;
    }
    const known: Msg[] = [
      "saving",
      "saved",
      "local",
      "offline",
      "busyLock",
      "needLock",
      "needOnline",
      "noAccess",
      "needTwo",
      "linked",
      "copied",
      "pasted",
      "pasteNothing",
      "alreadyOnTree",
      "copyEmpty",
    ];
    set({ status: known.includes(key as Msg) ? t(get().lang, key as Msg) : key });
  },

  setModal: (modal) => set({ modal }),
  setViewing: (viewing) => {
    set({ viewing, selected: [], selectedCouple: undefined, placingId: undefined, sheet: undefined });
    if (viewing) window.setTimeout(() => get().fitCamera(), 50);
    else void get().ensureLock();
  },
  setShowPhotos: (show) => {
    saveShowPhotos(show);
    set({ showPhotos: show });
  },
  setCamera: (camera) => set({ camera }),
  syncLayout: () => {
    const next = layoutFromViewport(window.innerWidth, window.innerHeight);
    const prev = get();
    if (prev.compact === next.compact && prev.portrait === next.portrait) return;
    set({ compact: next.compact, portrait: next.portrait, sheet: next.compact ? prev.sheet : undefined });
    window.setTimeout(() => get().fitCamera(), 50);
  },
  setSheet: (sheet) => set({ sheet: get().compact ? sheet : undefined }),
  fitCamera: () => {
    const el = document.getElementById("tree-viewport");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    set({ camera: cameraFit(buildLayout(get().family()), rect.width, rect.height) });
  },

  selectPerson: (id, additive) => {
    set((state) => {
      if (additive) {
        const selected = state.selected.includes(id)
          ? state.selected.filter((item) => item !== id)
          : [...state.selected, id];
        return { selected, selectedCouple: undefined };
      }
      if (state.selected.includes(id)) return { selectedCouple: undefined };
      return { selected: [id], selectedCouple: undefined };
    });
  },
  selectMany: (ids, additive) => {
    set((state) => {
      if (additive) {
        const next = [...state.selected];
        for (const id of ids) {
          if (!next.includes(id)) next.push(id);
        }
        return { selected: next, selectedCouple: undefined };
      }
      return { selected: ids, selectedCouple: undefined };
    });
  },
  selectCouple: (id) => {
    if (!id) {
      set({ selectedCouple: undefined });
      return;
    }
    const couple = get().family().couples.find((item) => item.id === id);
    if (!couple) {
      set({ selectedCouple: undefined });
      return;
    }
    const keep = get().selected.find((pid) => pid === couple.person1 || pid === couple.person2);
    set({
      selectedCouple: id,
      selected: [keep ?? couple.person1],
    });
  },
  clearSelection: () =>
    set({ selected: [], selectedCouple: undefined, placingId: undefined, pickChildFor: undefined, pickPartnerFor: undefined, dropPreview: undefined }),

  switchFamily: async (id) => {
    await get().pushCloud();
    const lock = get().lockToken;
    const prev = get().family();
    if (lock && prev.cloudId) await releaseLock(prev.cloudId, lock);
    set({ currentId: id, selected: [], selectedCouple: undefined, lockToken: undefined, lockHolder: undefined, dirty: false });
    get().persist();
    await get().ensureLock();
    await get().refreshPhotos();
    window.setTimeout(() => get().fitCamera(), 50);
  },

  addFamily: () => {
    const lock = get().lockToken;
    const prev = get().family();
    if (lock && prev.cloudId) void releaseLock(prev.cloudId, lock);
    const family = createFamily("Famille");
    set((state) => ({
      families: [...state.families, family],
      currentId: family.id,
      lockToken: undefined,
      lockHolder: undefined,
      dirty: false,
    }));
    get().persist();
    window.setTimeout(() => get().fitCamera(), 50);
  },

  renameFamily: (name) => {
    if (!canManageFamily(get().family())) return;
    get().patchFamily((family) => ({ ...family, name: validateFamilyName(name) }));
  },

  deleteFamily: async () => {
    const family = get().family();
    if (family.cloudId && get().user) {
      try {
        if (isOwner(family)) await deleteCloudFamily(family.cloudId);
        else await leaveCloudFamily(family.cloudId);
      } catch (err) {
        set({ status: authError(err) });
      }
    }
    set((state) => {
      let families = state.families.filter((item) => item.id !== family.id);
      if (!families.length) families = [createFamily("Famille")];
      return { families, currentId: families[0].id, selected: [] };
    });
    get().persist();
  },

  addTree: () => {
    if (!canManageFamily(get().family())) return;
    get().patchFamily((family) => {
      const tree = createTree(uniqueTreeName(family.trees, "Nouvel arbre"));
      return { ...family, trees: [...family.trees, tree], currentTree: tree.id };
    });
    window.setTimeout(() => get().fitCamera(), 50);
  },

  renameTree: (name) => {
    get().patchFamily((family) => {
      if (!canEditCurrentTree(family)) return family;
      return {
        ...family,
        trees: family.trees.map((tree) => (tree.id === family.currentTree ? { ...tree, name } : tree)),
      };
    });
  },

  deleteTree: () => {
    if (!canManageFamily(get().family())) return;
    get().patchFamily((family) => {
      if (family.trees.length <= 1) return family;
      const trees = family.trees.filter((tree) => tree.id !== family.currentTree);
      return { ...family, trees, currentTree: trees[0].id };
    });
    window.setTimeout(() => get().fitCamera(), 50);
  },

  switchTree: (id) => {
    get().patchFamily((item) => ({ ...item, currentTree: id }), { dirty: false });
    set({ selected: [], selectedCouple: undefined });
    get().persist();
    window.setTimeout(() => get().fitCamera(), 50);
  },

  focusPersonOnTree: (treeId, personId) => {
    const family = get().family();
    const tree = family.trees.find((item) => item.id === treeId);
    if (!tree || !(personId in tree.placements)) return;
    if (family.currentTree !== treeId) {
      get().patchFamily((item) => ({ ...item, currentTree: treeId }), { dirty: false });
      get().persist();
    }
    set({ selected: [personId], selectedCouple: undefined, placingId: undefined });
    const el = document.getElementById("tree-viewport");
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.width < 40 || box.height < 40) return;
    const camera = cameraCenterOn(buildLayout(get().family()), personId, box.width, box.height, get().camera.scale);
    if (camera) set({ camera });
  },

  addPerson: (person, placement) => {
    const id = newId();
    get().patchFamily((item) => {
      const next = { ...item, persons: { ...item.persons, [id]: person } };
      if (placement && canEditCurrentTree(next)) {
        const tree = currentTree(next);
        const snapped = { col: placement.col, row: snapRow(placement.row) };
        if (!occupies(next, snapped.col, snapped.row, [id])) {
          next.trees = next.trees.map((treeItem) =>
            treeItem.id === tree.id ? { ...treeItem, placements: { ...treeItem.placements, [id]: snapped } } : treeItem,
          );
        }
      }
      return next;
    });
    return id;
  },

  updatePerson: (id, person) => {
    const prevPath = get().family().persons[id]?.photo?.path;
    get().patchFamily((family) => {
      if (!canEditPerson(family, id) && isCloud(family)) return family;
      return { ...family, persons: { ...family.persons, [id]: person } };
    });
    if (prevPath && !person.photo?.data && !person.photo?.path) void deletePersonPhoto(prevPath);
  },

  deletePerson: (id) => {
    const family = get().family();
    if (!canDeletePerson(family, id) || personIsInCouple(family, id)) {
      if (personIsInCouple(family, id)) get().setStatus("linked");
      return;
    }
    const path = family.persons[id]?.photo?.path;
    get().patchFamily((item) => {
      if (!canDeletePerson(item, id)) return item;
      if (personIsInCouple(item, id)) return item;
      const persons = { ...item.persons };
      delete persons[id];
      return {
        ...item,
        persons,
        trees: item.trees.map((tree) => {
          const placements = { ...tree.placements };
          delete placements[id];
          return { ...tree, placements };
        }),
      };
    });
    if (path) void deletePersonPhoto(path);
    set((state) => ({ selected: state.selected.filter((item) => item !== id) }));
  },

  placePerson: (id, col, row) => {
    let ok = false;
    get().patchFamily((family) => {
      if (!family.persons[id] || !canEditCurrentTree(family)) return family;
      const snapped = snapRow(row);
      if (occupies(family, col, snapped, [id])) return family;
      ok = true;
      const tree = currentTree(family);
      return {
        ...family,
        trees: family.trees.map((item) =>
          item.id === tree.id ? { ...item, placements: { ...item.placements, [id]: { col, row: snapped } } } : item,
        ),
      };
    });
    set({
      placingId: undefined,
      dropPreview: undefined,
      ...(get().compact ? { selected: [], selectedCouple: undefined, sheet: undefined } : {}),
    });
    return ok;
  },

  unplaceSelected: () => {
    const ids = get().selected;
    get().patchFamily((family) => {
      if (!canEditCurrentTree(family)) return family;
      const tree = currentTree(family);
      const placements = { ...tree.placements };
      for (const id of ids) delete placements[id];
      return { ...family, trees: family.trees.map((item) => (item.id === tree.id ? { ...item, placements } : item)) };
    });
  },

  applyMove: (origins, dCol, dRow) => {
    if (!dCol && !dRow) return false;
    let ok = true;
    get().patchFamily((family) => {
      if (!canEditCurrentTree(family)) {
        ok = false;
        return family;
      }
      const ids = Object.keys(origins);
      const proposed = ids.map((id) => ({
        id,
        col: origins[id].col + dCol,
        row: snapRow(origins[id].row + dRow),
      }));
      for (let i = 0; i < proposed.length; i++) {
        for (let j = i + 1; j < proposed.length; j++) {
          if (boxesOverlap(proposed[i].col, proposed[i].row, proposed[j].col, proposed[j].row)) {
            ok = false;
            return family;
          }
        }
      }
      const tree = currentTree(family);
      for (const item of proposed) {
        if (occupies(family, item.col, item.row, ids)) {
          ok = false;
          return family;
        }
      }
      const next = { ...tree.placements };
      for (const item of proposed) next[item.id] = { col: item.col, row: item.row };
      return {
        ...family,
        trees: family.trees.map((item) => (item.id === tree.id ? { ...item, placements: next } : item)),
      };
    });
    return ok;
  },

  makeCouple: () => {
    const ids = get().selected;
    if (ids.length !== 2) {
      set({ status: t(get().lang, "needTwo") });
      return;
    }
    get().linkCouple(ids[0], ids[1]);
    set({ selected: [], selectedCouple: undefined });
  },

  linkCouple: (a, b) => {
    if (a === b) return;
    get().patchFamily((family) => {
      if (findCouple(family, a, b)) return family;
      const couple: Couple = {
        id: newId(),
        person1: a,
        person2: b,
        status: "Marié",
        childrens: [],
        color: DEFAULT_COUPLE_COLOR,
      };
      return { ...family, couples: [...family.couples, couple] };
    });
  },

  updateCouple: (id, patch) => {
    get().patchFamily((family) => ({
      ...family,
      couples: family.couples.map((couple) => (couple.id === id ? { ...couple, ...patch } : couple)),
    }));
  },

  deleteCouple: (id) => {
    get().patchFamily((family) => ({ ...family, couples: family.couples.filter((couple) => couple.id !== id) }));
    set({ selectedCouple: undefined });
  },

  addChild: (coupleId, childId) => {
    get().patchFamily((family) => ({
      ...family,
      couples: family.couples.map((couple) =>
        couple.id === coupleId && !couple.childrens.includes(childId)
          ? { ...couple, childrens: [...couple.childrens, childId] }
          : couple,
      ),
    }));
    const family = get().family();
    const cell = family.couples.find((c) => c.id === coupleId);
    if (cell) {
      const pos = currentTree(family).placements[childId];
      if (!pos) {
        const suggested = suggestedChildCell(family, coupleId) ?? findFreeCell(family, 0, 0, []);
        get().placePerson(childId, suggested.col, suggested.row);
      }
    }
    set({ pickChildFor: undefined });
  },

  removeChild: (coupleId, childId) => {
    get().patchFamily((family) => ({
      ...family,
      couples: family.couples.map((couple) =>
        couple.id === coupleId
          ? { ...couple, childrens: couple.childrens.filter((id) => id !== childId) }
          : couple,
      ),
    }));
  },

  addLabelToSelected: (label) => {
    const ids = get().selected;
    get().patchFamily((family) => {
      const persons = { ...family.persons };
      for (const id of ids) {
        const person = persons[id];
        if (!person) continue;
        if (isCloud(family) && !canEditPerson(family, id)) continue;
        persons[id] = { ...person, labels: normalizeLabels([...person.labels, label]) };
      }
      return { ...family, persons };
    });
  },

  copyPeople: async (wholeTree) => {
    const family = get().family();
    const tree = currentTree(family);
    const ids = (wholeTree || get().selected.length === 0 ? Object.keys(tree.placements) : get().selected).filter(
      (id) => family.persons[id],
    );
    if (!ids.length) {
      get().setStatus("copyEmpty");
      return;
    }
    const people = [];
    for (const origId of ids) {
      const person = family.persons[origId];
      const pos = tree.placements[origId];
      let photoData = person.photo?.data;
      if (!photoData && person.photo?.path) {
        let url = get().photoUrls[person.photo.path];
        if (!url) url = (await signedPhotoUrls([person.photo.path]))[person.photo.path];
        if (url) photoData = await urlToJpegDataUrl(url);
      }
      people.push({
        origId,
        name: person.name,
        family_name: person.family_name,
        labels: [...person.labels],
        photoData,
        col: pos?.col,
        row: pos?.row,
      });
    }
    const idSet = new Set(ids);
    peopleClip = {
      familyId: family.cloudId ?? family.id,
      people,
      couples: family.couples.flatMap((couple) => {
        if (!idSet.has(couple.person1) || !idSet.has(couple.person2)) return [];
        return [
          {
            person1: couple.person1,
            person2: couple.person2,
            status: couple.status,
            color: couple.color,
            childrens: couple.childrens.filter((id) => idSet.has(id)),
          },
        ];
      }),
    };
    set({ status: t(get().lang, "copied") });
  },

  pastePeople: async () => {
    const clip = peopleClip;
    if (!clip?.people.length) {
      get().setStatus("pasteNothing");
      return;
    }
    const dest = get().family();
    if (!get().canMutate() || !canEditCurrentTree(dest)) {
      get().setStatus("noAccess");
      return;
    }
    const sameFamily = dest.id === clip.familyId || dest.cloudId === clip.familyId;
    if (sameFamily) {
      const tree = currentTree(dest);
      const toPlace = clip.people.filter((item) => dest.persons[item.origId] && !(item.origId in tree.placements));
      if (!toPlace.length) {
        get().setStatus("alreadyOnTree");
        return;
      }
      placeClipPeople(get, toPlace, (item) => item.origId);
      set({ status: t(get().lang, "pasted") });
      return;
    }
    const map = new Map<string, string>();
    get().patchFamily((family) => {
      const persons = { ...family.persons };
      for (const item of clip.people) {
        const id = newId();
        map.set(item.origId, id);
        persons[id] = {
          name: item.name,
          family_name: item.family_name,
          labels: item.labels,
          photo: item.photoData ? { data: item.photoData, rev: String(Date.now()) } : undefined,
        };
      }
      const couples = [...family.couples];
      for (const couple of clip.couples) {
        const person1 = map.get(couple.person1);
        const person2 = map.get(couple.person2);
        if (!person1 || !person2) continue;
        couples.push({
          id: newId(),
          person1,
          person2,
          status: couple.status,
          color: couple.color,
          childrens: couple.childrens.flatMap((id) => {
            const next = map.get(id);
            return next ? [next] : [];
          }),
        });
      }
      return { ...family, persons, couples };
    });
    placeClipPeople(
      get,
      clip.people,
      (item) => map.get(item.origId) ?? "",
    );
    set({ status: t(get().lang, "pasted") });
  },

  goOnline: async () => {
    if (!get().user) {
      set({ modal: { kind: "auth" } });
      return;
    }
    const family = get().family();
    const snapshotSeq = get().editSeq;
    set({ saving: true });
    try {
      if (family.lastCloudId && !family.cloudId) {
        const restored = {
          ...family,
          cloudId: family.lastCloudId,
          cloudRole: family.lastCloudRole ?? ("owner" as const),
          lastCloudId: undefined,
          lastCloudRole: undefined,
        };
        set((state) => ({
          families: state.families.map((item) => (item.id === state.currentId ? restored : item)),
        }));
      }
      const current = get().family();
      if (current.cloudId) {
        const ok = await get().ensureLock();
        if (!ok) {
          set({ saving: false, status: t(get().lang, "busyLock") });
          return;
        }
      }
      const toSave = get().family();
      for (const [id, person] of Object.entries(toSave.persons)) {
        if (person.photo?.data) {
          const path = await uploadPersonPhoto(toSave.cloudId ?? toSave.id, id, person.photo.data);
          person.photo = { path, rev: String(Date.now()) };
        }
      }
      const published = toSave.cloudId
        ? await saveFamily(toSave, get().lockToken)
        : await (async () => {
            try {
              const lock = await acquireLock(toSave.id);
              if (lock.kind === "acquired") set({ lockToken: lock.token, lockHolder: undefined });
              return await saveFamily({ ...toSave, cloudId: toSave.id }, get().lockToken);
            } catch {
              return publishFamily(toSave);
            }
          })();
      const seq = snapshotSeq;
      set((state) => {
        const newer = state.editSeq !== seq;
        return {
          families: state.families.map((item) => {
            if (item.id !== state.currentId && item.id !== published.id) return item;
            if (newer) return { ...item, cloudUpdatedAt: published.cloudUpdatedAt, cloudId: published.cloudId, lastCloudId: undefined, lastCloudRole: undefined };
            return { ...published, lastCloudId: undefined, lastCloudRole: undefined };
          }),
          currentId: newer ? state.currentId : published.id,
          dirty: newer,
          saving: false,
          status: t(state.lang, "saved"),
        };
      });
      get().persist();
      await get().ensureLock();
      await get().refreshPhotos();
      if (get().dirty) void get().pushCloud();
    } catch (err) {
      set({ saving: false, status: authError(err) });
    }
  },

  goOffline: async () => {
    const family = get().family();
    const cloudId = family.cloudId;
    const lock = get().lockToken;
    if (lock && cloudId) {
      try {
        await releaseLock(cloudId, lock);
      } catch {
        /* still detach locally */
      }
    }
    const detached = normalizeFamily(detachCloud(cloneFamily(family)));
    set((state) => ({
      families: state.families.map((item) => (item.id === state.currentId ? detached : item)),
      lockToken: undefined,
      lockHolder: undefined,
      dirty: false,
      saving: false,
      modal: state.modal?.kind === "share" ? undefined : state.modal,
    }));
    get().persist();
  },

  pullCloud: async () => {
    if (!get().user) return;
    try {
      const remote = await listCloudFamilies();
      set((state) => {
        const byCloud = new Map(state.families.filter((item) => item.cloudId).map((item) => [item.cloudId!, item]));
        const merged = [...state.families];
        for (const family of remote) {
          const existing = byCloud.get(family.cloudId!);
          const localCopy = merged.find((item) => item.id === family.cloudId || item.id === family.id);
          if (!existing && localCopy && !localCopy.cloudId) continue;
          if (!existing) merged.push(family);
          else {
            const index = merged.findIndex((item) => item.id === existing.id);
            if (state.dirty && existing.id === state.currentId) {
              merged[index] = preferEditableTree({
                ...existing,
                cloudUpdatedAt: family.cloudUpdatedAt,
                cloudRole: family.cloudRole,
                cloudEditableTrees: family.cloudEditableTrees,
                cloudCanEditGap: family.cloudCanEditGap,
                cloudCanEditColors: family.cloudCanEditColors,
                cloudCanEditCardSize: family.cloudCanEditCardSize,
                cloudUserId: family.cloudUserId,
              });
            } else {
              merged[index] = { ...preferEditableTree(family), id: existing.id };
            }
          }
        }
        const remoteIds = new Set(remote.map((item) => item.cloudId).filter((id): id is string => Boolean(id)));
        const userId = state.user?.id;
        return {
          families: merged.map((item) => {
            if (!item.cloudId || remoteIds.has(item.cloudId)) return item;
            return { ...item, cloudRole: undefined, cloudUserId: userId };
          }),
        };
      });
      get().persist();
      await get().refreshPhotos();
    } catch (err) {
      set({ status: authError(err) });
    }
  },

  pushCloud: async () => {
    const family = get().family();
    if (!get().user || !family.cloudId || !get().dirty || get().saving) return;
    if (get().pushFailedSeq === get().editSeq) return;
    if (!get().lockToken) {
      const ok = await get().ensureLock();
      if (!ok || !get().lockToken) return;
    }
    const snapshotSeq = get().editSeq;
    set({ saving: true });
    try {
      const next = cloneFamily(family);
      const uploaded: Record<string, string> = {};
      for (const [id, person] of Object.entries(next.persons)) {
        if (person.photo?.data) {
          const path = await uploadPersonPhoto(next.cloudId ?? next.id, id, person.photo.data);
          uploaded[path] = person.photo.data;
          person.photo = { path, rev: String(Date.now()) };
        }
      }
      const saved = await saveFamily(next, get().lockToken);
      const seq = snapshotSeq;
      set((state) => {
        const newer = state.editSeq !== seq;
        return {
          families: state.families.map((item) => {
            if (item.id !== state.currentId) return item;
            if (newer) return { ...item, cloudUpdatedAt: saved.cloudUpdatedAt, cloudId: saved.cloudId };
            return { ...saved, id: item.id };
          }),
          dirty: newer,
          saving: false,
          status: t(state.lang, "saved"),
          photoUrls: { ...state.photoUrls, ...uploaded },
          pushFailedSeq: undefined,
        };
      });
      get().persist();
      await get().refreshPhotos();
      if (get().dirty) void get().pushCloud();
    } catch (err) {
      set({
        saving: false,
        status: authError(err),
        pushFailedSeq: snapshotSeq,
      });
    }
  },

  exportPdf: async () => {
    const family = get().family();
    try {
      await downloadSchematicPdf(family, get().showPhotos, get().photoUrls);
      set({ status: t(get().lang, "pdfSaved") });
    } catch (err) {
      set({ status: err instanceof Error && err.message === "empty" ? t(get().lang, "pdfEmpty") : authError(err) });
    }
  },

  exportFamilyJson: async () => {
    try {
      const family = get().family();
      const urls = { ...get().photoUrls };
      const missing = Object.values(family.persons)
        .map((person) => person.photo?.path)
        .filter((path): path is string => typeof path === "string" && path.length > 0 && !urls[path]);
      if (missing.length) Object.assign(urls, await signedPhotoUrls(missing));
      const zip = await exportFamilyZip(family, urls);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zip);
      a.download = `${family.name || "famille"}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      set({ status: t(get().lang, "exportJson") });
    } catch (err) {
      set({ status: authError(err) });
    }
  },

  ensureLock: async () => {
    const family = get().family();
    if (!get().user || !family.cloudId) return false;
    if (!isCloudMember(family, get().user)) return false;
    try {
      const held = get().lockToken;
      if (held) {
        const beat = await heartbeatLock(family.cloudId, held);
        if (beat === "ok") {
          set({ lockHolder: undefined });
          return true;
        }
        set({ lockToken: undefined });
      }
      if (get().viewing) return false;
      const result = await acquireLock(family.cloudId);
      if (result.kind === "acquired") {
        set({ lockToken: result.token, lockHolder: undefined });
        return true;
      }
      set({ lockToken: undefined, lockHolder: result.username, status: t(get().lang, "busyLock") });
      return false;
    } catch (err) {
      set({ status: authError(err) });
      return false;
    }
  },

  refreshPhotos: async () => {
    const family = get().family();
    const paths = Object.values(family.persons)
      .map((person) => person.photo?.path)
      .filter((path): path is string => Boolean(path));
    if (!paths.length) return;
    const urls = await signedPhotoUrls(paths);
    set((state) => ({ photoUrls: { ...state.photoUrls, ...urls } }));
  },

  boot: async () => {
    if (!cloudConfigured) return;
    try {
      await restoreLegacySession();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      set({ user: session?.user ?? null });
      if (session) {
        await get().pullCloud();
        await get().ensureLock();
      }
      supabase.auth.onAuthStateChange((event, next) => {
        if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;
        set({ user: next?.user ?? null });
        if (next?.user) {
          void (async () => {
            await get().pullCloud();
            await get().ensureLock();
          })();
        } else {
          const lock = get().lockToken;
          const current = get().family();
          if (lock && current.cloudId) void releaseLock(current.cloudId, lock);
          set({ lockToken: undefined, lockHolder: undefined });
        }
      });
    } catch (err) {
      set({ ready: true, status: authError(err) });
    }
  },
}));

void 0;

export async function heartbeatLoop() {
  const state = useApp.getState();
  const current = state.family();
  if (!state.user || !current.cloudId) return;
  if (state.lockToken) {
    const result = await heartbeatLock(current.cloudId, state.lockToken);
    if (result === "ok") return;
    useApp.setState({ lockToken: undefined, lockHolder: undefined });
  }
  const fresh = useApp.getState();
  if (!fresh.viewing) await fresh.ensureLock();
}
