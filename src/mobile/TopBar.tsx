import { t } from "../i18n.js";
import { Logo } from "../Logo.js";
import { VaultAvatar } from "./VaultAvatar.js";

interface Props {
  fingerprint: string | null;
}

export function TopBar({ fingerprint }: Props) {
  return (
    <header class="safe-top px-4 pb-3 flex items-center gap-3">
      <Logo class="w-7 h-7 shrink-0" />
      <span class="font-medium tracking-[-0.01em] text-[15px] text-(--color-ink)">
        Keyfount
      </span>
      {fingerprint ? (
        <span class="fingerprint-sm shrink-0" title={t("setup_fingerprint_hint")}>
          {fingerprint.split(/\s+/u)[0] ?? ""}
        </span>
      ) : null}
      <span class="flex-1" />
      {fingerprint ? <VaultAvatar fingerprint={fingerprint} /> : null}
    </header>
  );
}
