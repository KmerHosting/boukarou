import type { CSSProperties } from "react";
import { t } from "../lib/i18n";

// Grey placeholders shaped like the content that is loading.
export function Skel({ w = "100%", h = 12, r = 5, style }: { w?: number | string; h?: number; r?: number; style?: CSSProperties }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}

function Busy({ children }: { children: React.ReactNode }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("Loading…")}</span>
      {children}
    </div>
  );
}

export function PageHeadSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="page-head">
      <div style={{ display: "grid", gap: 9 }}>
        <Skel w={190} h={22} />
        <Skel w={280} h={12} />
      </div>
      {action && <Skel w={150} h={34} r={6} />}
    </div>
  );
}

export function TableSkeleton({ rows = 4, cols = 6, icon = true }: { rows?: number; cols?: number; icon?: boolean }) {
  return (
    <div className="card table-wrap">
      <div className="skel-row skel-head">
        {Array.from({ length: cols }).map((_, i) => <Skel key={i} w={i === 0 ? 90 : 60} h={10} />)}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skel-row">
          <div style={{ display: "flex", gap: 11, alignItems: "center", minWidth: 0 }}>
            {icon && <Skel w={32} h={32} r={7} />}
            <div style={{ display: "grid", gap: 6 }}>
              <Skel w={120} h={12} />
              <Skel w={80} h={10} />
            </div>
          </div>
          {Array.from({ length: cols - 1 }).map((_, i) => <Skel key={i} w={i % 2 ? 50 : 72} h={12} />)}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ lines = 3, title = true, height }: { lines?: number; title?: boolean; height?: number }) {
  return (
    <div className="card">
      {title && (
        <div className="card-head">
          <Skel w={150} h={15} />
        </div>
      )}
      <div className="card-body" style={{ display: "grid", gap: 12, minHeight: height }}>
        {Array.from({ length: lines }).map((_, i) => <Skel key={i} w={`${[92, 70, 84, 60, 76][i % 5]}%`} h={12} />)}
      </div>
    </div>
  );
}

export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-${count}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card stat" style={{ display: "grid", gap: 10 }}>
          <Skel w={90} h={11} />
          <Skel w={70} h={22} />
          <Skel w="80%" h={10} />
          <Skel w="100%" h={6} r={3} />
        </div>
      ))}
    </div>
  );
}

export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="list-row">
          <div style={{ display: "grid", gap: 7, flex: 1 }}>
            <Skel w={`${[45, 60, 38, 52, 41][i % 5]}%`} h={12} />
            <Skel w={110} h={10} />
          </div>
          <Skel w={70} h={28} r={6} />
        </div>
      ))}
    </div>
  );
}

// ---- page-level skeletons ----

export function ListPageSkeleton() {
  return (
    <Busy>
      <PageHeadSkeleton />
      <div className="stack">
        <div className="card quota">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><Skel w={70} h={11} /><Skel w={50} h={11} /></div>
              <Skel h={6} r={3} />
            </div>
          ))}
        </div>
        <TableSkeleton />
      </div>
    </Busy>
  );
}

export function TablePageSkeleton({ cols = 6, icon = false }: { cols?: number; icon?: boolean }) {
  return (
    <Busy>
      <PageHeadSkeleton />
      <TableSkeleton rows={5} cols={cols} icon={icon} />
    </Busy>
  );
}

export function DetailPageSkeleton() {
  return (
    <Busy>
      <Skel w={160} h={11} style={{ marginBottom: 12 }} />
      <div className="inst-head">
        <Skel w={40} h={40} r={9} />
        <div style={{ display: "grid", gap: 8 }}>
          <Skel w={170} h={20} />
          <Skel w={300} h={11} />
        </div>
        <div className="actions" style={{ display: "flex", gap: 6 }}>
          {[96, 92, 86, 70].map((w, i) => <Skel key={i} w={w} h={34} r={6} />)}
        </div>
      </div>
      <div className="tabs" style={{ gap: 18, paddingBottom: 12 }}>
        {[80, 74, 90, 76, 66, 72, 70].map((w, i) => <Skel key={i} w={w} h={14} />)}
      </div>
      <div className="stack">
        <div className="grid grid-2">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
        </div>
        <CardSkeleton lines={2} />
        <CardSkeleton lines={4} height={180} />
      </div>
    </Busy>
  );
}

export function FormPageSkeleton({ aside = false }: { aside?: boolean }) {
  const main = (
    <div className="stack">
      <CardSkeleton lines={2} />
      <CardSkeleton lines={4} height={140} />
      <CardSkeleton lines={3} />
    </div>
  );
  return (
    <Busy>
      <PageHeadSkeleton action={!aside} />
      {aside ? (
        <div className="split">
          {main}
          <CardSkeleton lines={6} />
        </div>
      ) : (
        <div style={{ maxWidth: 860 }}>{main}</div>
      )}
    </Busy>
  );
}

export function StatsPageSkeleton() {
  return (
    <Busy>
      <PageHeadSkeleton />
      <div className="stack">
        <StatsSkeleton />
        <div className="grid grid-2">
          <CardSkeleton lines={8} />
          <RowsSkeleton rows={6} />
        </div>
      </div>
    </Busy>
  );
}

export function RowsPageSkeleton() {
  return (
    <Busy>
      <PageHeadSkeleton action={false} />
      <RowsSkeleton rows={8} />
    </Busy>
  );
}

/** Before we know who is signed in: an empty top bar and a list skeleton. */
export function AppSkeleton() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Skel w={120} h={22} />
          <Skel w={110} h={14} />
          <Skel w={80} h={14} />
          <div className="topbar-right"><Skel w={90} h={28} r={6} /></div>
        </div>
      </header>
      <main className="page">
        <ListPageSkeleton />
      </main>
    </>
  );
}

export function ChartsSkeleton() {
  return (
    <div className="grid grid-2" style={{ gap: 28 }} aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><Skel w={70} h={13} /><Skel w={50} h={13} /></div>
          <Skel h={120} r={6} />
        </div>
      ))}
    </div>
  );
}
