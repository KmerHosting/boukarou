import { useMemo, useRef, useState } from "react";
import { shortDate, shortTime } from "../lib/format";

type Series = { label: string; color: string; values: number[] };

export function LineChart({
  times, series, format, max, rangeMs,
}: { times: number[]; series: Series[]; format: (n: number) => string; max?: number; rangeMs: number }) {
  const W = 600;
  const H = 120;
  const PAD_L = 0;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const top = useMemo(() => {
    const m = Math.max(1, ...series.flatMap((s) => s.values));
    if (max) return max;
    // round up to a "nice" number
    const p = 10 ** Math.floor(Math.log10(m));
    return Math.ceil(m / p) * p;
  }, [series, max]);

  const end = times.length ? times[times.length - 1] : Date.now();
  const start = end - rangeMs;
  const x = (t: number) => PAD_L + ((t - start) / rangeMs) * (W - PAD_L);
  const y = (v: number) => H - (Math.min(v, top) / top) * (H - 6) - 1;

  const paths = series.map((s) => {
    if (!times.length) return { line: "", area: "" };
    const pts = times.map((t, i) => `${x(t).toFixed(1)},${y(s.values[i]).toFixed(1)}`);
    return {
      line: `M${pts.join("L")}`,
      area: `M${x(times[0]).toFixed(1)},${H}L${pts.join("L")}L${x(times[times.length - 1]).toFixed(1)},${H}Z`,
    };
  });

  function onMove(e: React.MouseEvent) {
    if (!ref.current || !times.length) return;
    const r = ref.current.getBoundingClientRect();
    const t = start + ((e.clientX - r.left) / r.width) * rangeMs;
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
    setHover(best);
  }

  const label = rangeMs > 24 * 3600e3 ? shortDate : shortTime;

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={onMove} role="img">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} className="grid-line" x1={0} x2={W} y1={H * f} y2={H * f} vectorEffect="non-scaling-stroke" strokeDasharray="2 4" />
        ))}
        <line className="grid-line" x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} vectorEffect="non-scaling-stroke" />
        {paths.map((p, i) => (
          <g key={i}>
            <path d={p.area} fill={series[i].color} opacity={0.1} />
            <path d={p.line} fill="none" stroke={series[i].color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </g>
        ))}
        {hover != null && (
          <line x1={x(times[hover])} x2={x(times[hover])} y1={0} y2={H} stroke="var(--faint)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: `${(x(times[hover]) / W) * 100}%` }}>
          {label(times[hover])} · {series.map((s) => format(s.values[hover])).join(" / ")}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }} className="axis-row">
        <span className="faint mono" style={{ fontSize: 10.5 }}>{label(start)}</span>
        <span className="faint mono" style={{ fontSize: 10.5 }}>{format(top)} max</span>
        <span className="faint mono" style={{ fontSize: 10.5 }}>{label(end)}</span>
      </div>
    </div>
  );
}
