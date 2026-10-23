export const PERSON_SPAN = 4;
export const DEFAULT_COUPLE_COLOR = "#829099";
export const DEFAULT_CONNECTOR_LANE_GAP = 14;
export const DEFAULT_CONNECTOR_BUS_POS = 50;
export const MIN_CONNECTOR_BUS_POS = 0;
export const MAX_CONNECTOR_BUS_POS = 100;
export const DEFAULT_CARD_WIDTH = 112;
export const DEFAULT_CARD_HEIGHT = 86;
export const MIN_CARD_WIDTH = 72;
export const MAX_CARD_WIDTH = 220;
export const MIN_CARD_HEIGHT = 52;
export const MAX_CARD_HEIGHT = 160;
export const DEFAULT_PHOTO_SIZE = 52;
export const MIN_PHOTO_SIZE = 24;
export const MAX_PHOTO_SIZE = 240;
export const MAX_FAMILY_NAME_CHARS = 120;
export const MAX_PERSON_NAME_CHARS = 120;
export const MAX_LABEL_CHARS = 60;
export const MAX_LABELS_PER_PERSON = 30;

export type CoupleStatus = "Marié" | "Engagé" | "Séparé" | "Divorcé";

export const COUPLE_STATUS_KEYS: Record<CoupleStatus, "married" | "engaged" | "separated" | "divorced"> = {
  Marié: "married",
  Engagé: "engaged",
  Séparé: "separated",
  Divorcé: "divorced",
};

export type CloudRole = "owner" | "editor";

export type PersonPhoto = {
  path?: string;
  data?: string;
  rev?: string;
};

export type Person = {
  name: string;
  family_name: string;
  labels: string[];
  photo?: PersonPhoto;
};

export type Placement = { col: number; row: number };

export type Couple = {
  id: string;
  person1: string;
  person2: string;
  status: CoupleStatus;
  childrens: string[];
  color: string;
};

export type TreeDoc = {
  id: string;
  name: string;
  placements: Record<string, Placement>;
};

export type FamilyDoc = {
  id: string;
  name: string;
  persons: Record<string, Person>;
  couples: Couple[];
  trees: TreeDoc[];
  currentTree: string;
  connector_lane_gap: number;
  connector_bus_pos: number;
  card_width: number;
  card_height: number;
  photo_size: number;
  sourced_card_size?: boolean;
  sourced_photo_size?: boolean;
  cloudId?: string;
  cloudRole?: CloudRole;
  cloudUpdatedAt?: string;
  cloudEditableTrees: string[];
  cloudCanEditGap: boolean;
  cloudCanEditColors: boolean;
  cloudCanEditCardSize: boolean;
  cloudUserId?: string;
  lastCloudId?: string;
  lastCloudRole?: CloudRole;
};

export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function personHasPhoto(person: Person): boolean {
  const photo = person.photo;
  return Boolean(photo?.data || photo?.path);
}

export function isCloud(family: FamilyDoc): boolean {
  return Boolean(family.cloudId);
}

export function isOwner(family: FamilyDoc): boolean {
  return isCloud(family) && family.cloudRole === "owner";
}

export function isEditor(family: FamilyDoc): boolean {
  return family.cloudRole === "editor";
}

