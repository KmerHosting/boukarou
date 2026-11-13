import { FormEvent, useState } from "react";
import { del, post } from "../../lib/api";
import { t } from "../../lib/i18n";
import type { Instance } from "../../lib/types";
import { Button, ConfirmModal, Field, Loading, useApi, useToast } from "../../components/ui";

type Domain = { id: string; domain: string; targetPort: number; status: string; error: string | null };
type Resp = { available: boolean; reason: string | null; publicHost: string | null; domains: Domain[] };

export function DomainsTab({ inst }: { inst: Instance }) {
  const toast = useToast();
  const { data, loading, reload } = useApi<Resp>(`/api/instances/${inst.id}/domains`, {
    poll: (d) => (d?.domains.some((x) => x.status === "provisioning" || x.status === "deleting") ? 3000 : false),
  });
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState("80");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remove, setRemove] = useState<Domain | null>(null);

  if (loading && !data) return <Loading />;
  if (!data) return null;

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(`/api/instances/${inst.id}/domains`, { domain, targetPort: Number(port) });
      setDomain("");
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>{t("Add a domain")}</h2>
            <p>{t("Serve a website from this container on your own domain, with a free HTTPS certificate.")}</p>
          </div>
        </div>
        <div className="card-body">
          {!data.available ? (
            <div className="info-box">{data.reason}</div>
          ) : (
            <form onSubmit={add}>
              <ol className="muted" style={{ margin: "0 0 16px", paddingLeft: 18, lineHeight: 1.8 }}>
                <li>{t("At your DNS provider, create an A record for the domain pointing to")} <b className="mono" style={{ color: "var(--text)" }}>{data.publicHost}</b>.</li>
                <li>{t("Make sure your app listens on the port below inside the container.")}</li>
                <li>{t("Add the domain. The certificate is issued automatically.")}</li>
              </ol>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px auto", gap: 10, alignItems: "end" }}>
                <Field label={t("Domain")} htmlFor="dom">
                  <input id="dom" className="input mono" placeholder="app.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} autoComplete="off" spellCheck={false} />
                </Field>
                <Field label={t("Port")} htmlFor="port">
                  <input id="port" className="input mono" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} />
                </Field>
                <Button type="submit" variant="primary" loading={busy} disabled={!domain || !port}>{t("Add domain")}</Button>
              </div>
              {error && <p className="form-error">{error}</p>}
            </form>
          )}
        </div>
      </section>

      <section className="card">
        {data.domains.length === 0 ? (
          <div className="card-body muted">{t("No domains yet.")}</div>
        ) : (
          data.domains.map((d) => (
            <div key={d.id} className="list-row">
              <div style={{ minWidth: 0 }}>
                <div className="mono">
                  {d.status === "active" ? <a href={`https://${d.domain}`} target="_blank" rel="noreferrer">{d.domain}</a> : d.domain}
                  <span className="faint"> → :{d.targetPort}</span>
                </div>
                {d.error && <div className="hint" style={{ color: "var(--bad)" }}>{d.error}</div>}
              </div>
              <div className="btn-group" style={{ alignItems: "center" }}>
                <span className={`tag ${d.status === "active" ? "tag-ok" : d.status === "failed" ? "tag-bad" : "tag-warn"}`}>
                  {d.status === "active" ? t("HTTPS active") : d.status === "failed" ? t("Failed") : d.status === "deleting" ? t("Removing") : t("Issuing certificate")}
                </span>
                {d.status !== "deleting" && d.status !== "provisioning" && <Button size="sm" variant="danger" onClick={() => setRemove(d)}>{t("Remove")}</Button>}
              </div>
            </div>
          ))
        )}
      </section>

      {remove && (
        <ConfirmModal
          title={t("Remove {d}?", { d: remove.domain })}
          description={t("The domain stops pointing to this container and its certificate is deleted.")}
          action={t("Remove domain")}
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await del(`/api/instances/${inst.id}/domains/${remove.id}`);
            toast(t("Domain removed"));
            reload();
          }}
        />
      )}
    </div>
  );
}
