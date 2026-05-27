import { useEffect, useState } from "preact/hooks";

import { api } from "../api.js";
import { t } from "../i18n.js";
import type { AccountSyncStamp } from "../types.js";

interface Props {
  domain: string;
  username: string;
  /** Tightens the look on narrow mobile sheets. */
  compact?: boolean;
}

/**
 * Tiny footnote that tells the user when sync last touched this
 * account and in which direction. Reads `get_account_sync_info` on
 * mount + whenever (domain, username) changes; surfaces "Never
 * synced…" when the row hasn't been observed by the sync pipeline.
 */
export function LastSyncedLine({ domain, username, compact }: Props) {
  const [stamp, setStamp] = useState<AccountSyncStamp | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setStamp(null);
    void api
      .getAccountSyncInfo(domain, username)
      .then((r) => {
        if (cancelled) return;
        setStamp(r.lastSyncedAt);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [domain, username]);

  if (!loaded) return null;

  const sizeClass = compact ? "text-[11px]" : "text-xs";
  const labelClass = `${sizeClass} text-(--color-ink-subtle) leading-snug`;

  if (stamp === null) {
    return <span class={labelClass}>{t("detail_last_synced_never")}</span>;
  }

  const age = formatRelativeAge(stamp.ts);
  const line =
    stamp.dir === "push" ? t("detail_last_synced_push", age) : t("detail_last_synced_pull", age);
  return <span class={labelClass}>{line}</span>;
}

/** Returns "just now" / "12 min ago" / "3 hours ago" / "2 days ago". */
export function formatRelativeAge(ts: number): string {
  const diffMs = Date.now() - ts;
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 45) return t("relative_just_now");
  const min = Math.round(sec / 60);
  if (min < 60) return t("relative_minutes_ago", String(min));
  const hr = Math.round(min / 60);
  if (hr < 24) return t("relative_hours_ago", String(hr));
  const day = Math.round(hr / 24);
  return t("relative_days_ago", String(day));
}