export function authUserId(user: unknown): string | undefined {
  if (!user || typeof user !== "object" || !("id" in user)) return;
  const id = (user as { id: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

/** Signed-in user is a member of this online family (owner or editor). */
export function isCloudMember(family: FamilyDoc, user: unknown): boolean {
  const userId = authUserId(user);
  if (!isCloud(family) || !userId) return false;
  if (family.cloudUserId && family.cloudUserId !== userId) return false;
  return family.cloudRole === "owner" || family.cloudRole === "editor";
}

export function canManageFamily(family: FamilyDoc): boolean {
  return !isCloud(family) || isOwner(family);
}

export function canEditTree(family: FamilyDoc, treeId: string): boolean {
  if (!isEditor(family)) return true;
  return family.cloudEditableTrees.includes(treeId);
}

export function canEditCurrentTree(family: FamilyDoc): boolean {
  return canEditTree(family, family.currentTree);
}

export function canEditGap(family: FamilyDoc): boolean {
  if (!isEditor(family)) return true;
  return family.cloudCanEditGap;
}

export function canEditCardSize(family: FamilyDoc): boolean {
  if (!isEditor(family)) return true;
  return family.cloudCanEditCardSize;
}

export function canEditDisplay(family: FamilyDoc): boolean {
  return canEditGap(family) || canEditCardSize(family);
}

export function canEditColors(family: FamilyDoc): boolean {
  if (!isEditor(family)) return true;
  return family.cloudCanEditColors;
}

export function mutateBlock(
  family: FamilyDoc,
  user: unknown,
  lockToken: string | undefined,
  lockHolder: string | undefined,
): "needOnline" | "busyLock" | "needLock" | "noAccess" | undefined {
  if (!isCloud(family)) return;
  if (!user) return "needOnline";
  if (!isCloudMember(family, user)) return "noAccess";
  if (lockHolder) return "busyLock";
  if (!lockToken) return "needLock";
}

export function canEditPerson(family: FamilyDoc, personId: string): boolean {
  if (!isEditor(family)) return true;
  return family.trees.some(
    (tree) => canEditTree(family, tree.id) && personId in tree.placements,
  );
}

export function canDeletePerson(family: FamilyDoc, personId: string): boolean {
  if (!isEditor(family)) return true;
  if (!canEditPerson(family, personId)) return false;
  return !family.trees.some(
    (tree) => !canEditTree(family, tree.id) && personId in tree.placements,
  );
}

export function canEditCouple(family: FamilyDoc, couple: Couple): boolean {
  if (!isEditor(family)) return true;
  return canEditPerson(family, couple.person1) || canEditPerson(family, couple.person2);
}

export function detachCloud(family: FamilyDoc): FamilyDoc {
  return {
    ...family,
    lastCloudId: family.cloudId ?? family.lastCloudId,
    lastCloudRole: family.cloudRole ?? family.lastCloudRole,
    cloudId: undefined,
    cloudRole: undefined,
    cloudUpdatedAt: undefined,
    cloudEditableTrees: [],
    cloudUserId: undefined,
    cloudCanEditGap: true,
    cloudCanEditColors: true,
    cloudCanEditCardSize: true,
  };
}

export function clampPhotoSize(size: number): number {
  return Number.isFinite(size) ? Math.min(MAX_PHOTO_SIZE, Math.max(MIN_PHOTO_SIZE, size)) : DEFAULT_PHOTO_SIZE;
}

export function clampCardSize(width: number, height: number): [number, number] {
  const w = Number.isFinite(width) ? Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, width)) : DEFAULT_CARD_WIDTH;
  const h = Number.isFinite(height) ? Math.min(MAX_CARD_HEIGHT, Math.max(MIN_CARD_HEIGHT, height)) : DEFAULT_CARD_HEIGHT;
  return [w, h];
}

export function normalizeHex(raw: string): string {
  const hex = raw.trim().replace(/^#/, "").replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  if (hex.length === 6 || hex.length === 8) return `#${hex.slice(0, 6)}`;
  return DEFAULT_COUPLE_COLOR;
}

export function parsePastedColor(raw: string): string | undefined {
  const text = raw.trim();
  const rgb = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    const hex = [rgb[1], rgb[2], rgb[3]]
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}`;
  }
  const hex = text.replace(/^#/, "").replace(/[^0-9a-fA-F]/g, "");
  if (hex.length === 3 || hex.length === 6) return normalizeHex(`#${hex}`);
}

export function validateText(value: string, field: string, maxChars: number): string {
  const trimmed = value.trim();
  if ([...trimmed].some((ch) => ch.charCodeAt(0) < 32)) {
    throw new Error(`${field} contient des caractères invalides.`);
  }
  if ([...trimmed].length > maxChars) {
    throw new Error(`${field} est limité à ${maxChars} caractères.`);
  }
  return trimmed;
}

export function validatePersonNames(name: string, familyName: string): [string, string] {
  const n = validateText(name, "Le prénom", MAX_PERSON_NAME_CHARS);
  const f = validateText(familyName, "Le nom", MAX_PERSON_NAME_CHARS);
  if (!n && !f) throw new Error("Indiquez au moins un prénom ou un nom.");
  return [n, f];
}

export function validateFamilyName(name: string): string {
  const n = validateText(name, "Le nom de famille", MAX_FAMILY_NAME_CHARS);
  return n || "Famille";
}

export function personLabel(person: Person): string {
  return `${person.family_name} ${person.name}`.trim();
}

export function normalizeLabels(labels: string[]): string[] {
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (!label) continue;
    if (!out.some((item) => item.toLowerCase() === label.toLowerCase())) out.push(label);
  }
  out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return out.slice(0, MAX_LABELS_PER_PERSON).map((label) =>
    [...label].length > MAX_LABEL_CHARS ? [...label].slice(0, MAX_LABEL_CHARS).join("") : label,
  );
}

