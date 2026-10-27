import { useEffect, useRef, useState } from "react";
import {
  authError,
  inviteToFamily,
  listShares,
  releaseLock,
  revokeShare,
  setMemberTrees,
  type FamilyShare,
} from "../lib/cloud";
import { importFamilyBytes } from "../lib/bundle";
import { t } from "../lib/i18n";
import { lifeDateError } from "../lib/lifeDates";
import {
  canEditCardSize,
  canEditGap,
  isCloud,
  isOwner,
  normalizeLabels,
  suggestedChildCell,
  suggestedPartnerCell,
  validatePersonNames,
  type Person,
} from "../lib/model";
import { LabelInput } from "./LabelInput";
import { CROP_CIRCLE, CROP_VIEW, clampCrop, cropToJpeg, fileToCrop, type CropDraft } from "../lib/photo";
import { authRedirectUrl, cloudConfigured, supabase } from "../lib/supabase";
import { useApp } from "../store";

export function Modals() {
  const modal = useApp((s) => s.modal);
  const setModal = useApp((s) => s.setModal);
  if (!modal) return <ImportListener />;
  return (
    <>
      <ImportListener />
      <div className="modal-back">
        <div className={`modal${modal.kind === "share" ? " wide" : ""}`}>
          {modal.kind === "auth" && <AuthModal />}
          {modal.kind === "account" && <AccountModal />}
          {modal.kind === "password" && <PasswordModal />}
          {modal.kind === "person" && (
            <PersonModal personId={modal.personId} childOf={modal.childOf} partnerOf={modal.partnerOf} />
          )}
          {modal.kind === "share" && <ShareModal />}
          {modal.kind === "display" && <DisplayModal />}
          {modal.kind === "confirm" && (
            <>
              <p>{modal.message}</p>
              <button type="button" className="primary" onClick={() => { modal.action(); setModal(undefined); }}>
                {t(useApp.getState().lang, "confirm")}
              </button>
              <button type="button" onClick={() => setModal(undefined)}>
                {t(useApp.getState().lang, "cancel")}
              </button>
            </>
          )}
          {modal.kind === "message" && (
            <>
              <p>{modal.message}</p>
              <button type="button" onClick={() => setModal(undefined)}>
                {t(useApp.getState().lang, "cancel")}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ImportListener() {
  useEffect(() => {
    const input = document.getElementById("import-file") as HTMLInputElement | null;
    if (input) return;
    const el = document.createElement("input");
    el.id = "import-file";
    el.type = "file";
    el.accept = "application/zip,.zip,application/json,.json";
    el.className = "hidden";
    el.onchange = async () => {
      const file = el.files?.[0];
      el.value = "";
      if (!file) return;
      try {
        const imported = importFamilyBytes(file.name, new Uint8Array(await file.arrayBuffer()));
        useApp.setState((state) => ({
          families: [...state.families, ...imported.families],
          currentId: imported.current,
        }));
        useApp.getState().persist();
        window.setTimeout(() => useApp.getState().fitCamera(), 50);
      } catch (err) {
        useApp.getState().setModal({ kind: "message", message: err instanceof Error ? err.message : String(err) });
      }
    };
    document.body.appendChild(el);
    return () => el.remove();
  }, []);
  return null;
}

function AuthModal() {
  const lang = useApp((s) => s.lang);
  const user = useApp((s) => s.user);
  const setModal = useApp((s) => s.setModal);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");

  if (!cloudConfigured) {
    return <>
      <p>La synchronisation en ligne est indisponible. Vos arbres restent enregistrés sur cet appareil.</p>
      <button type="button" onClick={() => setModal(undefined)}>{t(lang, "cancel")}</button>
    </>;
  }

  async function signOut() {
    const family = useApp.getState().family();
    if (useApp.getState().lockToken && family.cloudId) {
      await releaseLock(family.cloudId, useApp.getState().lockToken!);
    }
    await supabase.auth.signOut();
    setModal(undefined);
  }

  if (user) {
    return (
      <>
        <h2>{user.email}</h2>
        <button type="button" className="primary modal-btn-lg" onClick={() => void signOut()}>
          {t(lang, "signOut")}
        </button>
        <button type="button" onClick={() => setModal(undefined)}>
          {t(lang, "cancel")}
        </button>
      </>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (mode === "in") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: authRedirectUrl },
        });
        if (err) throw err;
      }
      setModal(undefined);
    } catch (err) {
      setError(authError(err));
    }
  }

  async function forgot() {
    setError("");
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl });
    setError(err ? authError(err) : "E-mail envoyé.");
  }

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)}>
      <h2>{mode === "in" ? t(lang, "signIn") : t(lang, "signUp")}</h2>
      <label>
        {t(lang, "email")}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        {t(lang, "password")}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
      </label>
      <p className="error">{error}</p>
      <button type="submit" className="primary modal-btn-lg">
        {mode === "in" ? t(lang, "signIn") : t(lang, "signUp")}
      </button>
      <button type="button" className="linkish" onClick={() => setMode(mode === "in" ? "up" : "in")}>
        {mode === "in" ? t(lang, "signUp") : t(lang, "signIn")}
      </button>
      <button type="button" className="linkish" onClick={() => void forgot()}>
        {t(lang, "forgot")}
      </button>
      <button type="button" onClick={() => setModal(undefined)}>
        {t(lang, "cancel")}
      </button>
    </form>
  );
}

