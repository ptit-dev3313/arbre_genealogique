import {
  PERSON_SPAN,
  clampCardSize,
  currentTree,
  type CoupleStatus,
  type FamilyDoc,
} from "./model";

export type PersonRect = {
  personId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Connector = { points: [number, number][]; color: string; coupleId: string };

export type CoupleLine = {
  coupleId: string;
  firstId: string;
  secondId: string;
  status: CoupleStatus;
  color: string;
  points: [number, number][];
  markX: number;
  markY: number;
};

export type TreeLayout = {
  coupleLines: CoupleLine[];
  personRects: Record<string, PersonRect>;
  connectors: Connector[];
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export const MIN_COLS = 48;
export const MIN_ROWS = 36;
export const WIRE_STROKE = 1.6;
export const COUPLE_LINE_STROKE = 2.6;
export const COUPLE_LINE_STROKE_SELECTED = 3.6;
export const STATUS_STROKE = 2;
export const COUPLE_SYMBOL_RADIUS = 9;
export const MARRIED_CIRCLE_DX = 6;
export const HEART_SIZE = 11;
export const STATUS_CROSS = 10;

export function cardSize(family: FamilyDoc): [number, number] {
  return clampCardSize(family.card_width, family.card_height);
}

export function stepX(cardWidth: number): number {
  return cardWidth / PERSON_SPAN;
}

export function gridToPixel(col: number, row: number, cardWidth: number, cardHeight: number): [number, number] {
  return [col * stepX(cardWidth), row * (cardHeight / PERSON_SPAN)];
}

export function pixelToGrid(x: number, y: number, cardWidth: number, cardHeight: number): [number, number] {
  const col = Math.floor(x / stepX(cardWidth));
  const row = Math.floor(y / cardHeight) * PERSON_SPAN;
  return [col, row];
}

export type Camera = { x: number; y: number; scale: number };

export function cameraFit(
  layout: { minX: number; minY: number; width: number; height: number },
  vpW: number,
  vpH: number,
): Camera {
  const w = Math.max(1, layout.width);
  const h = Math.max(1, layout.height);
  const scale = Math.min(4, Math.max(0.12, Math.min(vpW / w, vpH / h) * 0.9));
  return {
    scale,
    x: vpW / 2 - (layout.minX + w / 2) * scale,
    y: vpH / 2 - (layout.minY + h / 2) * scale,
  };
}

export function cameraCenterOn(
  layout: TreeLayout,
  personId: string,
  vpW: number,
  vpH: number,
  scale: number,
): Camera | undefined {
  const card = layout.personRects[personId];
  if (!card) return;
  const zoom = Math.min(4, Math.max(0.12, scale));
  return {
    scale: zoom,
    x: vpW / 2 - (card.x + card.width / 2) * zoom,
    y: vpH / 2 - (card.y + card.height / 2) * zoom,
  };
}

export function clientToWorld(clientX: number, clientY: number, camera: Camera) {
  const el = document.getElementById("tree-viewport");
  if (!el) return;
  const rect = el.getBoundingClientRect();
  return {
    over:
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom,
    x: (clientX - rect.left - camera.x) / camera.scale,
    y: (clientY - rect.top - camera.y) / camera.scale,
  };
}

function cx(rect: PersonRect): number {
  return rect.x + rect.width * 0.5;
}
function cy(rect: PersonRect): number {
  return rect.y + rect.height * 0.5;
}
function right(rect: PersonRect): number {
  return rect.x + rect.width;
}
function bottom(rect: PersonRect): number {
  return rect.y + rect.height;
}

export function spousesSideBySide(first: PersonRect, second: PersonRect): boolean {
  return Math.abs(cx(first) - cx(second)) >= Math.abs(cy(first) - cy(second));
}

export function coupleBar(first: PersonRect, second: PersonRect): {
  points: [number, number][];
  markX: number;
  markY: number;
} {
  if (spousesSideBySide(first, second)) {
    const [left, rightRect] = first.x <= second.x ? [first, second] : [second, first];
    const a: [number, number] = [right(left), cy(left)];
    const b: [number, number] = [rightRect.x, cy(rightRect)];
    if (Math.abs(a[1] - b[1]) < 4) {
      return { points: [a, b], markX: (a[0] + b[0]) / 2, markY: a[1] };
    }
    const midX = (a[0] + b[0]) / 2;
    return {
      points: [a, [midX, a[1]], [midX, b[1]], b],
      markX: midX,
      markY: (a[1] + b[1]) / 2,
    };
  }
  const [top, bottomRect] = first.y <= second.y ? [first, second] : [second, first];
  const a: [number, number] = [cx(top), bottom(top)];
  const b: [number, number] = [cx(bottomRect), bottomRect.y];
  if (Math.abs(a[0] - b[0]) < 4) {
    return { points: [a, b], markX: a[0], markY: (a[1] + b[1]) / 2 };
  }
  const midY = (a[1] + b[1]) / 2;
  return {
    points: [a, [a[0], midY], [b[0], midY], b],
    markX: (a[0] + b[0]) / 2,
    markY: midY,
  };
}

export function coupleAnchorLine(first: PersonRect, second: PersonRect): [[number, number], [number, number]] {
  const bar = coupleBar(first, second);
  return [bar.points[0], bar.points[bar.points.length - 1]];
}

export function canvasExtents(family: FamilyDoc): [number, number, number, number] {
  const tree = currentTree(family);
  let minCol = 0;
  let minRow = 0;
  let maxCol = MIN_COLS;
  let maxRow = MIN_ROWS;
  for (const pos of Object.values(tree.placements)) {
    minCol = Math.min(minCol, pos.col);
    minRow = Math.min(minRow, pos.row);
    maxCol = Math.max(maxCol, pos.col + PERSON_SPAN);
    maxRow = Math.max(maxRow, pos.row + PERSON_SPAN);
  }
  const pad = 4;
  minCol -= pad;
  minRow -= pad;
  maxCol += pad;
  maxRow += pad;
  const [cardW, cardH] = cardSize(family);
  const sx = stepX(cardW);
  const sy = cardH / PERSON_SPAN;
  return [minCol * sx, minRow * sy, maxCol * sx, maxRow * sy];
}

export function buildLayout(family: FamilyDoc): TreeLayout {
  const tree = currentTree(family);
  const [cardW, cardH] = cardSize(family);
  const personRects: Record<string, PersonRect> = {};
  for (const [id, pos] of Object.entries(tree.placements)) {
    if (!family.persons[id]) continue;
    const [x, y] = gridToPixel(pos.col, pos.row, cardW, cardH);
    personRects[id] = { personId: id, x, y, width: cardW, height: cardH };
  }
  const coupleLines: CoupleLine[] = [];
  const connectors: Connector[] = [];
  for (const couple of family.couples) {
    const first = personRects[couple.person1];
    const second = personRects[couple.person2];
    if (!first || !second) continue;
    const bar = coupleBar(first, second);
    coupleLines.push({
      coupleId: couple.id,
      firstId: couple.person1,
      secondId: couple.person2,
      status: couple.status,
      color: couple.color,
      points: bar.points,
      markX: bar.markX,
      markY: bar.markY,
    });
    const children = couple.childrens.map((id) => personRects[id]).filter(Boolean);
    if (!children.length) continue;
    const busPos = family.connector_bus_pos;
    if (spousesSideBySide(first, second)) {
      pushTBar(connectors, couple.id, couple.color, bar.markX, bar.markY, children.filter((c) => cy(c) >= bar.markY), "down", busPos);
      pushTBar(connectors, couple.id, couple.color, bar.markX, bar.markY, children.filter((c) => cy(c) < bar.markY), "up", busPos);
    } else {
      pushTBar(connectors, couple.id, couple.color, bar.markX, bar.markY, children.filter((c) => cx(c) >= bar.markX), "right", busPos);
      pushTBar(connectors, couple.id, couple.color, bar.markX, bar.markY, children.filter((c) => cx(c) < bar.markX), "left", busPos);
    }
  }
  const laneGap = Math.max(0, family.connector_lane_gap);
  unstickHorizontal(connectors, laneGap);
  unstickVertical(connectors, laneGap);
  const [minX, minY, maxX, maxY] = canvasExtents(family);
  return { coupleLines, personRects, connectors, minX, minY, width: maxX - minX, height: maxY - minY };
}

function busAlong(start: number, nearest: number, towardEnd: boolean, busPos: number): number {
  const t = Math.min(1, Math.max(0, busPos / 100));
  const inset = 16;
  const raw = start + (nearest - start) * t;
  return towardEnd
    ? Math.min(nearest - inset, Math.max(start, raw))
    : Math.max(nearest + inset, Math.min(start, raw));
}

function pushTBar(
  connectors: Connector[],
  coupleId: string,
  color: string,
  originX: number,
  originY: number,
  children: PersonRect[],
  dir: "down" | "up" | "right" | "left",
  busPos: number,
) {
  if (!children.length) return;
  const gap = COUPLE_SYMBOL_RADIUS + 3;
  if (dir === "down" || dir === "up") {
    const below = dir === "down";
    const startY = below ? originY + gap : originY - gap;
    const edges = children.map((child) => (below ? child.y : bottom(child)));
    const nearest = below ? Math.min(...edges) : Math.max(...edges);
    const busY = busAlong(startY, nearest, below, busPos);
    const xs = [originX, ...children.map(cx)];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    connectors.push({ points: [[originX, startY], [originX, busY]], color, coupleId });
    if (maxX - minX > 1) connectors.push({ points: [[minX, busY], [maxX, busY]], color, coupleId });
    for (const child of children) {
      const x = cx(child);
      const endY = below ? child.y : bottom(child);
      connectors.push({ points: [[x, busY], [x, endY]], color, coupleId });
    }
    return;
  }
  const toRight = dir === "right";
  const startX = toRight ? originX + gap : originX - gap;
  const edges = children.map((child) => (toRight ? child.x : right(child)));
  const nearest = toRight ? Math.min(...edges) : Math.max(...edges);
  const busX = busAlong(startX, nearest, toRight, busPos);
  const ys = [originY, ...children.map(cy)];
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  connectors.push({ points: [[startX, originY], [busX, originY]], color, coupleId });
  if (maxY - minY > 1) connectors.push({ points: [[busX, minY], [busX, maxY]], color, coupleId });
  for (const child of children) {
    const y = cy(child);
    const endX = toRight ? child.x : right(child);
    connectors.push({ points: [[busX, y], [endX, y]], color, coupleId });
  }
}

function unstickHorizontal(connectors: Connector[], laneGap: number) {
  type Seg = { conn: number; coupleId: string; left: number; right: number; y: number; i0: number; i1: number };
  const segs: Seg[] = [];
  connectors.forEach((connector, ci) => {
    for (let i = 0; i < connector.points.length - 1; i++) {
      const [x0, y0] = connector.points[i];
      const [x1, y1] = connector.points[i + 1];
      if (Math.abs(y0 - y1) > 0.75 || Math.abs(x0 - x1) < 1) continue;
      segs.push({
        conn: ci,
        coupleId: connector.coupleId,
        left: Math.min(x0, x1),
        right: Math.max(x0, x1),
        y: (y0 + y1) * 0.5,
        i0: i,
        i1: i + 1,
      });
    }
  });
  if (segs.length < 2) return;
  type Bus = { coupleId: string; y: number; left: number; right: number; members: number[] };
  const buses: Bus[] = [];
  segs.forEach((seg, si) => {
    const bus = buses.find((item) => item.coupleId === seg.coupleId && Math.abs(item.y - seg.y) <= 1.5);
    if (bus) {
      bus.left = Math.min(bus.left, seg.left);
      bus.right = Math.max(bus.right, seg.right);
      bus.members.push(si);
    } else {
      buses.push({ coupleId: seg.coupleId, y: seg.y, left: seg.left, right: seg.right, members: [si] });
    }
  });
  if (buses.length < 2) return;
  if (laneGap <= 0) return;
  const pitch = laneGap;
  const used = buses.map(() => false);
  for (let start = 0; start < buses.length; start++) {
    if (used[start]) continue;
    const group = [start];
    used[start] = true;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < buses.length; i++) {
        if (used[i]) continue;
        const overlaps = group.some(
          (g) =>
            Math.abs(buses[g].y - buses[i].y) <= 2 &&
            buses[g].left < buses[i].right - 2 &&
            buses[i].left < buses[g].right - 2,
        );
        if (overlaps) {
          used[i] = true;
          group.push(i);
          changed = true;
        }
      }
    }
    if (group.length < 2) continue;
    const order = [...group].sort((a, b) => buses[a].left - buses[b].left);
    const laneRight: number[] = [];
    const laneOf = buses.map(() => 0);
    for (const bi of order) {
      const bus = buses[bi];
      const chosen = laneRight.findIndex((right) => right + 1 < bus.left);
      const lane = chosen >= 0 ? chosen : laneRight.length;
      if (chosen >= 0) laneRight[chosen] = bus.right;
      else laneRight.push(bus.right);
      laneOf[bi] = lane;
    }
    if (laneRight.length < 2) continue;
    const mid = (laneRight.length - 1) * 0.5;
    for (const bi of group) {
      const oldY = buses[bi].y;
      const y = oldY + (laneOf[bi] - mid) * pitch;
      if (Math.abs(y - oldY) < 0.2) continue;
      for (const connector of connectors) {
        if (connector.coupleId !== buses[bi].coupleId) continue;
        for (const point of connector.points) {
          if (Math.abs(point[1] - oldY) < 0.75) point[1] = y;
        }
      }
    }
  }
}