export function familyLabels(family: FamilyDoc): string[] {
  const labels: string[] = [];
  for (const person of Object.values(family.persons)) {
    for (const label of person.labels) {
      if (!labels.some((item) => item.toLowerCase() === label.toLowerCase())) labels.push(label);
    }
  }
  labels.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return labels;
}

export function personMatchesFilters(person: Person, query: string, labels: string[]): boolean {
  const q = query.trim().toLowerCase();
  const nameOk =
    !q ||
    personLabel(person).toLowerCase().includes(q) ||
    person.labels.some((label) => label.toLowerCase().includes(q));
  const labelsOk =
    labels.length === 0 ||
    labels.some((wanted) => person.labels.some((label) => label.toLowerCase() === wanted.toLowerCase()));
  return nameOk && labelsOk;
}

export function snapRow(row: number): number {
  return Math.round(row / PERSON_SPAN) * PERSON_SPAN;
}

export function boxesOverlap(colA: number, rowA: number, colB: number, rowB: number): boolean {
  return colA < colB + PERSON_SPAN && colB < colA + PERSON_SPAN && rowA < rowB + PERSON_SPAN && rowB < rowA + PERSON_SPAN;
}

export function createTree(name: string): TreeDoc {
  return { id: newId(), name, placements: {} };
}

export function createFamily(name: string): FamilyDoc {
  const tree = createTree("Arbre");
  return normalizeFamily({
    id: newId(),
    name,
    persons: {},
    couples: [],
    trees: [tree],
    currentTree: tree.id,
    connector_lane_gap: DEFAULT_CONNECTOR_LANE_GAP,
    connector_bus_pos: DEFAULT_CONNECTOR_BUS_POS,
    card_width: DEFAULT_CARD_WIDTH,
    card_height: DEFAULT_CARD_HEIGHT,
    photo_size: DEFAULT_PHOTO_SIZE,
    cloudEditableTrees: [],
    cloudCanEditGap: true,
    cloudCanEditColors: true,
    cloudCanEditCardSize: true,
  });
}

