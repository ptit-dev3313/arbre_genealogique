import { LabelInput } from "./LabelInput";
import { t } from "../lib/i18n";
import {
  COUPLE_STATUS_KEYS,
  canDeletePerson,
  canEditColors,
  canEditCouple,
  couplesForPerson,
  findCouple,
  normalizeHex,
  parsePastedColor,
  parentCouples,
  personLabel,
  treesWithPerson,
  type Couple,
  type CoupleStatus,
  type FamilyDoc,
} from "../lib/model";
import { useApp } from "../store";

const STATUSES = Object.keys(COUPLE_STATUS_KEYS) as CoupleStatus[];
let lastCopiedColor: string | undefined;

function labelOf(family: FamilyDoc, id: string) {
  return personLabel(family.persons[id] ?? { name: "?", family_name: "", labels: [] });
}

function PairNames({ family, first, second }: { family: FamilyDoc; first: string; second: string }) {
  const lang = useApp((s) => s.lang);
  return (
    <p className="pair-names">
      <span>{labelOf(family, first)}</span>
      <span className="pair-sep">{t(lang, "and")}</span>
      <span>{labelOf(family, second)}</span>
    </p>
  );
}

export function RightPanel() {
  const lang = useApp((s) => s.lang);
  const family = useApp((s) => s.family());
  const selected = useApp((s) => s.selected);
  const selectedCouple = useApp((s) => s.selectedCouple);
  const makeCouple = useApp((s) => s.makeCouple);
  const unplaceSelected = useApp((s) => s.unplaceSelected);
  const deletePerson = useApp((s) => s.deletePerson);
  const setModal = useApp((s) => s.setModal);
  const canMutate = useApp((s) => s.canMutate());
  const pickPartnerFor = useApp((s) => s.pickPartnerFor);
  const personId = selected.length === 1 ? selected[0] : undefined;
  const person = personId ? family.persons[personId] : undefined;
  const parents = personId ? parentCouples(family, personId) : [];
  const asSpouse = personId ? couplesForPerson(family, personId) : [];
  const pairCouple = selected.length === 2 ? findCouple(family, selected[0], selected[1]) : undefined;
  const couple =
    family.couples.find((item) => item.id === selectedCouple) ??
    pairCouple ??
    (asSpouse.length === 1 ? asSpouse[0] : undefined);

  return (
    <aside className="panel right">
      <h2>{t(lang, "edit")}</h2>
      <button type="button" disabled={!canMutate} onClick={() => void useApp.getState().copyPeople(true)}>
        {t(lang, "copyTree")}
      </button>
      <button type="button" disabled={!canMutate} onClick={() => void useApp.getState().pastePeople()}>
        {t(lang, "pastePeople")}
      </button>
      {selected.length >= 2 && !selectedCouple && (
        <>
          <p className="muted">
            {selected.length} {t(lang, "people")}
          </p>
          <LabelInput disabled={!canMutate} onAdd={(label) => useApp.getState().addLabelToSelected(label)} />
          <button type="button" className="primary" disabled={!canMutate || selected.length !== 2} onClick={makeCouple}>
            {t(lang, "makeCouple")}
          </button>
          <button type="button" disabled={!canMutate} onClick={() => void useApp.getState().copyPeople()}>
            {t(lang, "copyPeople")}
          </button>
          <button type="button" disabled={!canMutate} onClick={unplaceSelected}>
            {t(lang, "removeFromTree")}
          </button>
        </>
      )}
      {person && personId && (
        <>
          <h3>{personLabel(person)}</h3>
          <LabelInput
            disabled={!canMutate}
            exclude={person.labels}
            onAdd={(label) => useApp.getState().addLabelToSelected(label)}
          />
          {person.labels.length > 0 && (
            <div className="chip-row">
              {person.labels.map((label) => (
                <span key={label} className="tag">
                  {label}
                </span>
              ))}
            </div>
          )}
          <button type="button" disabled={!canMutate} onClick={() => setModal({ kind: "person", personId })}>
            {t(lang, "editPerson")}
          </button>
          <button type="button" className="primary" disabled={!canMutate} onClick={() => setModal({ kind: "person", partnerOf: personId })}>
            {t(lang, "addPartner")}
          </button>
          <button
            type="button"
            disabled={!canMutate}
            onClick={() => useApp.setState({ pickPartnerFor: personId, pickChildFor: undefined })}
          >
            {pickPartnerFor === personId ? `${t(lang, "pickPartner")}…` : t(lang, "pickPartner")}
          </button>
          <button
            type="button"
            disabled={!canMutate || !canDeletePerson(family, personId)}
            onClick={() =>
              setModal({
                kind: "confirm",
                message: t(lang, "confirmDeletePerson"),
                action: () => deletePerson(personId),
              })
            }
          >
            {t(lang, "deletePerson")}
          </button>
          <button type="button" disabled={!canMutate} onClick={() => void useApp.getState().copyPeople()}>
            {t(lang, "copyPeople")}
          </button>
          <button type="button" disabled={!canMutate} onClick={unplaceSelected}>
            {t(lang, "removeFromTree")}
          </button>
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
          {parents.length === 0 && <p className="muted">—</p>}
          {parents.map((item) => (
            <PairNames key={item.id} family={family} first={item.person1} second={item.person2} />
          ))}
          {asSpouse.length > 1 && (
            <>
              <h3>{t(lang, "couple")}</h3>
              <div className="chip-row">
                {asSpouse.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`chip${couple?.id === item.id ? " on" : ""}`}
                    onClick={() => useApp.getState().selectCouple(item.id)}
                  >
                    {labelOf(family, item.person1 === personId ? item.person2 : item.person1)}
                  </button>
                ))}
              </div>
            </>
          )}
          {!couple && asSpouse.length === 0 && (
            <>
              <h3>{t(lang, "couple")}</h3>
              <p className="muted">—</p>
            </>
          )}
        </>
      )}
      {couple && <CoupleEditor couple={couple} showTitle={asSpouse.length <= 1} />}
    </aside>
  );
}

