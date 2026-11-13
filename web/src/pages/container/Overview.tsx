import { useState } from "react";
import { t } from "../../lib/i18n";
import { bytes, memory, rate } from "../../lib/format";
import { CopyButton, Meter, useApi } from "../../components/ui";
import { LineChart } from "../../components/Chart";
import { sshLine } from "../Containers";
import type { Detail } from "../Container";
import { ActivityIcon, ChartIcon, DomainIcon, KeyIcon } from "../../components/icons";
import { ChartsSkeleton } from "../../components/Skeleton";

type Point = { at: number; cpu: number; memUsed: number; memTotal: number; diskUsed: number; rx: number; tx: number; processes: number };
const RANGES: [string, number][] = [["1h", 3600e3], ["6h", 6 * 3600e3], ["24h", 24 * 3600e3], ["7d", 7 * 24 * 3600e3]];

export function OverviewTab({ d }: { d: Detail }) {
  const inst = d.instance;
  const [range, setRange] = useState("1h");
  const metrics = useApi<{ points: Point[] }>(`/api/instances/${inst.id}/metrics?range=${range}`, { poll: 60_000 });
  const points = metrics.data?.points || [];
  const last = points[points.length - 1];
  const times = points.map((p) => p.at);
  const rangeMs = RANGES.find(([k]) => k === range)![1];
  const ssh = sshLine(inst);
  const quotaBytes = d.traffic.quotaGb != null ? d.traffic.quotaGb * 1e9 : null;
  const used = d.traffic.rx + d.traffic.tx;

  return (
    <div className="stack">
      <div className="grid grid-2">
        <section className="card">
          <div className="card-head"><h2 className="h-icon"><KeyIcon size={18} />{t("Connect")}</h2></div>
          <div className="card-body">
            {ssh ? (
              <div className="copy-line"><span>{ssh}</span><CopyButton text={ssh} /></div>
            ) : (
              <p className="muted">{t("SSH is not configured for this container.")}</p>
            )}
            <dl className="kv" style={{ marginTop: 16 }}>
              <dt>{t("User")}</dt><dd className="mono">root</dd>
              <dt>{t("SSH port")}</dt><dd className="mono">{inst.sshPort ?? "-"}</dd>
              <dt>{t("Private IPv4")}</dt><dd className="mono">{d.live?.ipv4 || inst.ipv4 || "-"}</dd>
              <dt>{t("IPv6")}</dt><dd className="mono">{d.live?.ipv6 || inst.ipv6 || "-"}</dd>
              <dt>{t("Sign-in")}</dt><dd>{inst.hasSshKey ? t("Password or SSH key") : t("Password")}</dd>
            </dl>
            {!inst.sshHost && <p className="hint" style={{ marginTop: 12 }}>{t("The administrator has not set the server's public address, so the command uses this page's address.")}</p>}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2 className="h-icon"><ActivityIcon size={18} />{t("Now")}</h2></div>
          <div className="card-body">
            <dl className="kv">
              <dt>{t("CPU")}</dt><dd className="mono">{last ? `${last.cpu}%` : "-"} <span className="faint">{t("of {n} vCPU", { n: inst.cpu })}</span></dd>
              <dt>{t("Memory")}</dt><dd className="mono">{d.live ? bytes(d.live.memUsed) : "-"} <span className="faint">/ {memory(inst.memoryMb)}</span></dd>
              <dt>{t("Disk used")}</dt><dd className="mono">{last ? bytes(last.diskUsed) : "-"} <span className="faint">/ {inst.diskGb} GB</span></dd>
              <dt>{t("Processes")}</dt><dd className="mono">{d.live?.processes ?? "-"}</dd>
              <dt>{t("Network")}</dt><dd className="mono">↓ {last ? rate(last.rx) : "-"} | ↑ {last ? rate(last.tx) : "-"}</dd>
            </dl>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="h-icon"><DomainIcon size={18} />{t("Traffic this month")}</h2>
            <p>{t("Counted in and out. Resets on the 1st (UTC).")}</p>
          </div>
          <span className="mono">{bytes(used)} <span className="faint">/ {quotaBytes == null ? t("unlimited") : bytes(quotaBytes)}</span></span>
        </div>
        <div className="card-body">
          {quotaBytes != null && <Meter value={used} max={quotaBytes} />}
          <p className="hint" style={{ marginTop: quotaBytes != null ? 10 : 0 }}>
            ↓ {bytes(d.traffic.rx)} {t("received")} | ↑ {bytes(d.traffic.tx)} {t("sent")}
            {inst.trafficBlocked && <> | <span style={{ color: "var(--bad)" }}>{t("Quota reached: network is limited until next month.")}</span></>}
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="h-icon"><ChartIcon size={18} />{t("Usage")}</h2>
          <div className="seg" role="group" aria-label={t("Time range")}>
            {RANGES.map(([k]) => (
              <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{k}</button>
            ))}
          </div>
        </div>
        <div className="card-body">
          {metrics.loading && !metrics.data ? (
            <ChartsSkeleton />
          ) : points.length < 2 ? (
            <p className="muted">{t("Metrics appear a couple of minutes after the container starts. They are sampled every minute.")}</p>
          ) : (
            <div className="grid grid-2" style={{ gap: 28 }}>
              <div>
                <div className="chart-head"><h3>{t("CPU")}</h3><span className="v">{last.cpu}%</span></div>
                <LineChart times={times} rangeMs={rangeMs} max={100} format={(n) => `${Math.round(n)}%`} series={[{ label: "CPU", color: "var(--chart-1)", values: points.map((p) => p.cpu) }]} />
              </div>
              <div>
                <div className="chart-head"><h3>{t("Memory")}</h3><span className="v">{bytes(last.memUsed)}</span></div>
                <LineChart times={times} rangeMs={rangeMs} max={inst.memoryMb * 1048576} format={(n) => bytes(n)} series={[{ label: "RAM", color: "var(--chart-1)", values: points.map((p) => p.memUsed) }]} />
              </div>
              <div>
                <div className="chart-head">
                  <h3>{t("Network")}</h3>
                  <span className="chart-legend"><span><i style={{ background: "var(--chart-1)" }} />{t("in")}</span><span><i style={{ background: "var(--chart-2)" }} />{t("out")}</span></span>
                </div>
                <LineChart times={times} rangeMs={rangeMs} format={rate} series={[
                  { label: "in", color: "var(--chart-1)", values: points.map((p) => p.rx) },
                  { label: "out", color: "var(--chart-2)", values: points.map((p) => p.tx) },
                ]} />
              </div>
              <div>
                <div className="chart-head"><h3>{t("Disk")}</h3><span className="v">{bytes(last.diskUsed)}</span></div>
                <LineChart times={times} rangeMs={rangeMs} max={inst.diskGb * 1e9} format={(n) => bytes(n)} series={[{ label: "disk", color: "var(--chart-2)", values: points.map((p) => p.diskUsed) }]} />
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