export function normalizeFamily(family: FamilyDoc): FamilyDoc {
  const trees = Array.isArray(family?.trees) ? family.trees : [];
  const next: FamilyDoc = {
    ...family,
    id: typeof family?.id === "string" ? family.id : "",
    persons: family?.persons && typeof family.persons === "object" ? family.persons : {},
    couples: Array.isArray(family?.couples) ? family.couples : [],
    trees: trees.map((tree) => ({
      ...tree,
      id: typeof tree?.id === "string" ? tree.id : newId(),
      name: typeof tree?.name === "string" ? tree.name : "Arbre",
      placements: tree?.placements && typeof tree.placements === "object" ? { ...tree.placements } : {},
    })),
  };
  if (!next.id.trim()) next.id = newId();
  try {
    next.name = validateFamilyName(next.name);
  } catch {
    next.name = "Famille";
  }
  if (next.trees.length === 0) next.trees = [createTree("Arbre")];
  for (const tree of next.trees) {
    if (!tree.id.trim()) tree.id = newId();
    if (!tree.name.trim()) tree.name = "Arbre";
  }
  if (!next.trees.some((tree) => tree.id === next.currentTree)) next.currentTree = next.trees[0].id;
  const [width, height] = clampCardSize(next.card_width, next.card_height);
  next.card_width = Math.round(width);
  next.card_height = Math.round(height);
  next.photo_size = Math.round(clampPhotoSize(next.photo_size));
  next.connector_lane_gap = Number.isFinite(next.connector_lane_gap)
    ? Math.round(next.connector_lane_gap)
    : DEFAULT_CONNECTOR_LANE_GAP;
  next.connector_bus_pos = Number.isFinite(next.connector_bus_pos)
    ? Math.min(MAX_CONNECTOR_BUS_POS, Math.max(MIN_CONNECTOR_BUS_POS, Math.round(next.connector_bus_pos)))
    : DEFAULT_CONNECTOR_BUS_POS;
  next.couples = next.couples.map((couple) => ({ ...couple, color: normalizeHex(couple.color) }));
  const persons: Record<string, Person> = {};
  for (const [id, person] of Object.entries(next.persons)) {
    persons[id] = {
      ...person,
      name: safeText(person?.name ?? "", MAX_PERSON_NAME_CHARS),
      family_name: safeText(person?.family_name ?? "", MAX_PERSON_NAME_CHARS),
      labels: normalizeLabels(person?.labels ?? []),
    };
  }
  next.persons = persons;
  return next;
}

function safeText(value: string, max: number): string {
  try {
    return validateText(value, "texte", max);
  } catch {
    return "";
  }
}

export function currentTree(family: FamilyDoc): TreeDoc {
  return family.trees.find((tree) => tree.id === family.currentTree) ?? family.trees[0];
}

export function uniqueTreeName(trees: TreeDoc[], base: string): string {
  if (!trees.some((tree) => tree.name === base)) return base;
  for (let n = 2; n < 1000; n++) {
    const name = `${base} ${n}`;
    if (!trees.some((tree) => tree.name === name)) return name;
  }
  return `${base} ${Date.now()}`;
}

export function sortedPersonIds(family: FamilyDoc): string[] {
  return Object.keys(family.persons).sort((a, b) =>
    personLabel(family.persons[a]).localeCompare(personLabel(family.persons[b])),
  );
}

export function unplacedIds(family: FamilyDoc): string[] {
  const tree = currentTree(family);
  return sortedPersonIds(family).filter((id) => !(id in tree.placements));
}

export function occupies(family: FamilyDoc, col: number, row: number, ignore: string[]): boolean {
  return Object.entries(currentTree(family).placements).some(([id, pos]) => {
    if (ignore.includes(id)) return false;
    return boxesOverlap(col, row, pos.col, pos.row);
  });
}

export function findFreeCell(family: FamilyDoc, startCol: number, startRow: number, ignore: string[]): Placement {
  const row = snapRow(startRow);
  if (!occupies(family, startCol, row, ignore)) return { col: startCol, row };
  for (let radius = 1; radius < 24; radius++) {
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue;
        const col = startCol + dc;
        const nextRow = row + dr * PERSON_SPAN;
        if (!occupies(family, col, nextRow, ignore)) return { col, row: nextRow };
      }
    }
  }
  return { col: startCol, row: row + PERSON_SPAN };
}

