import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import type { Status } from "../lib/types";
import { CheckIcon, CopyIcon, MinusIcon, PlusIcon, RetryIcon } from "./icons";

export { Logo } from "./Logo";

// ---------- button ----------
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "danger" | "danger-solid" | "ghost" | "default";
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
};
export function Button({ variant = "default", size = "md", loading, icon, children, className = "", disabled, ...rest }: BtnProps) {
  const cls = ["btn", variant !== "default" && `btn-${variant}`, size === "sm" && "btn-sm", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

// ---------- status ----------
const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  stopped: "Stopped",
  frozen: "Frozen",
  failed: "Failed",
  creating: "Creating",
  reinstalling: "Reinstalling",
  deleting: "Deleting",
  unknown: "Unknown",
};
export function StatusBadge({ status, busy }: { status: Status; busy?: string | null }) {
  const label = busy && !["creating", "reinstalling", "deleting"].includes(status) ? t("Working…") : t(STATUS_LABEL[status] || status);
  return (
    <span className={`status ${busy && status !== "creating" ? "busy" : status}`}>
      <i />
      {label}
    </span>
  );
}

export { OsTile } from "./OsLogo";

// ---------- meter ----------
export function Meter({ value, max }: { value: number; max: number | null }) {
  if (!max) return <div className="meter"><i style={{ width: "0%" }} /></div>;
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className={`meter ${pct >= 100 ? "bad" : pct >= 85 ? "warn" : ""}`} role="meter" aria-valuenow={value} aria-valuemax={max}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------- stepper ----------
export function Stepper({
  value, onChange, min = 1, max, step = 1, label,
}: { value: number; onChange: (n: number) => void; min?: number; max?: number | null; step?: number; label: string }) {
  const clamp = (n: number) => Math.max(min, max != null ? Math.min(max, n) : n);
  return (
    <div className="stepper">
      <button type="button" aria-label={t("Decrease {x}", { x: label })} disabled={value <= min} onClick={() => onChange(clamp(value - step))}><MinusIcon size={14} /></button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
          onChange(Number.isFinite(n) ? n : min);
        }}
        onBlur={() => onChange(clamp(value))}
      />
      <button type="button" aria-label={t("Increase {x}", { x: label })} disabled={max != null && value >= max} onClick={() => onChange(clamp(value + step))}><PlusIcon size={14} /></button>
    </div>
  );
}

// ---------- copy ----------
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={done ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.append(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? t("Copied") : label || t("Copy")}
    </Button>
  );
}

// ---------- modal ----------
export function Modal({
  title, description, children, footer, onClose, wide,
}: { title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {children && <div className="modal-body">{children}</div>}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Danger confirmation that requires typing a word (usually the resource name). */
export function ConfirmModal({
  title, description, word, action, onConfirm, onClose, children, icon,
}: {
  title: string; description: ReactNode; word?: string; action: string; icon?: ReactNode;
  onConfirm: () => Promise<unknown>; onClose: () => void; children?: ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = !word || typed.trim() === word;
  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button
            variant="danger-solid"
            icon={icon}
            disabled={!ok}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {action}
          </Button>
        </>
      }
    >
      {children}
      {word && (
        <div className="field" style={children ? { marginTop: 14 } : undefined}>
          <label className="label" htmlFor="confirm-word">
            {t("Type {w} to confirm", { w: word })}
          </label>
          <input id="confirm-word" className="input mono" autoFocus autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}

export function SecretModal({ title, description, secret, onClose }: { title: string; description: ReactNode; secret: string; onClose: () => void }) {
  return (
    <Modal title={title} description={description} onClose={onClose} footer={<Button variant="primary" icon={<CheckIcon size={16} />} onClick={onClose}>{t("I saved it")}</Button>}>
      <div className="secret">
        <span>{secret}</span>
        <CopyButton text={secret} />
      </div>
    </Modal>
  );
}

// ---------- toasts ----------
type Toast = { id: number; text: string; bad?: boolean };
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, bad }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), bad ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast${i.bad ? " bad" : ""}`}>{i.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- data hook ----------
export function useApi<T>(path: string | null, { poll }: { poll?: number | ((d: T | undefined) => number | false) } = {}) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const dataRef = useRef<T | undefined>(undefined);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      dataRef.current = d;
      setData(d);
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);
  useEffect(() => {
    if (!poll) return;
    let timer: number;
    const tick = () => {
      const ms = typeof poll === "function" ? poll(dataRef.current) : poll;
      if (!ms) {
        timer = window.setTimeout(tick, 5000);
        return;
      }
      timer = window.setTimeout(async () => {
        if (!document.hidden) await load();
        tick();
      }, ms);
    };
    tick();
    return () => clearTimeout(timer);
  }, [poll, load]);
  return { data, error, loading, reload: load, setData };
}

export function ErrorState({ error, retry }: { error: ApiError | null; retry?: () => void }) {
  return (
    <div className="card card-pad">
      <div className="error-box">{error?.message || t("Something went wrong.")}</div>
      {retry && (
        <div style={{ marginTop: 12 }}>
          <Button icon={<RetryIcon size={16} />} onClick={retry}>{t("Try again")}</Button>
        </div>
      )}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