function unstickVertical(connectors: Connector[], laneGap: number) {
  for (const connector of connectors) {
    for (const point of connector.points) {
      const x = point[0];
      point[0] = point[1];
      point[1] = x;
    }
  }
  unstickHorizontal(connectors, laneGap);
  for (const connector of connectors) {
    for (const point of connector.points) {
      const x = point[0];
      point[0] = point[1];
      point[1] = x;
    }
  }
}

export function heartPath(cx0: number, cy0: number, s: number): string {
  const scale = s / 10;
  const map = (x: number, y: number): [number, number] => [cx0 + (x - 12) * scale, cy0 + (y - 11.2) * scale];
  const p = (x: number, y: number) => map(x, y);
  const start = p(12, 21.35);
  const cubics = [
    [p(10.04, 19.46), p(2, 13.28), p(2, 8.5)],
    [p(2, 5.42), p(4.42, 3), p(7.5, 3)],
    [p(9.24, 3), p(10.91, 3.81), p(12, 5.09)],
    [p(13.09, 3.81), p(14.76, 3), p(16.5, 3)],
    [p(19.58, 3), p(22, 5.42), p(22, 8.5)],
    [p(22, 13.28), p(13.96, 19.46), p(12, 21.35)],
  ];
  let d = `M${start[0].toFixed(2)},${start[1].toFixed(2)}`;
  for (const c of cubics) {
    d += ` C${c[0][0].toFixed(2)},${c[0][1].toFixed(2)} ${c[1][0].toFixed(2)},${c[1][1].toFixed(2)} ${c[2][0].toFixed(2)},${c[2][1].toFixed(2)}`;
  }
  return `${d} Z`;
}

export function hitPerson(layout: TreeLayout, x: number, y: number): string | undefined {
  return Object.values(layout.personRects).find(
    (rect) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height,
  )?.personId;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function hitCouple(layout: TreeLayout, x: number, y: number): string | undefined {
  for (const couple of layout.coupleLines) {
    if (Math.hypot(x - couple.markX, y - couple.markY) <= COUPLE_SYMBOL_RADIUS + 8) return couple.coupleId;
    for (let i = 0; i < couple.points.length - 1; i++) {
      const [ax, ay] = couple.points[i];
      const [bx, by] = couple.points[i + 1];
      if (distToSegment(x, y, ax, ay, bx, by) <= 12) return couple.coupleId;
    }
  }
}