function AccountModal() {
  const lang = useApp((s) => s.lang);
  const user = useApp((s) => s.user);
  const setModal = useApp((s) => s.setModal);

  return (
    <div className="account-modal">
      <h2>{t(lang, "account")}</h2>
      {user?.email && <p className="account-email">{user.email}</p>}
      <p className="account-explain">{t(lang, "accountExplain")}</p>
      <button type="button" onClick={() => setModal({ kind: "password" })}>
        {t(lang, "changePassword")}
      </button>
      <button type="button" onClick={() => setModal(undefined)}>
        {t(lang, "close")}
      </button>
    </div>
  );
}

function PasswordModal() {
  const lang = useApp((s) => s.lang);
  const user = useApp((s) => s.user);
  const setModal = useApp((s) => s.setModal);
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="auth-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        if (password !== confirm) {
          setError(t(lang, "passwordMismatch"));
          return;
        }
        const email = user?.email;
        if (!email) {
          setError(authError("non authentifié"));
          return;
        }
        void (async () => {
          const { error: check } = await supabase.auth.signInWithPassword({ email, password: oldPassword });
          if (check) {
            setError(authError(check));
            return;
          }
          const { error: err } = await supabase.auth.updateUser({ password });
          if (err) setError(authError(err));
          else setModal({ kind: "account" });
        })();
      }}
    >
      <h2>{t(lang, "changePassword")}</h2>
      <label>
        {t(lang, "oldPassword")}
        <input
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          required
          minLength={6}
        />
      </label>
      <label>
        {t(lang, "newPassword")}
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
      </label>
      <label>
        {t(lang, "confirmPassword")}
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={6}
        />
      </label>
      <p className="error">{error}</p>
      <button type="submit" className="primary modal-btn-lg">
        {t(lang, "changePassword")}
      </button>
      <button type="button" onClick={() => setModal({ kind: "account" })}>
        {t(lang, "cancel")}
      </button>
    </form>
  );
}

