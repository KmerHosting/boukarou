import { t } from "../lib/i18n";
import { shortDate } from "../lib/format";
import type { EventItem } from "../lib/types";

const LABELS: Record<string, string> = {
  "instance.create": "Container requested",
  "instance.ready": "Container ready",
  "instance.failed": "Operation failed",
  "instance.start": "Started",
  "instance.stop": "Stopped",
  "instance.restart": "Restarted",
  "instance.freeze": "Frozen",
  "instance.unfreeze": "Unfrozen",
  "instance.reinstall": "Reinstall started",
  "instance.resize": "Resized",
  "instance.root_password": "Root password changed",
  "instance.delete": "Container deleted",
  "snapshot.create": "Snapshot taken",
  "snapshot.restore": "Snapshot restored",
  "snapshot.delete": "Snapshot deleted",
  "domain.add": "Domain added",
  "domain.active": "Domain active",
  "domain.failed": "Domain failed",
  "domain.remove": "Domain removed",
  "traffic.blocked": "Traffic quota reached",
  "traffic.restored": "Traffic restored",
  "terminal.open": "Console opened",
  "auth.login": "Signed in",
  "account.password": "Password changed",
  "account.2fa_on": "Two-factor sign-in on",
  "account.2fa_off": "Two-factor sign-in off",
  "user.create": "User created",
  "user.update": "User updated",
  "user.reset_password": "User password reset",
  "user.reset_2fa": "User two-factor reset",
  "user.delete": "User deleted",
  "settings.update": "Settings changed",
  "admin.created": "Administrator created",
  "admin.password_reset": "Administrator password reset",
};

export function EventRow({ e, showUser }: { e: EventItem; showUser?: boolean }) {
  return (
    <div className={`event ${e.level}`}>
      <time>{shortDate(e.at)}</time>
      <div>
        <div>
          {t(LABELS[e.action] || e.action)}
          {e.message && <span className="muted"> | {e.message}</span>}
        </div>
        <div className="a">
          {e.actor ? t("by {u}", { u: e.actor }) : t("system")}
          {showUser && e.user && e.user !== e.actor ? ` | ${t("account {u}", { u: e.user })}` : ""}
        </div>
      </div>
    </div>
  );
}
