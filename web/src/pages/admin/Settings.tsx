import { useMemo, useState } from "react";
import { put } from "../../lib/api";
import { t } from "../../lib/i18n";
import type { Image, Limits } from "../../lib/types";
import { Button, ErrorState, Field, Loading, OsTile, useApi, useToast } from "../../components/ui";
import { LimitsEditor, LIMIT_FIELDS, toDraft, type LimitDraft } from "../../components/LimitsEditor";
import { DiskIcon, DomainIcon, SaveIcon, UsersIcon } from "../../components/icons";

type Data = { settings: Record<string, string>; images: Image[] };

export function AdminSettings() {
  const { data, error, loading, reload } = useApi<Data>("/api/admin/settings");
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorState error={error} retry={reload} />;
  return <Form data={data} reload={reload} />;
}

function Form({ data, reload }: { data: Data; reload: () => void }) {
  const toast = useToast();
  const s = data.settings;
  const [publicHost, setPublicHost] = useState(s.public_host);
  const [portStart, setPortStart] = useState(s.ssh_port_start);
  const [portEnd, setPortEnd] = useState(s.ssh_port_end);
  const [acme, setAcme] = useState(s.acme_email);
  const [defaults, setDefaults] = useState<LimitDraft>(() =>
    toDraft(Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, s[`default_${f.key}`] === "" ? null : Number(s[`default_${f.key}`])])) as Partial<Limits>),
  );
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set(JSON.parse(s.disabled_images || "[]")));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");


  const families = useMemo(() => {
    const map = new Map<string, Image[]>();
    for (const i of data.images) map.set(i.family, [...(map.get(i.family) || []), i]);
    return [...map.entries()];
  }, [data.images]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const body: Record<string, string> = {
        public_host: publicHost,
        ssh_port_start: portStart,
        ssh_port_end: portEnd,
        acme_email: acme,
        disabled_images: JSON.stringify([...disabled]),
      };
      for (const f of LIMIT_FIELDS) body[`default_${f.key}`] = defaults[f.key];
      await put("/api/admin/settings", body);
      toast(t("Settings saved"));
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Settings")}</h1>
          <p>{t("How this server is reached, and what new users get by default.")}</p>
        </div>
        <Button variant="primary" icon={<SaveIcon size={16} />} loading={busy} onClick={save}>{t("Save settings")}</Button>
      </div>
      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}
      <div className="stack" style={{ maxWidth: 860 }}>
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="h-icon"><DomainIcon size={18} />{t("Network access")}</h2>
              <p>{t("Each container gets one host port forwarded to its SSH server.")}</p>
            </div>
          </div>
          <div className="card-body">
            <div className="grid grid-2">
              <Field label={t("Public address")} hint={t("IP or host name users connect to. Domains must point here.")} htmlFor="s-host">
                <input id="s-host" className="input mono" placeholder="203.0.113.10" value={publicHost} onChange={(e) => setPublicHost(e.target.value.trim())} />
              </Field>
              <Field label={t("SSH port range")} hint={t("Open this range in your firewall or cloud provider.")}>
                <div className="input-row">
                  <input aria-label={t("First port")} className="input mono" inputMode="numeric" value={portStart} onChange={(e) => setPortStart(e.target.value.replace(/\D/g, ""))} />
                  <input aria-label={t("Last port")} className="input mono" inputMode="numeric" value={portEnd} onChange={(e) => setPortEnd(e.target.value.replace(/\D/g, ""))} />
                </div>
              </Field>
            </div>
            <div style={{ marginTop: 14 }}>
              <Field label={t("Let's Encrypt email")} hint={t("Optional. Receives certificate expiry notices for custom domains.")} htmlFor="s-acme">
                <input id="s-acme" className="input" type="email" value={acme} onChange={(e) => setAcme(e.target.value.trim())} />
              </Field>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="h-icon"><UsersIcon size={18} />{t("Default limits for new users")}</h2>
              <p>{t("Applied when you create a user. You can change them per user afterwards.")}</p>
            </div>
          </div>
          <div className="card-body">
            <LimitsEditor value={defaults} onChange={setDefaults} />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="h-icon"><DiskIcon size={18} />{t("Operating systems")}</h2>
              <p>{t("Uncheck the systems you don't want users to install.")}</p>
            </div>
            <span className="muted mono">{data.images.length - disabled.size} / {data.images.length}</span>
          </div>
          <div className="card-body" style={{ display: "grid", gap: 14 }}>
            {families.map(([family, list]) => (
              <div key={family} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <OsTile family={family} />
                <div>
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>{list[0].name}</div>
                  <div style={{ display: "flex", gap: "6px 16px", flexWrap: "wrap" }}>
                    {list.map((i) => (
                      <label key={i.id} className="check">
                        <input type="checkbox" checked={!disabled.has(i.id)} onChange={(e) => {
                          const next = new Set(disabled);
                          if (e.target.checked) next.delete(i.id);
                          else next.add(i.id);
                          setDisabled(next);
                        }} />
                        {i.version}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
