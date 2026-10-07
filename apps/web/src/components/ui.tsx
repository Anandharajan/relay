import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="empty">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      <strong style={{ color: 'var(--text)' }}>{title}</strong>
      {children}
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  return error ? <div className="error-box">{error}</div> : null;
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

const statusTone: Record<string, string> = {
  ai: 'brand', escalated: 'warn', human: 'info', resolved: 'ok', ready: 'ok', processing: 'info', queued: 'muted', error: 'bad',
  ok: 'ok', failing: 'bad', drift: 'warn', unknown: '', done: 'ok', running: 'info', failed: 'bad', pending_approval: 'warn', rejected: 'bad',
};
const statusLabel: Record<string, string> = { ai: 'AI', escalated: 'Needs human', human: 'Human', resolved: 'Resolved', pending_approval: 'Awaiting approval', drift: 'Schema drift' };

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusTone[status] ?? ''}`}>{statusLabel[status] ?? status}</span>;
}

export function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return <span className="avatar" title={name}>{initials || '?'}</span>;
}

// ---------- toasts ----------
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      className="btn sm"
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        toast('Copied to clipboard');
      }}
    >
      {label}
    </button>
  );
}
