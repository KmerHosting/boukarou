import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { post } from "../lib/api";
import { t } from "../lib/i18n";
import { memory } from "../lib/format";
import type { Image, Instance, Limits, Usage } from "../lib/types";
import { Button, ErrorState, Field, Loading, OsTile, Stepper, useApi } from "../components/ui";
import { ContainerIcon, CpuIcon, DiskIcon, KeyIcon, PlusIcon, ShuffleIcon } from "../components/icons";

type Overview = { usage: Usage; limits: Limits; diskQuotaEnforced: boolean; host: { cpus: number; memoryMb: number } };

const WORDS = ["baobab", "okapi", "mango", "kola", "safou", "ndole", "ebene", "iroko", "sanaga", "wouri", "manengouba", "bamenda", "kribi", "limbe"];
const suggestName = () => `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.floor(100 + Math.random() * 900)}`;

const PRESETS = [
  { key: "small", label: "Small", cpu: 1, mem: 1024, disk: 10 },
  { key: "medium", label: "Medium", cpu: 2, mem: 4096, disk: 40 },
  { key: "large", label: "Large", cpu: 4, mem: 8192, disk: 80 },
];

export function NewContainer() {
  const overview = useApi<Overview>("/api/overview");
  const images = useApi<{ images: Image[] }>("/api/images");
  if ((overview.loading && !overview.data) || (images.loading && !images.data)) return <Loading />;
  if (!overview.data || !images.data) return <ErrorState error={overview.error || images.error} retry={() => { overview.reload(); images.reload(); }} />;
  return <Form overview={overview.data} images={images.data.images} />;
}