export function findFreeCellBelow(family: FamilyDoc, startCol: number, startRow: number, ignore: string[]): Placement {
  const row0 = snapRow(startRow);
  for (let down = 0; down < 20; down++) {
    const row = row0 + down * PERSON_SPAN;
    if (!occupies(family, startCol, row, ignore)) return { col: startCol, row };
    for (let d = 1; d <= 24; d++) {
      if (!occupies(family, startCol + d, row, ignore)) return { col: startCol + d, row };
      if (!occupies(family, startCol - d, row, ignore)) return { col: startCol - d, row };
    }
  }
  return { col: startCol, row: row0 + PERSON_SPAN };
}

export function personIsInCouple(family: FamilyDoc, personId: string): boolean {
  return family.couples.some(
    (couple) => couple.person1 === personId || couple.person2 === personId || couple.childrens.includes(personId),
  );
}

export function couplePair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

export function findCouple(family: FamilyDoc, a: string, b: string): Couple | undefined {
  const pair = couplePair(a, b);
  return family.couples.find((couple) => {
    const p = couplePair(couple.person1, couple.person2);
    return p[0] === pair[0] && p[1] === pair[1];
  });
}

export function parentCouples(family: FamilyDoc, personId: string): Couple[] {
  return family.couples.filter((couple) => couple.childrens.includes(personId));
}

export function couplesForPerson(family: FamilyDoc, personId: string): Couple[] {
  return family.couples.filter((couple) => couple.person1 === personId || couple.person2 === personId);
}

export function treesWithPerson(family: FamilyDoc, personId: string): TreeDoc[] {
  return family.trees.filter((tree) => personId in tree.placements);
}

export function suggestedChildCell(family: FamilyDoc, coupleId: string): Placement | undefined {
  const couple = family.couples.find((item) => item.id === coupleId);
  if (!couple) return;
  const tree = currentTree(family);
  const p1 = tree.placements[couple.person1];
  const p2 = tree.placements[couple.person2];
  if (!p1 || !p2) return;
  const col = Math.round((p1.col + p2.col) / 2);
  const row = snapRow(Math.max(p1.row, p2.row) + PERSON_SPAN);
  return findFreeCellBelow(family, col, row, []);
}

export function suggestedPartnerCell(family: FamilyDoc, personId: string): Placement {
  const pos = currentTree(family).placements[personId];
  if (!pos) return findFreeCell(family, 0, 0, []);
  if (!occupies(family, pos.col + PERSON_SPAN, pos.row, [])) return { col: pos.col + PERSON_SPAN, row: pos.row };
  if (!occupies(family, pos.col - PERSON_SPAN, pos.row, [])) return { col: pos.col - PERSON_SPAN, row: pos.row };
  return findFreeCell(family, pos.col + PERSON_SPAN, pos.row, []);
}

export type ClipPerson = {
  origId: string;
  name: string;
  family_name: string;
  labels: string[];
  photoData?: string;
  col?: number;
  row?: number;
};

export type ClipCouple = {
  person1: string;
  person2: string;
  status: CoupleStatus;
  color: string;
  childrens: string[];
};

export type PeopleClip = {
  familyId: string;
  people: ClipPerson[];
  couples: ClipCouple[];
};

function personsWithoutInlinePhotos(persons: Record<string, Person>): Record<string, Person> {
  const out: Record<string, Person> = {};
  for (const [id, person] of Object.entries(persons)) {
    const next = { ...person };
    if (next.photo) {
      const photo = { ...next.photo, data: undefined };
      next.photo = photo.path ? photo : undefined;
    }
    out[id] = next;
  }
  return out;
}

function personsForDisk(persons: Record<string, Person>): Record<string, Person> {
  const out: Record<string, Person> = {};
  for (const [id, person] of Object.entries(persons)) {
    const next = { ...person };
    if (next.photo?.path) next.photo = { ...next.photo, data: undefined };
    else if (!next.photo?.data) next.photo = undefined;
    out[id] = next;
  }
  return out;
}

