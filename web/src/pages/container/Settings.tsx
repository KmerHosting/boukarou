import { useState } from "react";
import { useNavigate } from "react-router";
import { del, post } from "../../lib/api";
import { t } from "../../lib/i18n";
import type { Image } from "../../lib/types";
import { Button, ConfirmModal, Field, useApi, useToast } from "../../components/ui";
import type { Detail } from "../Container";
import { KeyIcon, PasswordIcon, ReinstallIcon, TrashIcon } from "../../components/icons";

export function SettingsTab({ d, reload, onPassword }: { d: Detail; reload: () => void; onPassword: (p: string) => void }) {
  const inst = d.instance;
  const toast = useToast();
  const navigate = useNavigate();
  const images = useApi<{ images: Image[] }>("/api/images");
  const [pwBusy, setPwBusy] = useState(false);
  const [imageId, setImageId] = useState(inst.image.id);
  const [sshKey, setSshKey] = useState("");
  const [confirmReinstall, setConfirmReinstall] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const running = inst.status === "running";

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="h-icon"><PasswordIcon size={18} />{t("Root password")}</h2>
            <p>{t("Generate a new root password. The old one stops working right away.")}</p>
          </div>
          <Button icon={<KeyIcon size={16} />} loading={pwBusy} disabled={!running} onClick={async () => {
            setPwBusy(true);
            try {
              const r = await post<{ password: string }>(`/api/instances/${inst.id}/root-password`);
              onPassword(r.password);
            } catch (e) {
              toast((e as Error).message, true);
            } finally {
              setPwBusy(false);
            }
          }}>{t("New password")}</Button>
        </div>
        {!running && <div className="card-body"><p className="hint">{t("Start the container first.")}</p></div>}
      </section>

      <section className="card danger-zone">
        <div className="card-head">
          <div>
            <h2 className="h-icon"><ReinstallIcon size={18} />{t("Reinstall")}</h2>
            <p>{t("Wipe the disk and start again from a fresh system. Name, IP address, SSH port and domains are kept.")}</p>
          </div>
        </div>
        <div className="card-body">
          <div className="grid grid-2">
            <Field label={t("Operating system")} htmlFor="ri-os">
              <select id="ri-os" className="select" value={imageId} onChange={(e) => setImageId(e.target.value)}>
                {(images.data?.images || [inst.image]).map((i) => <option key={i.id} value={i.id}>{i.name} {i.version}</option>)}
              </select>
            </Field>
            <Field label={t("SSH public key (optional)")} hint={inst.hasSshKey ? t("Leave empty to keep the current key.") : undefined} htmlFor="ri-key">
              <input id="ri-key" className="input mono" placeholder="ssh-ed25519 AAAA…" value={sshKey} onChange={(e) => setSshKey(e.target.value)} spellCheck={false} />
            </Field>
          </div>
          <div style={{ marginTop: 16 }}>
            <Button variant="danger" icon={<ReinstallIcon size={16} />} disabled={!!inst.busy || inst.status === "reinstalling"} onClick={() => setConfirmReinstall(true)}>{t("Reinstall…")}</Button>
          </div>
        </div>
      </section>

      <section className="card danger-zone">
        <div className="card-head">
          <div>
            <h2 className="h-icon"><TrashIcon size={18} />{t("Delete container")}</h2>
            <p>{t("Removes the container, its snapshots and its domains. This cannot be undone.")}</p>
          </div>
          <Button variant="danger" icon={<TrashIcon size={16} />} disabled={!!inst.busy} onClick={() => setConfirmDelete(true)}>{t("Delete…")}</Button>
        </div>
      </section>

      {confirmReinstall && (
        <ConfirmModal
          title={t("Reinstall {n}?", { n: inst.name })}
          description={t("All files on the container are erased. Take a snapshot first if you may need them.")}
          word={inst.name}
          action={t("Reinstall")}
          icon={<ReinstallIcon size={16} />}
          onClose={() => setConfirmReinstall(false)}
          onConfirm={async () => {
            await post(`/api/instances/${inst.id}/reinstall`, { imageId, sshKey: sshKey.trim() || undefined, confirm: inst.name });
            setSshKey("");
            reload();
            navigate(`/c/${inst.id}`);
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title={t("Delete {n}?", { n: inst.name })}
          description={t("The container, its snapshots and its domains are removed for good.")}
          word={inst.name}
          action={t("Delete container")}
          icon={<TrashIcon size={16} />}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await del(`/api/instances/${inst.id}`, { confirm: inst.name });
            toast(t("{n} deleted", { n: inst.name }));
            navigate("/");
          }}
        />
      )}
    </div>
  );
}