function PersonModal({ personId, childOf, partnerOf }: { personId?: string; childOf?: string; partnerOf?: string }) {
  const lang = useApp((s) => s.lang);
  const family = useApp((s) => s.family());
  const addPerson = useApp((s) => s.addPerson);
  const addChild = useApp((s) => s.addChild);
  const linkCouple = useApp((s) => s.linkCouple);
  const updatePerson = useApp((s) => s.updatePerson);
  const setModal = useApp((s) => s.setModal);
  const existing = personId ? family.persons[personId] : undefined;
  const parents = childOf ? family.couples.find((item) => item.id === childOf) : undefined;
  const partner = partnerOf ? family.persons[partnerOf] : undefined;
  const sharedName =
    parents && family.persons[parents.person1]?.family_name === family.persons[parents.person2]?.family_name
      ? family.persons[parents.person1]?.family_name ?? ""
      : partner?.family_name ?? "";
  const photoUrls = useApp((s) => s.photoUrls);
  const [name, setName] = useState(existing?.name ?? "");
  const [familyName, setFamilyName] = useState(existing?.family_name ?? sharedName);
  const [birthDate, setBirthDate] = useState(existing?.birth_date ?? "");
  const [deathDate, setDeathDate] = useState(existing?.death_date ?? "");
  const [labels, setLabels] = useState(existing?.labels ?? []);
  const [photo, setPhoto] = useState(existing?.photo);
  const [crop, setCrop] = useState<CropDraft>();
  const [fileKey, setFileKey] = useState(0);
  const [error, setError] = useState("");

  async function onFile(file: File) {
    try {
      setError("");
      setFileKey((n) => n + 1);
      setCrop(await fileToCrop(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function clearPhoto() {
    setPhoto(undefined);
    setCrop(undefined);
    setFileKey((n) => n + 1);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const [n, f] = validatePersonNames(name, familyName);
          const dateError = lifeDateError(birthDate, deathDate);
          if (dateError) throw new Error(t(lang, dateError));
          const person: Person = {
            name: n, family_name: f, labels: normalizeLabels(labels), photo,
            birth_date: birthDate || undefined, death_date: deathDate || undefined,
          };
          if (personId) updatePerson(personId, person);
          else {
            const id = addPerson(
              person,
              childOf
                ? suggestedChildCell(useApp.getState().family(), childOf)
                : partnerOf
                  ? suggestedPartnerCell(useApp.getState().family(), partnerOf)
                  : undefined,
            );
            if (!id) return;
            if (childOf) addChild(childOf, id);
            if (partnerOf) linkCouple(partnerOf, id);
          }
          setModal(undefined);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <h2>
        {personId ? t(lang, "editPerson") : childOf ? t(lang, "addChild") : partnerOf ? t(lang, "addPartner") : t(lang, "addPerson")}
      </h2>
      <label>
        {t(lang, "givenName")}
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        {t(lang, "familyName")}
        <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
      </label>
      <label>
        {t(lang, "birthDate")}
        <input type="date" value={birthDate} min="0001-01-01" max={deathDate || "9999-12-31"} onChange={(e) => setBirthDate(e.target.value)} />
      </label>
      <label>
        {t(lang, "deathDate")}
        <input type="date" value={deathDate} min={birthDate || "0001-01-01"} max="9999-12-31" onChange={(e) => setDeathDate(e.target.value)} />
      </label>
      <div className="tag-editor">
        {labels.map((label) => (
          <span key={label} className="tag">
            {label}
            <button type="button" className="tag-x" onClick={() => setLabels(labels.filter((item) => item !== label))}>
              ×
            </button>
          </span>
        ))}
        <LabelInput
          exclude={labels}
          onAdd={(label) => {
            setLabels(normalizeLabels([...labels, label]));
          }}
        />
      </div>
      <label>
        {t(lang, "photo")}
        <input
          key={fileKey}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onFile(file);
          }}
        />
      </label>
      {crop && (
        <CropBox
          draft={crop}
          onChange={setCrop}
          onDone={async (next) => {
            const data = await cropToJpeg(next);
            setPhoto({ data, rev: String(Date.now()) });
            setCrop(undefined);
            setFileKey((n) => n + 1);
          }}
        />
      )}
      {photo?.data && !crop && <img className="photo-preview" src={photo.data} alt="" />}
      {!photo?.data && photo?.path && !crop && photoUrls[photo.path] && (
        <img className="photo-preview" src={photoUrls[photo.path]} alt="" />
      )}
      {(photo?.data || photo?.path) && !crop && (
        <button type="button" onClick={clearPhoto}>
          {t(lang, "removePhoto")}
        </button>
      )}
      <p className="error">{error}</p>
      <button type="submit" className="primary">
        {t(lang, "confirm")}
      </button>
      <button type="button" onClick={() => setModal(undefined)}>
        {t(lang, "cancel")}
      </button>
    </form>
  );
}

function CropBox({ draft, onChange, onDone }: { draft: CropDraft; onChange: (d: CropDraft) => void; onDone: (d: CropDraft) => void }) {
  const lang = useApp((s) => s.lang);
  const view = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ id: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const pinch = useRef<{ dist: number; scale: number; panX: number; panY: number; cx: number; cy: number } | null>(null);

  function viewPoint(clientX: number, clientY: number) {
    const rect = view.current!.getBoundingClientRect();
    const sx = rect.width / CROP_VIEW;
    const sy = rect.height / CROP_VIEW;
    return { x: (clientX - rect.left) / sx, y: (clientY - rect.top) / sy };
  }

  function zoomAround(nextScale: number, cx: number, cy: number, from = draftRef.current) {
    const k = nextScale / from.scale;
    onChange(clampCrop({ ...from, scale: nextScale, panX: cx - (cx - from.panX) * k, panY: cy - (cy - from.panY) * k }));
  }

  return (
    <>
      <p className="muted crop-hint">{t(lang, "pinchZoom")}</p>
      <div
        ref={view}
        className="crop-view"
        style={{ width: CROP_VIEW, height: CROP_VIEW }}
        onPointerDown={(e) => {
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size >= 2) {
            pan.current = null;
            const [a, b] = [...pointers.current.values()];
            const p1 = viewPoint(a.x, a.y);
            const p2 = viewPoint(b.x, b.y);
            const d = draftRef.current;
            pinch.current = {
              dist: Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)),
              scale: d.scale,
              panX: d.panX,
              panY: d.panY,
              cx: (p1.x + p2.x) / 2,
              cy: (p1.y + p2.y) / 2,
            };
            return;
          }
          pinch.current = null;
          pan.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            panX: draftRef.current.panX,
            panY: draftRef.current.panY,
          };
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pointers.current.size >= 2) {
            const origin = pinch.current;
            const [a, b] = [...pointers.current.values()];
            const factor = Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)) / origin.dist;
            zoomAround(origin.scale * factor, origin.cx, origin.cy, {
              ...draftRef.current,
              scale: origin.scale,
              panX: origin.panX,
              panY: origin.panY,
            });
            return;
          }
          const start = pan.current;
          if (!start || start.id !== e.pointerId) return;
          onChange(
            clampCrop({
              ...draftRef.current,
              panX: start.panX + e.clientX - start.x,
              panY: start.panY + e.clientY - start.y,
            }),
          );
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          if (pan.current?.id === e.pointerId) pan.current = null;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          pinch.current = null;
          pan.current = null;
        }}
        onWheel={(e) => {
          e.preventDefault();
          const p = viewPoint(e.clientX, e.clientY);
          zoomAround(draftRef.current.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08), p.x, p.y);
        }}
      >
        <img
          className="crop-image"
          src={draft.src}
          alt=""
          draggable={false}
          style={{
            width: draft.imgW * draft.scale,
            height: draft.imgH * draft.scale,
            transform: `translate(${draft.panX}px, ${draft.panY}px)`,
          }}
        />
        <div className="crop-mask" style={{ background: `radial-gradient(circle at center, transparent ${CROP_CIRCLE / 2}px, rgba(0,0,0,.55) ${CROP_CIRCLE / 2 + 1}px)` }} />
      </div>
      <div className="crop-zoom">
        <button type="button" onClick={() => zoomAround(draft.scale / 1.15, CROP_VIEW / 2, CROP_VIEW / 2)}>
          −
        </button>
        <button type="button" onClick={() => zoomAround(draft.scale * 1.15, CROP_VIEW / 2, CROP_VIEW / 2)}>
          +
        </button>
        <button type="button" className="primary" onClick={() => void onDone(draft)}>
          {t(lang, "crop")}
        </button>
      </div>
    </>
  );
}