export function familyForLocalStore(family: FamilyDoc): FamilyDoc {
  return { ...family, persons: personsForDisk(family.persons) };
}

export function familyToPayload(family: FamilyDoc): Record<string, unknown> {
  const trees = isEditor(family) && family.cloudEditableTrees.length
    ? family.trees.filter((tree) => canEditTree(family, tree.id))
    : family.trees;
  const payload: Record<string, unknown> = {
    persons: personsWithoutInlinePhotos(family.persons),
    couples: family.couples,
    trees: trees.map((tree) => ({
      id: tree.id,
      name: tree.name,
      placements: tree.placements,
    })),
    currentTree: family.currentTree,
  };
  if (!isEditor(family) || canEditGap(family)) {
    payload.connector_lane_gap = Math.round(family.connector_lane_gap);
    payload.connector_bus_pos = Math.round(family.connector_bus_pos);
  }
  if (!isEditor(family) || canEditCardSize(family)) {
    payload.card_width = Math.round(family.card_width);
    payload.card_height = Math.round(family.card_height);
    payload.photo_size = Math.round(family.photo_size);
  }
  return payload;
}

function payloadNum(source: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!source) return;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
}

function unwrapPayload(payload: unknown): Record<string, unknown> | undefined {
  let current: unknown = payload;
  for (let i = 0; i < 4; i++) {
    if (typeof current === "string") {
      try {
        current = JSON.parse(current);
      } catch {
        return;
      }
      continue;
    }
    if (current && typeof current === "object" && !Array.isArray(current)) {
      const obj = current as Record<string, unknown>;
      if ("payload" in obj && !("persons" in obj) && !("card_width" in obj) && !("cardWidth" in obj)) {
        current = obj.payload;
        continue;
      }
      return obj;
    }
    return;
  }
}

export function familyFromRow(
  id: string,
  name: string,
  payload: unknown,
  cloudRole?: CloudRole,
  updatedAt?: string,
): FamilyDoc {
  let family = createFamily(name);
  family = {
    ...family,
    id,
    cloudId: id,
    cloudRole,
    cloudUpdatedAt: updatedAt,
    cloudEditableTrees: [],
  };
  const data = unwrapPayload(payload);
  if (!data) return normalizeFamily(family);
  if (data.persons && typeof data.persons === "object") {
    family.persons = data.persons as Record<string, Person>;
  }
  if (Array.isArray(data.couples)) family.couples = data.couples as Couple[];
  if (Array.isArray(data.trees) && data.trees.length) family.trees = data.trees as TreeDoc[];
  if (typeof data.currentTree === "string") family.currentTree = data.currentTree;
  applyDisplay(family, data);
  if (Array.isArray(data.trees)) {
    for (const tree of data.trees) {
      if (tree && typeof tree === "object") applyDisplay(family, tree as Record<string, unknown>);
    }
  }
  return normalizeFamily(family);
}

function applyDisplay(family: FamilyDoc, source: Record<string, unknown>) {
  const gap = payloadNum(source, ["connector_lane_gap", "connectorLaneGap"]);
  if (gap != null) family.connector_lane_gap = gap;
  const busPos = payloadNum(source, ["connector_bus_pos", "connectorBusPos"]);
  if (busPos != null) family.connector_bus_pos = busPos;
  const width = payloadNum(source, ["card_width", "cardWidth"]);
  const height = payloadNum(source, ["card_height", "cardHeight"]);
  if (width != null) {
    family.card_width = width;
    family.sourced_card_size = true;
  }
  if (height != null) {
    family.card_height = height;
    family.sourced_card_size = true;
  }
  const size = payloadNum(source, ["photo_size", "photoSize"]);
  if (size != null) {
    family.photo_size = size;
    family.sourced_photo_size = true;
  }
}

