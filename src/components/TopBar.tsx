import { t } from "../lib/i18n";
import { canManageFamily, isCloud, isCloudMember } from "../lib/model";
import { useApp } from "../store";

export function TopBar() {
  const lang = useApp((s) => s.lang);
  const setLang = useApp((s) => s.setLang);
  const user = useApp((s) => s.user);
  const family = useApp((s) => s.family());
  const saving = useApp((s) => s.saving);
  const dirty = useApp((s) => s.dirty);
  const lockToken = useApp((s) => s.lockToken);
  const lockHolder = useApp((s) => s.lockHolder);
  const compact = useApp((s) => s.compact);
  const setModal = useApp((s) => s.setModal);
  const setViewing = useApp((s) => s.setViewing);

  const cloud = isCloud(family);
  const member = Boolean(user) && isCloudMember(family, user);
  const noAccess = Boolean(user) && cloud && !member;
  const occupied = member && Boolean(lockHolder) && !lockToken;
  const needsReconnect = cloud && !user;
  const syncClass = saving
    ? "busy"
    : occupied
      ? "occupied"
      : needsReconnect || noAccess || (cloud && dirty)
        ? "pending"
        : cloud && !dirty
          ? "saved"
          : "local";
  const syncLabel = saving
    ? t(lang, "saving")
    : occupied
      ? t(lang, "onlineBusy")
      : needsReconnect
        ? t(lang, "savedOnlineReconnect")
        : noAccess
          ? t(lang, "noAccess")
          : cloud && dirty
            ? t(lang, "unsavedOnline")
            : cloud
              ? t(lang, "saved")
              : t(lang, "onDevice");

  const shareBtn =
    canManageFamily(family) && (!cloud || (Boolean(user) && Boolean(lockToken))) ? (
      <button type="button" onClick={() => setModal({ kind: "share" })}>
        {t(lang, "share")}
      </button>
    ) : null;

  const extraActions = (
    <>
      <button type="button" onClick={() => void useApp.getState().exportPdf()}>
        {t(lang, "pdf")}
      </button>
      <button type="button" onClick={() => void useApp.getState().exportFamilyJson()}>
        {t(lang, "exportJson")}
      </button>
      <button type="button" onClick={() => document.getElementById("import-file")?.click()}>
        {t(lang, "importJson")}
      </button>
      {shareBtn}
      {compact && user && (
        <button type="button" onClick={() => setModal({ kind: "account" })}>
          {t(lang, "account")}
        </button>
      )}
      {compact && (
        <button type="button" onClick={() => setModal({ kind: "auth" })}>
          {user ? t(lang, "signOut") : t(lang, "account")}
        </button>
      )}
    </>
  );

  return (
    <header className={`topbar${compact ? " compact" : ""}`}>
      {!compact && <h1>{t(lang, "title")}</h1>}
      <div className="topbar-actions">
        {compact && <span className="topbar-family">{family.name}</span>}
        <button type="button" className="primary" onClick={() => setViewing(true)}>
          {t(lang, "view")}
        </button>
        {compact ? (
          <details className="more-menu">
            <summary>{t(lang, "more")}</summary>
            <div className="more-menu-list">{extraActions}</div>
          </details>
        ) : (
          extraActions
        )}
      </div>
      <div className="grow" />
      <select className="lang-select" value={lang} onChange={(e) => setLang(e.target.value === "en" ? "en" : "fr")}>
        <option value="fr">FR</option>
        <option value="en">EN</option>
      </select>
      {needsReconnect ? (
        <button
          type="button"
          className={`sync-pill ${syncClass} clickable`}
          title={t(lang, "needOnline")}
          onClick={() => setModal({ kind: "auth" })}
        >
          {syncLabel}
        </button>
      ) : noAccess ? (
        <span className={`sync-pill ${syncClass}`} title={t(lang, "noAccessHint")}>
          {syncLabel}
        </span>
      ) : (
        <span className={`sync-pill ${syncClass}`} title={occupied && lockHolder ? `${lockHolder} — ${t(lang, "busyLock")}` : undefined}>
          {syncLabel}
        </span>
      )}
      {user?.email && !compact && <span className="user">{user.email}</span>}
      {!compact && user && (
        <button type="button" onClick={() => setModal({ kind: "account" })}>
          {t(lang, "account")}
        </button>
      )}
      {!compact && (
        <button type="button" onClick={() => setModal({ kind: "auth" })}>
          {user ? t(lang, "signOut") : t(lang, "account")}
        </button>
      )}
    </header>
  );
}