function CoupleEditor({ couple, showTitle = true }: { couple: Couple; showTitle?: boolean }) {
  const lang = useApp((s) => s.lang);
  const family = useApp((s) => s.family());
  const updateCouple = useApp((s) => s.updateCouple);
  const deleteCouple = useApp((s) => s.deleteCouple);
  const removeChild = useApp((s) => s.removeChild);
  const pickChildFor = useApp((s) => s.pickChildFor);
  const setModal = useApp((s) => s.setModal);
  const canMutate = useApp((s) => s.canMutate());
  return (
    <div className="stack">
      {showTitle && <h3>{t(lang, "couple")}</h3>}
      <PairNames family={family} first={couple.person1} second={couple.person2} />
      <select
        value={couple.status}
        disabled={!canMutate || !canEditCouple(family, couple)}
        onChange={(e) => updateCouple(couple.id, { status: e.target.value as CoupleStatus })}
      >
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {t(lang, COUPLE_STATUS_KEYS[status])}
          </option>
        ))}
      </select>
      <div className="color-row">
        <input
          type="color"
          title={couple.color}
          value={couple.color}
          disabled={!canMutate || !canEditColors(family)}
          onChange={(e) => updateCouple(couple.id, { color: normalizeHex(e.target.value) })}
        />
        <button
          type="button"
          className="icon"
          title={t(lang, "copyColor")}
          aria-label={t(lang, "copyColor")}
          disabled={!canMutate || !canEditColors(family)}
          onClick={() => {
            lastCopiedColor = couple.color;
            void navigator.clipboard.writeText(couple.color).catch(() => undefined);
          }}
        >
          {t(lang, "copyColor")}
        </button>
        <button
          type="button"
          className="icon"
          title={t(lang, "pasteColor")}
          aria-label={t(lang, "pasteColor")}
          disabled={!canMutate || !canEditColors(family)}
          onClick={() => {
            void navigator.clipboard.readText().then((text) => {
              const hex = parsePastedColor(text) ?? lastCopiedColor;
              if (hex) updateCouple(couple.id, { color: hex });
            }).catch(() => {
              if (lastCopiedColor) updateCouple(couple.id, { color: lastCopiedColor });
            });
          }}
        >
          {t(lang, "pasteColor")}
        </button>
      </div>
      <h3>{t(lang, "children")}</h3>
      {couple.childrens.map((id) => (
        <div key={id} className="child-row">
          <span>{labelOf(family, id)}</span>
          <button
            type="button"
            className="icon danger"
            title={t(lang, "removeChild")}
            aria-label={t(lang, "removeChild")}
            disabled={!canMutate || !canEditCouple(family, couple)}
            onClick={() => removeChild(couple.id, id)}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="primary" disabled={!canMutate} onClick={() => setModal({ kind: "person", childOf: couple.id })}>
        {t(lang, "addChild")}
      </button>
      <button type="button" disabled={!canMutate} onClick={() => useApp.setState({ pickChildFor: couple.id })}>
        {pickChildFor === couple.id ? `${t(lang, "pickOnTree")}…` : t(lang, "pickOnTree")}
      </button>
      <button
        type="button"
        disabled={!canMutate}
        onClick={() => setModal({ kind: "confirm", message: t(lang, "confirmDeleteCouple"), action: () => deleteCouple(couple.id) })}
      >
        {t(lang, "deleteCouple")}
      </button>
    </div>
  );
}
