import { useEffect } from "react";
import { FamilyTreeControls, LeftPanel } from "./components/LeftPanel";
import { Modals } from "./components/Modals";
import { RightPanel } from "./components/RightPanel";
import { TopBar } from "./components/TopBar";
import { Viewport } from "./components/Viewport";
import { ViewerBar, ViewerSheet } from "./components/Viewer";
import { t } from "./lib/i18n";
import { heartbeatLoop, useApp } from "./store";

export default function App() {
  const ready = useApp((s) => s.ready);
  const viewing = useApp((s) => s.viewing);
  const compact = useApp((s) => s.compact);
  const portrait = useApp((s) => s.portrait);
  const sheet = useApp((s) => s.sheet);
  const selected = useApp((s) => s.selected);
  const selectedCouple = useApp((s) => s.selectedCouple);
  const placingId = useApp((s) => s.placingId);
  const family = useApp((s) => s.family());
  const boot = useApp((s) => s.boot);
  const pushCloud = useApp((s) => s.pushCloud);
  const unplaceSelected = useApp((s) => s.unplaceSelected);
  const clearSelection = useApp((s) => s.clearSelection);
  const setViewing = useApp((s) => s.setViewing);
  const setModal = useApp((s) => s.setModal);
  const setSheet = useApp((s) => s.setSheet);
  const syncLayout = useApp((s) => s.syncLayout);
  const modal = useApp((s) => s.modal);
  const lang = useApp((s) => s.lang);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    syncLayout();
    const onResize = () => syncLayout();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [syncLayout]);

  useEffect(() => {
    const save = window.setInterval(() => void pushCloud(), 1500);
    const beat = window.setInterval(() => void heartbeatLoop(), 15000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void heartbeatLoop();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(save);
      window.clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pushCloud]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select")) return;
      if (event.key === "Escape") {
        if (modal) setModal(undefined);
        else if (placingId) useApp.setState({ placingId: undefined, dropPreview: undefined });
        else if (sheet) setSheet(undefined);
        else if (viewing) setViewing(false);
        else clearSelection();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && !viewing) {
        event.preventDefault();
        void useApp.getState().copyPeople();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && !viewing) {
        event.preventDefault();
        void useApp.getState().pastePeople();
      }
      if ((event.key === "Delete" || event.key === "Backspace") && !viewing) {
        event.preventDefault();
        unplaceSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection, modal, placingId, setModal, setSheet, setViewing, sheet, unplaceSelected, viewing]);

  if (!ready) {
    return (
      <div className="load-mask">
        <div className="load-spin" />
        <p>Arbre généalogique</p>
      </div>
    );
  }

  const layoutClass = [
    "app",
    viewing ? "viewing" : "",
    compact ? "compact" : "",
    compact ? (portrait ? "portrait" : "landscape") : "",
    compact && sheet ? `sheet-${sheet}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={layoutClass}>
      {viewing ? <ViewerBar /> : <TopBar />}
      <div className="workspace">
        {!viewing && <LeftPanel />}
        <div className={`editor${viewing ? " viewing" : ""}`}>
          <Viewport />
          {viewing && <ViewerSheet />}
          {compact && !viewing && placingId && family.persons[placingId] && (
            <div className="place-banner">
              <p>
                {t(lang, "tapToPlace")} <strong>{family.persons[placingId].name || family.persons[placingId].family_name}</strong>
              </p>
              <button type="button" onClick={() => useApp.setState({ placingId: undefined, dropPreview: undefined })}>
                {t(lang, "cancel")}
              </button>
            </div>
          )}
          {compact && !viewing && !placingId && !sheet && (selected.length > 0 || selectedCouple) && (
            <div className="place-banner select-banner">
              <p>
                {selected.length >= 2
                  ? t(lang, "moveTogether")
                  : selected.length === 1
                    ? t(lang, "holdSecond")
                    : t(lang, "deselect")}
              </p>
              {selected.length === 2 && (
                <button type="button" className="primary" onClick={() => useApp.getState().makeCouple()}>
                  {t(lang, "makeCouple")}
                </button>
              )}
              <button type="button" onClick={clearSelection}>
                {t(lang, "deselect")}
              </button>
            </div>
          )}
        </div>
        {!viewing && <RightPanel />}
        {compact && !viewing && sheet === "family" && (
          <aside className="panel family-sheet">
            <FamilyTreeControls />
          </aside>
        )}
      </div>
      {compact && !viewing && sheet && (
        <div className="sheet-back" onClick={() => setSheet(undefined)} />
      )}
      {compact && !viewing && (
        <nav className="mobile-dock">
          <button
            type="button"
            className={sheet === "family" ? "on" : ""}
            onClick={() => setSheet(sheet === "family" ? undefined : "family")}
          >
            {t(lang, "family")}
          </button>
          <button
            type="button"
            className={sheet === "people" ? "on" : ""}
            onClick={() => setSheet(sheet === "people" ? undefined : "people")}
          >
            {t(lang, "people")}
          </button>
          <button
            type="button"
            className={sheet === "edit" ? "on" : ""}
            onClick={() => setSheet(sheet === "edit" ? undefined : "edit")}
          >
            {t(lang, "edit")}
          </button>
        </nav>
      )}
      <Modals />
    </div>
  );
}
