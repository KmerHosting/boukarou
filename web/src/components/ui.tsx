import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import type { Status } from "../lib/types";

// ---------- logo ----------
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <path d="M16 6 6.5 15.5h2.5V25h14v-9.5h2.5z" fill="var(--surface)" />
      <path d="M14 25v-5.2a2 2 0 0 1 4 0V25z" fill="var(--accent)" />
    </svg>
  );
}

export function HutIllustration() {
  return (
    <svg className="hut" width="64" height="56" viewBox="0 0 64 56" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M32 4 6 26h52z" />
      <path d="M12 26v24h40V26" />
      <path d="M27 50V38a5 5 0 0 1 10 0v12" />
      <path d="M2 50h60" strokeLinecap="round" />
    </svg>
  );
}

// ---------- button ----------
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "danger" | "danger-solid" | "ghost" | "default";
  size?: "sm" | "md";
  loading?: boolean;
};
export function Button({ variant = "default", size = "md", loading, children, className = "", disabled, ...rest }: BtnProps) {
  const cls = ["btn", variant !== "default" && `btn-${variant}`, size === "sm" && "btn-sm", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} disabled={disabled || loading} {...rest}>
      {loading && <span className="spin" aria-hidden="true" />}
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

// ---------- OS tile ----------
const OS_COLORS: Record<string, [string, string]> = {
  ubuntu: ["#c9542c", "Ub"],
  debian: ["#a3123a", "De"],
  alpine: ["#1f5e86", "Al"],
  rocky: ["#10875a", "Rk"],
  alma: ["#2a62b5", "Am"],
  centos: ["#5b2f8f", "Ce"],
  fedora: ["#294172", "Fe"],
  amazon: ["#b86b00", "Az"],
  arch: ["#1478b8", "Ar"],
  gentoo: ["#54487a", "Ge"],
  oracle: ["#b0281e", "Or"],
  openeuler: ["#1f4fa0", "oE"],
  opensuse: ["#3d8f47", "Su"],
  devuan: ["#5a5d63", "Dv"],
  mint: ["#5d9e3a", "Mi"],
  alt: ["#c08a0a", "Alt"],
};
export function OsTile({ family, large }: { family: string; large?: boolean }) {
  const [bg, label] = OS_COLORS[family] || ["#6e6a63", "Lx"];
  return (
    <span className={`os${large ? " os-lg" : ""}`} style={{ background: bg }} aria-hidden="true">
      {label}
    </span>
  );
}

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
      <button type="button" aria-label={t("Decrease {x}", { x: label })} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>−</button>
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
      <button type="button" aria-label={t("Increase {x}", { x: label })} disabled={max != null && value >= max} onClick={() => onChange(clamp(value + step))}>+</button>
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
  title, description, word, action, onConfirm, onClose, children,
}: {
  title: string; description: ReactNode; word?: string; action: string;
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
    <Modal title={title} description={description} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{t("I saved it")}</Button>}>
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

export function Loading() {
  return (
    <div className="loading">
      <span className="spin" />
    </div>
  );
}

export function ErrorState({ error, retry }: { error: ApiError | null; retry?: () => void }) {
  return (
    <div className="card card-pad">
      <div className="error-box">{error?.message || t("Something went wrong.")}</div>
      {retry && (
        <div style={{ marginTop: 12 }}>
          <Button onClick={retry}>{t("Try again")}</Button>
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
