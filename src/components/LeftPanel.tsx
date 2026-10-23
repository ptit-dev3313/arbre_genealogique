import { useRef, useState } from "react";
import { t } from "../lib/i18n";
import { cardSize, clientToWorld, pixelToGrid } from "../lib/layout";
import {
  canEditCurrentTree,
  canEditTree,
  canManageFamily,
  currentTree,
  familyLabels,
  occupies,
  personMatchesFilters,
  unplacedIds,
} from "../lib/model";
import { useApp } from "../store";
import { PersonFace } from "./PersonFace";

export function FamilyTreeControls() {
  const lang = useApp((s) => s.lang);
  const families = useApp((s) => s.families);
  const currentId = useApp((s) => s.currentId);
  const family = useApp((s) => s.family());
  const switchFamily = useApp((s) => s.switchFamily);
  const addFamily = useApp((s) => s.addFamily);
  const renameFamily = useApp((s) => s.renameFamily);
  const deleteFamily = useApp((s) => s.deleteFamily);
  const addTree = useApp((s) => s.addTree);
  const renameTree = useApp((s) => s.renameTree);
  const deleteTree = useApp((s) => s.deleteTree);
  const switchTree = useApp((s) => s.switchTree);
  const setModal = useApp((s) => s.setModal);
  const lockHolder = useApp((s) => s.lockHolder);
  const canMutate = useApp((s) => s.canMutate());
  const canEditTreeNow = canMutate && canEditCurrentTree(family);
  const tree = currentTree(family);

  return (
    <div className="panel-head">
      <div className="compact-block">
        <label>{t(lang, "family")}</label>
        <div className="row">
          <select value={currentId} onChange={(e) => void switchFamily(e.target.value)}>
            {families.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button type="button" className="icon add" title={t(lang, "addFamily")} aria-label={t(lang, "addFamily")} onClick={addFamily}>
            +
          </button>
          {canManageFamily(family) && (
            <button
              type="button"
              className="icon danger"
              title={t(lang, "deleteFamily")}
              aria-label={t(lang, "deleteFamily")}
              onClick={() => setModal({ kind: "confirm", message: t(lang, "confirmDeleteFamily"), action: () => void deleteFamily() })}
            >
              ×
            </button>
          )}
        </div>
        <input
          value={family.name}
          onChange={(e) => renameFamily(e.target.value)}
          disabled={!canMutate || !canManageFamily(family)}
        />
      </div>
      <div className="compact-block">
        <label>{t(lang, "tree")}</label>
        <div className="row">
          <select value={tree.id} onChange={(e) => switchTree(e.target.value)}>
            {family.trees.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {!canEditTree(family, item.id) ? ` (${t(lang, "readOnly")})` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon add"
            title={t(lang, "addTree")}
            aria-label={t(lang, "addTree")}
            onClick={addTree}
            disabled={!canMutate || !canManageFamily(family)}
          >
            +
          </button>
          <button
            type="button"
            className="icon danger"
            title={t(lang, "deleteTree")}
            aria-label={t(lang, "deleteTree")}
            onClick={deleteTree}
            disabled={!canMutate || !canManageFamily(family)}
          >
            ×
          </button>
        </div>
        <input
          value={tree.name}
          onChange={(e) => renameTree(e.target.value)}
          disabled={!canEditTreeNow}
        />
        {!canEditCurrentTree(family) && <p className="muted">{t(lang, "treeReadOnly")}</p>}
      </div>
      <button type="button" onClick={() => setModal({ kind: "display" })}>
        {t(lang, "display")}
      </button>
      {lockHolder && (
        <p className="warn">
          {lockHolder} {t(lang, "busyLock")}
        </p>
      )}
    </div>
  );
}

export function LeftPanel() {
  const lang = useApp((s) => s.lang);
  const family = useApp((s) => s.family());
  const compact = useApp((s) => s.compact);
  const setModal = useApp((s) => s.setModal);
  const placingId = useApp((s) => s.placingId);
  const selected = useApp((s) => s.selected);
  const placePerson = useApp((s) => s.placePerson);
  const selectPerson = useApp((s) => s.selectPerson);
  const canMutate = useApp((s) => s.canMutate());
  const showPhotos = useApp((s) => s.showPhotos);
  const [query, setQuery] = useState("");
  const [activeLabels, setActiveLabels] = useState<string[]>([]);
  const drag = useRef<{ id: string; x: number; y: number; dragging: boolean } | null>(null);
  const labels = familyLabels(family);
  const unplaced = unplacedIds(family).filter((id) => personMatchesFilters(family.persons[id], query, activeLabels));
  const [cw, ch] = cardSize(family);

  function setPlacing(id?: string) {
    useApp.setState({ placingId: id, dropPreview: undefined });
  }

  function previewAt(id: string, clientX: number, clientY: number) {
    const world = clientToWorld(clientX, clientY, useApp.getState().camera);
    if (!world?.over) {
      useApp.setState({ dropPreview: undefined });
      return;
    }
    const [col, row] = pixelToGrid(world.x, world.y, cw, ch);
    useApp.setState({ placingId: id, dropPreview: { id, col, row } });
  }

  return (
    <aside className="panel">
      {!compact && <FamilyTreeControls />}
      <div className="palette-block">
        <label>{t(lang, "unplaced")}</label>
        <input placeholder={t(lang, "filter")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chip-row">
          {labels.map((label) => (
            <button
              key={label}
              type="button"
              className={`chip${activeLabels.includes(label) ? " on" : ""}`}
              onClick={() =>
                setActiveLabels((list) => (list.includes(label) ? list.filter((item) => item !== label) : [...list, label]))
              }
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="primary"
          disabled={!canMutate}
          onClick={() => setModal({ kind: "person" })}
        >
          {t(lang, "addPerson")}
        </button>
        <div className={`palette${compact ? " grid" : ""}`}>
          {unplaced.length === 0 && <p className="muted">{t(lang, "emptyUnplaced")}</p>}
          {unplaced.map((id) => (
            <div
              key={id}
              id={`palette-${id}`}
              className={`card${placingId === id || selected.includes(id) ? " selected" : ""}`}
              style={compact ? undefined : { width: cw, height: ch }}
              onPointerDown={(event) => {
                if (event.button !== 0 || compact) return;
                if (!canMutate || !canEditCurrentTree(family)) return;
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  /* ignore */
                }
                drag.current = { id, x: event.clientX, y: event.clientY, dragging: false };
              }}
              onPointerMove={(event) => {
                const current = drag.current;
                if (!current || current.id !== id) return;
                if (!current.dragging) {
                  if (Math.hypot(event.clientX - current.x, event.clientY - current.y) <= 6) return;
                  current.dragging = true;
                }
                previewAt(id, event.clientX, event.clientY);
              }}
              onPointerUp={(event) => {
                const current = drag.current;
                drag.current = null;
                const preview = useApp.getState().dropPreview;
                useApp.setState({ dropPreview: undefined });
                if (current?.dragging) {
                  const world = clientToWorld(event.clientX, event.clientY, useApp.getState().camera);
                  if (world?.over) {
                    const cell = preview ?? (() => {
                      const [col, row] = pixelToGrid(world.x, world.y, cw, ch);
                      return { id, col, row };
                    })();
                    if (!occupies(useApp.getState().family(), cell.col, cell.row, [id])) {
                      placePerson(id, cell.col, cell.row);
                    }
                  }
                  setPlacing(undefined);
                  return;
                }
                selectPerson(id);
                if (!canMutate || !canEditCurrentTree(family)) return;
                const nextPlace = placingId === id ? undefined : id;
                setPlacing(nextPlace);
                if (compact) useApp.getState().setSheet(undefined);
              }}
              onPointerCancel={() => {
                drag.current = null;
                useApp.setState({ dropPreview: undefined });
              }}
            >
              <PersonFace person={family.persons[id]} showPhoto={showPhotos} mini />
              <strong>{family.persons[id].name}</strong>
              <span>{family.persons[id].family_name}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
