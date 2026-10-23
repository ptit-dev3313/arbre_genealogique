import { t } from "../lib/i18n";
import { couplesForPerson, parentCouples, personLabel, treesWithPerson } from "../lib/model";
import { useApp } from "../store";
import { PersonFace } from "./PersonFace";

export function ViewerBar() {
  const lang = useApp((s) => s.lang);
  const families = useApp((s) => s.families);
  const currentId = useApp((s) => s.currentId);
  const family = useApp((s) => s.family());
  const switchFamily = useApp((s) => s.switchFamily);
  const switchTree = useApp((s) => s.switchTree);
  const setViewing = useApp((s) => s.setViewing);
  const fitCamera = useApp((s) => s.fitCamera);
  return (
    <div className="viewer-bar">
      <button type="button" className="primary" onClick={() => setViewing(false)}>
        {t(lang, "edit")}
      </button>
      <div className="viewer-selects">
        <select className="viewer-select" value={currentId} onChange={(e) => void switchFamily(e.target.value)}>
          {families.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select className="viewer-select" value={family.currentTree} onChange={(e) => switchTree(e.target.value)}>
          {family.trees.map((tree) => (
            <option key={tree.id} value={tree.id}>
              {tree.name}
            </option>
          ))}
        </select>
      </div>
      <button type="button" onClick={() => fitCamera()}>
        {t(lang, "fitTree")}
      </button>
      <button type="button" onClick={() => void useApp.getState().exportPdf()}>
        {t(lang, "pdf")}
      </button>
    </div>
  );
}

export function ViewerSheet() {
  const lang = useApp((s) => s.lang);
  const family = useApp((s) => s.family());
  const selected = useApp((s) => s.selected);
  const showPhotos = useApp((s) => s.showPhotos);
  const personId = selected[0];
  const person = personId ? family.persons[personId] : undefined;
  if (!person || !personId) return null;
  return (
    <div className="viewer-sheet">
      <div className="viewer-sheet-head">
        <PersonFace person={person} showPhoto={showPhotos} mini />
        <div>
          <strong>{personLabel(person)}</strong>
          <span className="muted">{person.labels.join(" · ")}</span>
        </div>
      </div>
      <h3>{t(lang, "treesWith")}</h3>
      {treesWithPerson(family, personId).length === 0 && <p className="muted">—</p>}
      <div className="chip-row">
        {treesWithPerson(family, personId).map((item) => (
          <button
            key={item.id}
            type="button"
            className={`chip${item.id === family.currentTree ? " on" : ""}`}
            onClick={() => useApp.getState().focusPersonOnTree(item.id, personId)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <h3>{t(lang, "parents")}</h3>
      {parentCouples(family, personId).length === 0 && <p className="muted">—</p>}
      {parentCouples(family, personId).map((couple) => (
        <p key={couple.id} className="pair-names">
          <span>{personLabel(family.persons[couple.person1] ?? { name: "?", family_name: "", labels: [] })}</span>
          <span className="pair-sep">·</span>
          <span>{personLabel(family.persons[couple.person2] ?? { name: "?", family_name: "", labels: [] })}</span>
        </p>
      ))}
      <h3>{t(lang, "couple")}</h3>
      {couplesForPerson(family, personId).length === 0 && <p className="muted">—</p>}
      {couplesForPerson(family, personId).map((couple) => (
        <p key={couple.id}>
          {personLabel(family.persons[couple.person1 === personId ? couple.person2 : couple.person1] ?? { name: "?", family_name: "", labels: [] })}
        </p>
      ))}
    </div>
  );
}