function ShareModal() {
  const lang = useApp((s) => s.lang);
  const family = useApp((s) => s.families.find((item) => item.id === s.currentId) ?? s.families[0]);
  const goOnline = useApp((s) => s.goOnline);
  const goOffline = useApp((s) => s.goOffline);
  const setModal = useApp((s) => s.setModal);
  const [email, setEmail] = useState("");
  const [shares, setShares] = useState<FamilyShare[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteTrees, setInviteTrees] = useState(family.trees.map((tree) => tree.id));
  const [inviteDisplay, setInviteDisplay] = useState(false);
  const [inviteColors, setInviteColors] = useState(false);

  function reload() {
    if (!family?.cloudId) return;
    void listShares(family.cloudId).then(setShares).catch((err) => setError(authError(err)));
  }

  useEffect(() => {
    reload();
  }, [family?.cloudId]);

  async function saveShare(username: string, treeIds: string[], display: boolean, colors: boolean) {
    setError("");
    try {
      await setMemberTrees(family.cloudId!, username, treeIds, display, colors, display);
      setShares((list) =>
        list.map((item) =>
          item.username === username
            ? { ...item, tree_ids: treeIds, can_edit_gap: display, can_edit_card_size: display, can_edit_colors: colors }
            : item,
        ),
      );
    } catch (err) {
      setError(authError(err));
      reload();
    }
  }

  return (
    <div className="share-modal">
      <header className="share-head">
        <h2>{t(lang, "share")}</h2>
      </header>
      {!isCloud(family) ? (
        <button
          type="button"
          className="primary modal-btn-lg"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void goOnline()
              .catch((err) => setError(authError(err)))
              .finally(() => setBusy(false));
          }}
        >
          {t(lang, "goOnline")}
        </button>
      ) : (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void goOffline()
                .catch((err) => setError(authError(err)))
                .finally(() => setBusy(false));
            }}
          >
            {t(lang, "goOffline")}
          </button>
          {isOwner(family) && (
            <form
              className="invite-form"
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                void inviteToFamily(family.cloudId!, email, inviteTrees, inviteDisplay, inviteColors)
                  .then(() => {
                    setEmail("");
                    reload();
                  })
                  .catch((err) => setError(authError(err)));
              }}
            >
              <p className="share-section">{t(lang, "shareInvite")}</p>
              <p className="muted share-hint">{t(lang, "shareHint")}</p>
              <div className="share-invite-row">
                <input type="email" placeholder={t(lang, "email")} value={email} onChange={(e) => setEmail(e.target.value)} required />
                <button type="submit" className="primary">
                  {t(lang, "invite")}
                </button>
              </div>
              <ShareChips
                trees={family.trees}
                selected={inviteTrees}
                display={inviteDisplay}
                colors={inviteColors}
                onTrees={setInviteTrees}
                onDisplay={setInviteDisplay}
                onColors={setInviteColors}
              />
            </form>
          )}
          <div className="share-grid-wrap">
            <table className="share-grid">
              <thead>
                <tr>
                  <th>{t(lang, "email")}</th>
                  <th>{t(lang, "shareTrees")}</th>
                  <th>{t(lang, "sharePerms")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shares.map((share) => {
                  const locked = share.role === "owner" || !isOwner(family);
                  const display = share.role === "owner" || share.can_edit_gap || share.can_edit_card_size;
                  const colors = share.role === "owner" || share.can_edit_colors;
                  const treeIds = share.role === "owner" ? family.trees.map((tree) => tree.id) : share.tree_ids;
                  return (
                    <tr key={share.username}>
                      <td>
                        <div className="share-who">
                          <strong>{share.username}</strong>
                          <span className={`share-role${share.role === "owner" ? " owner" : ""}`}>
                            {share.role === "owner" ? t(lang, "owner") : t(lang, "editor")}
                          </span>
                        </div>
                      </td>
                      <td>
                        <ChipRow
                          items={family.trees.map((tree) => ({ id: tree.id, label: tree.name }))}
                          selected={treeIds}
                          disabled={locked}
                          onToggle={(id) => {
                            const next = treeIds.includes(id) ? treeIds.filter((item) => item !== id) : [...treeIds, id];
                            void saveShare(share.username, next, display, colors);
                          }}
                        />
                      </td>
                      <td>
                        <ChipRow
                          items={[
                            { id: "display", label: t(lang, "display") },
                            { id: "colors", label: t(lang, "colors") },
                          ]}
                          selected={[display ? "display" : "", colors ? "colors" : ""].filter(Boolean)}
                          disabled={locked}
                          onToggle={(id) => {
                            if (id === "display") void saveShare(share.username, treeIds, !display, colors);
                            else void saveShare(share.username, treeIds, display, !colors);
                          }}
                        />
                      </td>
                      <td>
                        {share.role !== "owner" && isOwner(family) && (
                          <button
                            type="button"
                            className="share-revoke"
                            onClick={() =>
                              void revokeShare(family.cloudId!, share.username)
                                .then(reload)
                                .catch((err) => setError(authError(err)))
                            }
                          >
                            {t(lang, "revoke")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="error">{error}</p>
      <button type="button" onClick={() => setModal(undefined)}>
        {t(lang, "cancel")}
      </button>
    </div>
  );
}

function ShareChips({
  trees,
  selected,
  display,
  colors,
  onTrees,
  onDisplay,
  onColors,
}: {
  trees: { id: string; name: string }[];
  selected: string[];
  display: boolean;
  colors: boolean;
  onTrees: (ids: string[]) => void;
  onDisplay: (value: boolean) => void;
  onColors: (value: boolean) => void;
}) {
  const lang = useApp((s) => s.lang);
  return (
    <div className="share-access">
      <p className="share-section">{t(lang, "shareTrees")}</p>
      <ChipRow
        items={trees.map((tree) => ({ id: tree.id, label: tree.name }))}
        selected={selected}
        onToggle={(id) => onTrees(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])}
      />
      <p className="share-section">{t(lang, "sharePerms")}</p>
      <ChipRow
        items={[
          { id: "display", label: t(lang, "display") },
          { id: "colors", label: t(lang, "colors") },
        ]}
        selected={[display ? "display" : "", colors ? "colors" : ""].filter(Boolean)}
        onToggle={(id) => (id === "display" ? onDisplay(!display) : onColors(!colors))}
      />
    </div>
  );
}

function ChipRow({
  items,
  selected,
  disabled,
  onToggle,
}: {
  items: { id: string; label: string }[];
  selected: string[];
  disabled?: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="chip-row">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`chip${selected.includes(item.id) ? " on" : ""}`}
          disabled={disabled}
          onClick={() => onToggle(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}


function DisplayModal() {
  const lang = useApp((s) => s.lang);
  const family = useApp((s) => s.family());
  const patchFamily = useApp((s) => s.patchFamily);
  const canMutate = useApp((s) => s.canMutate());
  const canGap = canMutate && canEditGap(family);
  const canCards = canMutate && canEditCardSize(family);
  const showPhotos = useApp((s) => s.showPhotos);
  const setShowPhotos = useApp((s) => s.setShowPhotos);
  const setModal = useApp((s) => s.setModal);
  return (
    <div className="display-modal">
      <h2>{t(lang, "display")}</h2>
      <label className="lane-row">
        {t(lang, "laneGap")}
        <input
          type="range"
          min={0}
          max={40}
          value={family.connector_lane_gap}
          disabled={!canGap}
          onChange={(e) => patchFamily((item) => ({ ...item, connector_lane_gap: Number(e.target.value) }))}
        />
      </label>
      <label className="lane-row">
        {t(lang, "busPos")}
        <input
          type="range"
          min={0}
          max={100}
          value={family.connector_bus_pos}
          disabled={!canGap}
          onChange={(e) => patchFamily((item) => ({ ...item, connector_bus_pos: Number(e.target.value) }))}
        />
      </label>
      <label className="lane-row">
        {t(lang, "cardW")}
        <input
          type="range"
          min={72}
          max={220}
          value={family.card_width}
          disabled={!canCards}
          onChange={(e) => patchFamily((item) => ({ ...item, card_width: Number(e.target.value) }))}
        />
      </label>
      <label className="lane-row">
        {t(lang, "cardH")}
        <input
          type="range"
          min={52}
          max={160}
          value={family.card_height}
          disabled={!canCards}
          onChange={(e) => patchFamily((item) => ({ ...item, card_height: Number(e.target.value) }))}
        />
      </label>
      <label className="lane-row">
        {t(lang, "photoSize")}
        <input
          type="range"
          min={24}
          max={240}
          value={family.photo_size}
          disabled={!canCards}
          onChange={(e) => patchFamily((item) => ({ ...item, photo_size: Number(e.target.value) }))}
        />
      </label>
      <label className="display-opt">
        <input type="checkbox" checked={showPhotos} onChange={(e) => setShowPhotos(e.target.checked)} />
        <span>{t(lang, "showPhotos")}</span>
      </label>
      <button type="button" onClick={() => setModal(undefined)}>
        {t(lang, "cancel")}
      </button>
    </div>
  );
}