function Form({ overview, images }: { overview: Overview; images: Image[] }) {
  const navigate = useNavigate();
  const { usage, limits } = overview;
  const remaining = {
    cpu: limits.max_cpu == null ? null : Math.max(0, limits.max_cpu - usage.cpu),
    mem: limits.max_memory_mb == null ? null : Math.max(0, limits.max_memory_mb - usage.memoryMb),
    disk: limits.max_disk_gb == null ? null : Math.max(0, limits.max_disk_gb - usage.diskGb),
  };
  const families = useMemo(() => {
    const map = new Map<string, Image[]>();
    for (const i of images) map.set(i.family, [...(map.get(i.family) || []), i]);
    return [...map.entries()];
  }, [images]);

  const fit = (want: number, max: number | null, min: number) => Math.max(min, max == null ? want : Math.min(want, max));
  const [name, setName] = useState(suggestName);
  const [imageId, setImageId] = useState(images.find((i) => i.id === "ubuntu-24.04")?.id || images[0]?.id || "");
  const [familyPick, setFamilyPick] = useState<Record<string, string>>({});
  const [cpu, setCpu] = useState(fit(1, remaining.cpu, 1));
  const [mem, setMem] = useState(fit(1024, remaining.mem, 128));
  const [disk, setDisk] = useState(fit(10, remaining.disk, 1));
  const [sshKey, setSshKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const full = limits.max_instances != null && usage.instances >= limits.max_instances;
  const noRoom = (remaining.cpu ?? 1) < 1 || (remaining.mem ?? 128) < 128 || (remaining.disk ?? 1) < 1;
  const selected = images.find((i) => i.id === imageId);
  const nameOk = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await post<{ instance: Instance }>("/api/instances", { name, imageId, cpu, memoryMb: mem, diskGb: disk, sshKey: sshKey.trim() || undefined });
      navigate(`/c/${r.instance.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="crumbs">
        <Link to="/">{t("Containers")}</Link> <span>/</span> <span>{t("New")}</span>
      </div>
      <div className="page-head">
        <div>
          <h1>{t("New container")}</h1>
          <p>{t("Pick a system and the resources it needs. You can resize it later.")}</p>
        </div>
      </div>

      {(full || noRoom) && (
        <div className="warn-box" style={{ marginBottom: 16 }}>
          {full ? t("You have reached your container limit. Delete a container or ask your administrator for more.") : t("Your resource limits are fully used. Resize or delete a container, or ask your administrator for more.")}
        </div>
      )}

      <div className="split">
        <div className="stack">
          <section className="card">
            <div className="card-head"><h2 className="h-icon"><ContainerIcon size={18} />{t("Name")}</h2></div>
            <div className="card-body">
              <Field label={t("Container name")} hint={t("Lowercase letters, digits and hyphens. Also used as the hostname.")} htmlFor="name">
                <div className="input-row">
                  <input id="name" className="input mono" value={name} aria-invalid={!nameOk} spellCheck={false} autoComplete="off" maxLength={32} onChange={(e) => setName(e.target.value.toLowerCase())} />
                  <Button icon={<ShuffleIcon size={16} />} onClick={() => setName(suggestName())}>{t("Suggest")}</Button>
                </div>
              </Field>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2 className="h-icon"><DiskIcon size={18} />{t("Operating system")}</h2></div>
            <div className="card-body">
              <div className="os-grid">
                {families.map(([family, list]) => {
                  const current = list.find((i) => i.id === imageId) || list.find((i) => i.id === familyPick[family]) || list[0];
                  const on = current.id === imageId;
                  return (
                    <div key={family} className={`os-card${on ? " on" : ""}`} role="button" tabIndex={0} aria-pressed={on}
                      onClick={() => setImageId(current.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setImageId(current.id))}>
                      <OsTile family={family} />
                      <div style={{ minWidth: 0 }}>
                        <div className="t">{list[0].name}</div>
                        {list.length > 1 ? (
                          <select aria-label={t("{x} version", { x: list[0].name })} value={current.id} onClick={(e) => e.stopPropagation()}
                            onChange={(e) => { setFamilyPick({ ...familyPick, [family]: e.target.value }); setImageId(e.target.value); }}>
                            {list.map((i) => <option key={i.id} value={i.id}>{i.version}</option>)}
                          </select>
                        ) : (
                          <div className="muted" style={{ fontSize: 12.5 }}>{list[0].version}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2 className="h-icon"><CpuIcon size={18} />{t("Resources")}</h2>
                <p>{t("Only what you allocate counts against your limits.")}</p>
              </div>
            </div>
            <div className="card-body">
              <div className="preset-row">
                {PRESETS.map((p) => (
                  <button type="button" key={p.key} className="preset" onClick={() => { setCpu(fit(p.cpu, remaining.cpu, 1)); setMem(fit(p.mem, remaining.mem, 128)); setDisk(fit(p.disk, remaining.disk, 1)); }}>
                    <b>{t(p.label)}</b>
                    <span>{p.cpu} vCPU · {memory(p.mem)} · {p.disk} GB</span>
                  </button>
                ))}
              </div>
              <div className="res-grid">
                <Field label={t("vCPU")} hint={remaining.cpu == null ? t("Host has {n} cores", { n: overview.host.cpus }) : t("{n} available", { n: remaining.cpu })}>
                  <Stepper label={t("vCPU")} value={cpu} onChange={setCpu} min={1} max={remaining.cpu ?? overview.host.cpus} />
                </Field>
                <Field label={t("Memory (MB)")} hint={remaining.mem == null ? t("Host has {n}", { n: memory(overview.host.memoryMb) }) : t("{n} available", { n: memory(remaining.mem) })}>
                  <Stepper label={t("Memory (MB)")} value={mem} onChange={setMem} min={128} step={256} max={remaining.mem} />
                </Field>
                <Field label={t("Disk (GB)")} hint={remaining.disk == null ? t("No limit") : t("{n} GB available", { n: remaining.disk })}>
                  <Stepper label={t("Disk (GB)")} value={disk} onChange={setDisk} min={1} step={5} max={remaining.disk} />
                </Field>
              </div>
              {!overview.diskQuotaEnforced && (
                <p className="hint" style={{ marginTop: 12 }}>{t("This server's storage does not enforce disk sizes. The size is recorded but not applied.")}</p>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2 className="h-icon"><KeyIcon size={18} />{t("SSH key")} <span className="muted" style={{ fontWeight: 400 }}>· {t("optional")}</span></h2>
                <p>{t("A root password is always generated. Add a public key to sign in without it.")}</p>
              </div>
              {!showKey && <Button size="sm" icon={<KeyIcon size={15} />} onClick={() => setShowKey(true)}>{t("Add key")}</Button>}
            </div>
            {showKey && (
              <div className="card-body">
                <textarea className="textarea" placeholder="ssh-ed25519 AAAA… you@laptop" value={sshKey} onChange={(e) => setSshKey(e.target.value)} spellCheck={false} />
              </div>
            )}
          </section>
        </div>

        <aside className="card summary" style={{ position: "sticky", top: 76 }}>
          <div className="card-head"><h2>{t("Summary")}</h2></div>
          <div className="card-body">
            <dl>
              <dt>{t("Name")}</dt><dd>{name || "—"}</dd>
              <dt>{t("System")}</dt><dd>{selected ? `${selected.name} ${selected.version}` : "—"}</dd>
              <dt>{t("vCPU")}</dt><dd>{cpu}</dd>
              <dt>{t("Memory")}</dt><dd>{memory(mem)}</dd>
              <dt>{t("Disk")}</dt><dd>{disk} GB</dd>
              <dt>{t("Access")}</dt><dd>{sshKey.trim() ? t("Password + key") : t("Password")}</dd>
            </dl>
            {error && <p className="form-error">{error}</p>}
            <Button type="submit" variant="primary" icon={<PlusIcon size={16} weight="bold" />} loading={busy} disabled={!nameOk || !imageId || full || noRoom} style={{ width: "100%", marginTop: 18, height: 38 }}>
              {t("Create container")}
            </Button>
            <p className="hint" style={{ marginTop: 10 }}>{t("The first container from a system takes longer while the image downloads.")}</p>
          </div>
        </aside>
      </div>
    </form>
  );
}