export function restoreReadonlyDisplay(family: FamilyDoc, payload?: Record<string, unknown>): FamilyDoc {
  if (!payload) return family;
  const next = { ...family };
  if (!canEditCardSize(family)) {
    const width = payloadNum(payload, ["card_width", "cardWidth"]);
    const height = payloadNum(payload, ["card_height", "cardHeight"]);
    const size = payloadNum(payload, ["photo_size", "photoSize"]);
    if (width != null) next.card_width = width;
    if (height != null) next.card_height = height;
    if (size != null) next.photo_size = size;
  }
  if (!canEditGap(family)) {
    const gap = payloadNum(payload, ["connector_lane_gap", "connectorLaneGap"]);
    const bus = payloadNum(payload, ["connector_bus_pos", "connectorBusPos"]);
    if (gap != null) next.connector_lane_gap = gap;
    if (bus != null) next.connector_bus_pos = bus;
  }
  return next;
}

export function remapFamilyIds(family: FamilyDoc): FamilyDoc {
  const familyId = newId();
  const personMap = new Map<string, string>();
  const persons: Record<string, Person> = {};
  for (const [oldId, person] of Object.entries(family.persons)) {
    const id = newId();
    personMap.set(oldId, id);
    const next = { ...person };
    if (next.photo?.data) {
      next.photo = { data: next.photo.data, rev: next.photo.rev ?? String(Date.now()) };
    } else {
      next.photo = undefined;
    }
    persons[id] = next;
  }
  const trees = family.trees.map((tree) => {
    const id = newId();
    const placements: Record<string, Placement> = {};
    for (const [oldId, pos] of Object.entries(tree.placements)) {
      placements[personMap.get(oldId) ?? newId()] = pos;
    }
    return { ...tree, id, placements };
  });
  const treeMap = new Map(family.trees.map((tree, i) => [tree.id, trees[i].id]));
  return detachCloud(
    normalizeFamily({
      ...family,
      id: familyId,
      persons,
      trees,
      currentTree: treeMap.get(family.currentTree) ?? trees[0]?.id ?? newId(),
      couples: family.couples.map((couple) => ({
        ...couple,
        id: newId(),
        person1: personMap.get(couple.person1) ?? newId(),
        person2: personMap.get(couple.person2) ?? newId(),
        childrens: couple.childrens.map((id) => personMap.get(id) ?? newId()),
      })),
    }),
  );
}

export function preferEditableTree(family: FamilyDoc): FamilyDoc {
  if (family.trees.some((tree) => tree.id === family.currentTree)) return family;
  const tree = family.trees.find((item) => canEditTree(family, item.id)) ?? family.trees[0];
  return tree ? { ...family, currentTree: tree.id } : family;
}

export function workspaceToFile(families: FamilyDoc[], current: string): string {
  return JSON.stringify(
    {
      version: 2,
      current,
      families: families.map((family) => ({
        id: family.id,
        name: family.name,
        persons: family.persons,
        couples: family.couples,
        trees: family.trees,
        currentTree: family.currentTree,
        connector_lane_gap: Math.round(family.connector_lane_gap),
        connector_bus_pos: Math.round(family.connector_bus_pos),
        card_width: Math.round(family.card_width),
        card_height: Math.round(family.card_height),
        photo_size: Math.round(family.photo_size),
      })),
    },
    null,
    2,
  );
}

export function workspaceFromFile(text: string): { families: FamilyDoc[]; current: string } {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const raw = parsed.families;
  if (Array.isArray(raw) && raw.length) {
    const families = raw.map((item) => {
      const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const name = typeof source.name === "string" && source.name.trim() ? source.name : "Famille importée";
      return remapFamilyIds(normalizeFamily(familyFromRow(newId(), name, item)));
    });
    return { families, current: families[0].id };
  }
  if (parsed.persons) {
    const family = remapFamilyIds(normalizeFamily(familyFromRow(newId(), "Famille importée", parsed)));
    return { families: [family], current: family.id };
  }
  throw new Error("Fichier famille invalide");
}
