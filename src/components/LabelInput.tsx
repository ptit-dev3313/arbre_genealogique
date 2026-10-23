import { useState } from "react";
import { t } from "../lib/i18n";
import { familyLabels, normalizeLabels } from "../lib/model";
import { useApp } from "../store";

export function LabelInput({
  onAdd,
  disabled,
  exclude = [],
}: {
  onAdd: (label: string) => void;
  disabled?: boolean;
  exclude?: string[];
}) {
  const lang = useApp((s) => s.lang);
  const family = useApp((s) => s.family());
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const known = familyLabels(family);
  const taken = new Set(exclude.map((item) => item.toLowerCase()));
  const q = draft.trim().toLowerCase();
  const existing = known.filter((label) => !taken.has(label.toLowerCase()) && (!q || label.toLowerCase().includes(q)));
  const canCreate = Boolean(q) && !known.some((label) => label.toLowerCase() === q) && !taken.has(q);
  const rows = canCreate ? ["__new__", ...existing] : existing;
  const shown = open && !disabled && (draft.length > 0 || existing.length > 0);

  function commit(raw: string) {
    const [label] = normalizeLabels([raw === "__new__" ? draft : raw]);
    if (!label) return;
    onAdd(label);
    setDraft("");
    setOpen(false);
    setHi(0);
  }

  return (
    <div className="label-combo">
      <input
        value={draft}
        disabled={disabled}
        placeholder={t(lang, "addLabel")}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            return;
          }
          if (e.key === "ArrowDown" && rows.length) {
            e.preventDefault();
            setOpen(true);
            setHi((n) => (n + 1) % rows.length);
            return;
          }
          if (e.key === "ArrowUp" && rows.length) {
            e.preventDefault();
            setOpen(true);
            setHi((n) => (n - 1 + rows.length) % rows.length);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (shown && rows[hi]) commit(rows[hi]);
            else commit(draft);
          }
        }}
      />
      {shown && rows.length > 0 && (
        <ul className="label-combo-list" role="listbox">
          {rows.map((item, index) => (
            <li key={item}>
              <button
                type="button"
                className={index === hi ? "on" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(item)}
              >
                {item === "__new__" ? `${t(lang, "addLabel")} « ${draft.trim()} »` : item}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
