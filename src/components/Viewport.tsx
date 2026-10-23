import { useMemo, useRef, useState } from "react";
import {
  COUPLE_LINE_STROKE,
  COUPLE_LINE_STROKE_SELECTED,
  COUPLE_SYMBOL_RADIUS,
  HEART_SIZE,
  MARRIED_CIRCLE_DX,
  STATUS_CROSS,
  STATUS_STROKE,
  WIRE_STROKE,
  buildLayout,
  cardSize,
  gridToPixel,
  heartPath,
  hitCouple,
  hitPerson,
  pixelToGrid,
  stepX,
} from "../lib/layout";
import { PERSON_SPAN, canEditCurrentTree, currentTree, occupies, type Placement } from "../lib/model";
import { useApp } from "../store";
import { PersonFace } from "./PersonFace";

type Live = {
  mode: "pan" | "move" | "marquee";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  camX: number;
  camY: number;
  origins: Record<string, Placement>;
  additive: boolean;
};

type Pending = {
  personId: string;
  additive: boolean;
  clientX: number;
  clientY: number;
  worldX: number;
  worldY: number;
};

export function Viewport() {
  const family = useApp((s) => s.family());
  const camera = useApp((s) => s.camera);
  const setCamera = useApp((s) => s.setCamera);
  const selected = useApp((s) => s.selected);
  const selectedCouple = useApp((s) => s.selectedCouple);
  const placingId = useApp((s) => s.placingId);
  const dropPreview = useApp((s) => s.dropPreview);
  const pickChildFor = useApp((s) => s.pickChildFor);
  const pickPartnerFor = useApp((s) => s.pickPartnerFor);
  const viewing = useApp((s) => s.viewing);
  const canMutate = useApp((s) => s.canMutate());
  const showPhotos = useApp((s) => s.showPhotos);
  const selectPerson = useApp((s) => s.selectPerson);
  const selectMany = useApp((s) => s.selectMany);
  const selectCouple = useApp((s) => s.selectCouple);
  const placePerson = useApp((s) => s.placePerson);
  const applyMove = useApp((s) => s.applyMove);
  const addChild = useApp((s) => s.addChild);
  const setModal = useApp((s) => s.setModal);
  const clearSelection = useApp((s) => s.clearSelection);
  const layout = useMemo(() => buildLayout(family), [family]);
  const [cardW, cardH] = cardSize(family);
  const root = useRef<HTMLDivElement>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const live = useRef<Live | null>(null);
  const pending = useRef<Pending | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number; mx: number; my: number; x: number; y: number } | null>(null);
  const holdTimer = useRef(0);
  const holdDone = useRef(false);
  const [marquee, setMarquee] = useState<[number, number, number, number] | null>(null);
  const [delta, setDelta] = useState<Placement>({ col: 0, row: 0 });

  function worldFrom(clientX: number, clientY: number): [number, number] {
    const rect = root.current!.getBoundingClientRect();
    const cam = cameraRef.current;
    return [(clientX - rect.left - cam.x) / cam.scale, (clientY - rect.top - cam.y) / cam.scale];
  }

  function moveDelta(worldX: number, worldY: number, startX: number, startY: number): Placement {
    return {
      col: Math.round((worldX - startX) / stepX(cardW)),
      row: Math.round((worldY - startY) / cardH) * PERSON_SPAN,
    };
  }

  function beginMove(from: Pending) {
    const before = useApp.getState();
    if (!before.selected.includes(from.personId)) {
      selectPerson(from.personId, from.additive);
    }
    if (!before.canMutate()) return;
    if (!canEditCurrentTree(useApp.getState().family())) return;
    const snapshot = useApp.getState();
    const tree = currentTree(snapshot.family());
    const ids = snapshot.selected.includes(from.personId) ? snapshot.selected : [from.personId];
    const origins: Record<string, Placement> = {};
    for (const id of ids) {
      const pos = tree.placements[id];
      if (pos) origins[id] = pos;
    }
    if (!Object.keys(origins).length) return;
    live.current = {
      mode: "move",
      pointerId: 0,
      startClientX: from.clientX,
      startClientY: from.clientY,
      startWorldX: from.worldX,
      startWorldY: from.worldY,
      camX: cameraRef.current.x,
      camY: cameraRef.current.y,
      origins,
      additive: from.additive,
    };
    setDelta({ col: 0, row: 0 });
  }

  function clearHold() {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = 0;
    }
  }

  return (
    <div
      id="tree-viewport"
      ref={root}
      role="application"
      aria-label="Schéma"
      className={`viewport${viewing ? " viewing" : ""}`}
      onWheel={(event) => {
        event.preventDefault();
        const rect = root.current!.getBoundingClientRect();
        const cam = cameraRef.current;
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
        const scale = Math.min(4, Math.max(0.12, cam.scale * factor));
        const wx = (mx - cam.x) / cam.scale;
        const wy = (my - cam.y) / cam.scale;
        setCamera({ scale, x: mx - wx * scale, y: my - wy * scale });
      }}
      onPointerDown={(event) => {
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size >= 2) {
          pending.current = null;
          live.current = null;
          clearHold();
          setMarquee(null);
          const [a, b] = [...pointers.current.values()];
          const rect = root.current!.getBoundingClientRect();
          const cam = cameraRef.current;
          pinch.current = {
            dist: Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)),
            scale: cam.scale,
            mx: (a.x + b.x) / 2 - rect.left,
            my: (a.y + b.y) / 2 - rect.top,
            x: cam.x,
            y: cam.y,
          };
          return;
        }
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* untrusted or already captured */
        }
        const [worldX, worldY] = worldFrom(event.clientX, event.clientY);
        const person = hitPerson(layout, worldX, worldY);
        const touchPan =
          event.pointerType !== "mouse" && event.button === 0 && !person && !placingId && !pickChildFor && !pickPartnerFor;
        if (event.button === 1 || event.button === 2 || (viewing && event.button === 0 && !person) || touchPan) {
          pending.current = null;
          live.current = {
            mode: "pan",
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startWorldX: worldX,
            startWorldY: worldY,
            camX: cameraRef.current.x,
            camY: cameraRef.current.y,
            origins: {},
            additive: false,
          };
          return;
        }
        if (event.button !== 0) return;
        if (pickChildFor && person) {
          addChild(pickChildFor, person);
          return;
        }
        if (pickPartnerFor && person) {
          if (person !== pickPartnerFor) useApp.getState().linkCouple(pickPartnerFor, person);
          useApp.setState({ pickPartnerFor: undefined });
          return;
        }
        if (placingId && !viewing && canMutate) {
          const [col, row] = pixelToGrid(worldX, worldY, cardW, cardH);
          placePerson(placingId, col, row);
          return;
        }
        if (person && !viewing) {
          pending.current = {
            personId: person,
            additive: event.shiftKey || event.ctrlKey || event.metaKey,
            clientX: event.clientX,
            clientY: event.clientY,
            worldX,
            worldY,
          };
          live.current = null;
          holdDone.current = false;
          clearHold();
          if (event.pointerType !== "mouse") {
            const id = person;
            holdTimer.current = window.setTimeout(() => {
              holdTimer.current = 0;
              const wait = pending.current;
              if (!wait || wait.personId !== id) return;
              holdDone.current = true;
              selectPerson(id, true);
              navigator.vibrate?.(12);
            }, 420);
          }
          return;
        }
        if (person && viewing) {
          selectPerson(person);
          return;
        }
        const couple = hitCouple(layout, worldX, worldY);
        if (couple && !viewing) {
          selectCouple(couple);
          return;
        }
        if (!viewing) {
          pending.current = null;
          live.current = {
            mode: "marquee",
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startWorldX: worldX,
            startWorldY: worldY,
            camX: cameraRef.current.x,
            camY: cameraRef.current.y,
            origins: {},
            additive: event.shiftKey || event.ctrlKey || event.metaKey,
          };
          setMarquee([worldX, worldY, worldX, worldY]);
        }
      }}
      onPointerMove={(event) => {
        if (pointers.current.has(event.pointerId)) {
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }
        if (pinch.current && pointers.current.size >= 2 && root.current) {
          const [a, b] = [...pointers.current.values()];
          const dist = Math.max(8, Math.hypot(a.x - b.x, a.y - b.y));
          const rect = root.current.getBoundingClientRect();
          const mx = (a.x + b.x) / 2 - rect.left;
          const my = (a.y + b.y) / 2 - rect.top;
          const origin = pinch.current;
          const scale = Math.min(4, Math.max(0.12, origin.scale * (dist / origin.dist)));
          const wx = (origin.mx - origin.x) / origin.scale;
          const wy = (origin.my - origin.y) / origin.scale;
          setCamera({ scale, x: mx - wx * scale, y: my - wy * scale });
          return;
        }
        const wait = pending.current;
        if (wait && !live.current) {
          const dist = Math.hypot(event.clientX - wait.clientX, event.clientY - wait.clientY);
          if (dist > 5) {
            clearHold();
            beginMove(wait);
            pending.current = null;
          } else {
            return;
          }
        }
        const current = live.current;
        if (!current) return;
        if (current.mode === "pan") {
          setCamera({
            ...cameraRef.current,
            x: current.camX + event.clientX - current.startClientX,
            y: current.camY + event.clientY - current.startClientY,
          });
          return;
        }
        const [worldX, worldY] = worldFrom(event.clientX, event.clientY);
        if (current.mode === "move") {
          setDelta(moveDelta(worldX, worldY, current.startWorldX, current.startWorldY));
          return;
        }
        if (current.mode === "marquee") {
          setMarquee([current.startWorldX, current.startWorldY, worldX, worldY]);
        }
      }}
      onPointerUp={(event) => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) {
          const wasPinch = Boolean(pinch.current);
          pinch.current = null;
          if (wasPinch) {
            live.current = null;
            pending.current = null;
            clearHold();
            return;
          }
        }
        const wait = pending.current;
        pending.current = null;
        if (wait) {
          const added = holdDone.current;
          holdDone.current = false;
          clearHold();
          if (!added) {
            const touch = event.pointerType !== "mouse";
            selectPerson(wait.personId, wait.additive || touch);
          }
          live.current = null;
          return;
        }
        const current = live.current;
        live.current = null;
        if (!current) return;
        if (current.mode === "move") {
          const [worldX, worldY] = worldFrom(event.clientX, event.clientY);
          const next = moveDelta(worldX, worldY, current.startWorldX, current.startWorldY);
          if (useApp.getState().canMutate()) applyMove(current.origins, next.col, next.row);
          setDelta({ col: 0, row: 0 });
          return;
        }
        if (current.mode === "marquee") {
          const [worldX, worldY] = worldFrom(event.clientX, event.clientY);
          const left = Math.min(current.startWorldX, worldX);
          const right = Math.max(current.startWorldX, worldX);
          const top = Math.min(current.startWorldY, worldY);
          const bottom = Math.max(current.startWorldY, worldY);
          if (right - left > 6 || bottom - top > 6) {
            const ids = Object.values(layout.personRects)
              .filter((rect) => rect.x < right && rect.x + rect.width > left && rect.y < bottom && rect.y + rect.height > top)
              .map((rect) => rect.personId);
            selectMany(ids, current.additive);
          } else {
            clearSelection();
          }
          setMarquee(null);
        }
        if (current.mode === "pan") {
          const dist = Math.hypot(event.clientX - current.startClientX, event.clientY - current.startClientY);
          if (dist < 8) clearSelection();
          setDelta({ col: 0, row: 0 });
        }
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId);
        pinch.current = null;
        pending.current = null;
        live.current = null;
        clearHold();
        holdDone.current = false;
        setMarquee(null);
        setDelta({ col: 0, row: 0 });
      }}
      onContextMenu={(event) => event.preventDefault()}
      onDoubleClick={(event) => {
        if (viewing) return;
        const [x, y] = worldFrom(event.clientX, event.clientY);
        const person = hitPerson(layout, x, y);
        if (person) setModal({ kind: "person", personId: person });
      }}
    >
      <div
        className="scene"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
      >
        <svg
          className="grid-layer"
          width={layout.width}
          height={layout.height}
          viewBox={`${layout.minX} ${layout.minY} ${layout.width} ${layout.height}`}
          shapeRendering="crispEdges"
          style={{ left: layout.minX, top: layout.minY, width: layout.width, height: layout.height }}
        >
          <GridLines minX={layout.minX} minY={layout.minY} width={layout.width} height={layout.height} cardW={cardW} cardH={cardH} />
        </svg>
        <svg
          className="wire-layer"
          width={layout.width}
          height={layout.height}
          viewBox={`${layout.minX} ${layout.minY} ${layout.width} ${layout.height}`}
          shapeRendering="geometricPrecision"
          style={{ left: layout.minX, top: layout.minY, width: layout.width, height: layout.height }}
        >
          {layout.connectors.map((connector, i) => (
            <path
              key={i}
              d={connector.points.map((p, n) => `${n ? "L" : "M"}${p[0]} ${p[1]}`).join(" ")}
              fill="none"
              stroke={connector.color}
              strokeWidth={WIRE_STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="nonScalingStroke"
            />
          ))}
          {layout.coupleLines.map((couple) => {
            const sw = selectedCouple === couple.coupleId ? COUPLE_LINE_STROKE_SELECTED : COUPLE_LINE_STROKE;
            const d = couple.points.map((p, n) => `${n ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
            return (
              <g key={couple.coupleId}>
                <path
                  d={d}
                  fill="none"
                  stroke={couple.color}
                  strokeWidth={sw}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="nonScalingStroke"
                />
                <StatusMark status={couple.status} x={couple.markX} y={couple.markY} color={couple.color} />
              </g>
            );
          })}
        </svg>
        {Object.values(layout.personRects).map((rect) => {
          const person = family.persons[rect.personId];
          if (!person) return null;
          const origin = live.current?.mode === "move" ? live.current.origins[rect.personId] : undefined;
          const [px, py] = origin
            ? gridToPixel(origin.col + delta.col, origin.row + delta.row, cardW, cardH)
            : [rect.x, rect.y];
          return (
            <div
              key={rect.personId}
              className={`person${selected.includes(rect.personId) || origin ? " selected" : ""}`}
              style={{
                left: px,
                top: py,
                width: rect.width,
                height: rect.height,
                ["--photo-size" as string]: `${family.photo_size}px`,
              }}
            >
              <PersonFace person={person} showPhoto={showPhotos} />
              <div className="person-names">
                <strong>{person.name}</strong>
                <span>{person.family_name}</span>
              </div>
            </div>
          );
        })}
        {dropPreview && family.persons[dropPreview.id] && (
          <div
            className={`ghost${occupies(family, dropPreview.col, dropPreview.row, [dropPreview.id]) ? " busy" : ""}`}
            style={{
              ...(() => {
                const [x, y] = gridToPixel(dropPreview.col, dropPreview.row, cardW, cardH);
                return { left: x, top: y, width: cardW, height: cardH };
              })(),
            }}
          >
            <strong>{family.persons[dropPreview.id].name}</strong>
            <span>{family.persons[dropPreview.id].family_name}</span>
          </div>
        )}
        {marquee && (
          <div
            className="marquee"
            style={{
              left: Math.min(marquee[0], marquee[2]),
              top: Math.min(marquee[1], marquee[3]),
              width: Math.abs(marquee[2] - marquee[0]),
              height: Math.abs(marquee[3] - marquee[1]),
            }}
          />
        )}
      </div>
    </div>
  );
}

function GridLines({
  minX,
  minY,
  width,
  height,
  cardW,
  cardH,
}: {
  minX: number;
  minY: number;
  width: number;
  height: number;
  cardW: number;
  cardH: number;
}) {
  const maxX = minX + width;
  const maxY = minY + height;
  const sx = stepX(cardW);
  const lines = [];
  let col = Math.round(minX / sx);
  let x = col * sx;
  while (x <= maxX + 0.01) {
    const rem = ((col % PERSON_SPAN) + PERSON_SPAN) % PERSON_SPAN;
    const sw = rem === 0 ? 1.15 : rem === 2 ? 0.8 : 0.45;
    const color = rem === 0 ? "#c4ced6" : rem === 2 ? "#d6dde3" : "#e8ecf0";
    lines.push(
      <line key={`c${col}`} x1={x} y1={minY} x2={x} y2={maxY} stroke={color} strokeWidth={sw} vectorEffect="nonScalingStroke" />,
    );
    x += sx;
    col += 1;
  }
  let y = Math.floor(minY / cardH) * cardH;
  let i = 0;
  while (y <= maxY + 0.01) {
    lines.push(
      <line key={`r${i++}`} x1={minX} y1={y} x2={maxX} y2={y} stroke="#c4ced6" strokeWidth={1.15} vectorEffect="nonScalingStroke" />,
    );
    y += cardH;
  }
  return <>{lines}</>;
}

function StatusMark({ status, x, y, color }: { status: string; x: number; y: number; color: string }) {
  const r = COUPLE_SYMBOL_RADIUS;
  if (status === "Marié") {
    return (
      <>
        <circle cx={x - MARRIED_CIRCLE_DX} cy={y} r={r} fill="none" stroke={color} strokeWidth={STATUS_STROKE} vectorEffect="nonScalingStroke" />
        <circle cx={x + MARRIED_CIRCLE_DX} cy={y} r={r} fill="none" stroke={color} strokeWidth={STATUS_STROKE} vectorEffect="nonScalingStroke" />
      </>
    );
  }
  if (status === "Engagé") return <path d={heartPath(x, y, HEART_SIZE)} fill={color} />;
  if (status === "Séparé") {
    return (
      <line
        x1={x - STATUS_CROSS}
        y1={y - STATUS_CROSS}
        x2={x + STATUS_CROSS}
        y2={y + STATUS_CROSS}
        stroke={color}
        strokeWidth={STATUS_STROKE}
        strokeLinecap="round"
        vectorEffect="nonScalingStroke"
      />
    );
  }
  return (
    <>
      <line x1={x - STATUS_CROSS} y1={y - STATUS_CROSS} x2={x + STATUS_CROSS} y2={y + STATUS_CROSS} stroke={color} strokeWidth={STATUS_STROKE} strokeLinecap="round" vectorEffect="nonScalingStroke" />
      <line x1={x + STATUS_CROSS} y1={y - STATUS_CROSS} x2={x - STATUS_CROSS} y2={y + STATUS_CROSS} stroke={color} strokeWidth={STATUS_STROKE} strokeLinecap="round" vectorEffect="nonScalingStroke" />
    </>
  );
}
