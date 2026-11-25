import { useEffect, useRef, useState } from "react";

const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  bug: "M8 7h8v10a4 4 0 0 1-8 0V7z M9 3l2 4m4-4-2 4 M3 9h5m8 0h5 M3 14h5m8 0h5 M4 21l4-4m8 0 4 4 M12 11v8",
  folder: "M3 7V4h7l2 3h9v13H3V7z", users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-3.87",
  team: "M12 3l9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 16l9 5 9-5",
  chart: "M4 3v18h17 M8 16v-5m5 5V7m5 9V4", clock: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18 M12 7v5l3 2",
  card: "M3 5h18v14H3z M3 10h18 M7 15h3", settings: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  search: "M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14 M15 15l6 6", plus: "M12 5v14 M5 12h14", bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  chevron: "M9 5l7 7-7 7", down: "M6 9l6 6 6-6", close: "M6 6l12 12M6 18 18 6", check: "M5 12l4 4L19 6",
  logout: "M10 4H4v16h6 M10 12h11m-4-4 4 4-4 4", book: "M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3V4z M12 6v16",
  upload: "M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6", download: "M12 3v13 M7 11l5 5 5-5 M4 17v4h16v-4",
  message: "M3 3h18v14H8l-5 4V3z M7 7h10 M7 11h6", link: "M10 8l3-3a4 4 0 0 1 6 6l-3 3 M14 16l-3 3a4 4 0 0 1-6-6l3-3 M8 16l8-8",
  shield: "M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6l9-4z M8 12l3 3 5-6", menu: "M3 6h18M3 12h18M3 18h18",
};
export function Icon({ name, size = 20, ...props }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.bug} /></svg>; }
export function Avatar({ name = "?", small = false }) { return <span className={"avatar" + (small ? " small" : "")} aria-hidden="true">{name.split(" ").slice(0, 2).map(x => x[0]).join("").toUpperCase()}</span>; }
export function Badge({ children, kind }) { const value = String(kind || children || "").toLowerCase().replaceAll(" ", "-"); return <span className={"badge " + value}>{children}</span>; }
export function PageHead({ eyebrow, title, description, children }) { return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="muted">{description}</p>}</div><div className="head-actions">{children}</div></div>; }
export function Empty({ icon = "folder", title, children, action }) { return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={28} /></span><h3>{title}</h3><p className="muted">{children}</p>{action}</div>; }
export function Loading() { return <div className="loading-state" role="status"><span className="loading-ring" />Loading your workspace…</div>; }
export function ErrorNotice({ error, retry }) { return <div className="error-notice" role="alert"><p>{error.message || error}</p>{retry && <button className="secondary" onClick={retry}>Try again</button>}{error.status === 401 && <a className="button" href="/login">Sign in</a>}</div>; }
export function useResource(path, refreshKey = 0, interval = 0) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true; let timer;
    setState({ data: null, error: null, loading: true });
    async function load() {
      try { const { api } = await import("./client.js"); const data = await api(path); if (active) setState({ data, loading: false, error: null }); }
      catch (error) { if (active) setState(s => ({ ...s, loading: false, error })); }
      if (active && interval) timer = setTimeout(load, interval);
    }
    if (path) load(); else setState({ data: null, error: null, loading: false });
    return () => { active = false; clearTimeout(timer); };
  }, [path, refreshKey, version, interval]);
  return { ...state, reload: () => setVersion(x => x + 1) };
}
export function Resource({ resource, children }) { return resource.loading ? <Loading /> : resource.error ? <ErrorNotice error={resource.error} retry={resource.reload} /> : children(resource.data); }
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={"modal" + (wide ? " wide" : "")} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) { const r = ref.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }} aria-labelledby="modal-title"><div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button secondary" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>{children}</dialog>;
}
export function ActionForm({ onSubmit, children, label = "Save changes", className = "", disabled = false }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const locked = useRef(false);
  return <form className={"action-form " + className} onSubmit={async event => {
    event.preventDefault(); if (locked.current) return; locked.current = true; setBusy(true); setError(""); const form = event.currentTarget;
    try { await onSubmit(Object.fromEntries(new FormData(form)), form); } catch (e) { setError(e.message); } finally { locked.current = false; setBusy(false); }
  }}><fieldset disabled={busy || disabled}>{children}</fieldset>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button disabled={busy || disabled}>{busy ? "Saving…" : label}</button></div></form>;
}
export function Metrics({ items }) { return <div className="metrics">{items.map(({ label, value, note, icon }) => <article className="metric" key={label}><div className="metric-top"><span>{label}</span><Icon name={icon || "chart"} size={19} /></div><strong>{value}</strong>{note && <p>{note}</p>}</article>)}</div>; }
export function ConfirmButton({ children, onConfirm, message, className = "secondary danger" }) {
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <><button type="button" className={className} onClick={() => setConfirm(true)}>{children}</button>{confirm && <Modal title="Confirm this change" onClose={() => !busy && setConfirm(false)}><p>{message}</p>{error && <p role="alert" className="form-error">{error}</p>}<div className="form-actions"><button className="secondary" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button className="danger-button" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); setConfirm(false); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>Confirm</button></div></Modal>}</>;
}
