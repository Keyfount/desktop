/**
 * Inline profile editor — random or memorable, length / classes /
 * counter. Same shape as the extension's `ProfileEditor` so the UX is
 * familiar; adapted for the wider desktop layout.
 */
import { t } from "../i18n.js";
import type { MemorableProfile, Profile, RandomProfile } from "../types.js";
import { DEFAULT_MEMORABLE_PROFILE, DEFAULT_RANDOM_PROFILE } from "../types.js";

interface Props {
  profile: Profile;
  onChange: (next: Profile) => void;
  compact?: boolean | undefined;
}

export function ProfileEditor({ profile, onChange, compact }: Props) {
  return (
    <div class="flex flex-col gap-3">
      <div class="segmented grid-cols-2">
        <button
          type="button"
          aria-pressed={profile.mode === "random"}
          onClick={() =>
            onChange(
              profile.mode === "random"
                ? profile
                : { ...DEFAULT_RANDOM_PROFILE, counter: profile.counter },
            )
          }
        >
          {t("profile_random")}
        </button>
        <button
          type="button"
          aria-pressed={profile.mode === "memorable"}
          onClick={() =>
            onChange(
              profile.mode === "memorable"
                ? profile
                : { ...DEFAULT_MEMORABLE_PROFILE, counter: profile.counter },
            )
          }
        >
          {t("profile_memorable")}
        </button>
      </div>

      {profile.mode === "random" ? (
        <RandomEditor profile={profile} onChange={onChange} compact={compact} />
      ) : (
        <MemorableEditor profile={profile} onChange={onChange} compact={compact} />
      )}

      <label class={`flex items-center gap-3 ${compact ? "text-xs" : "text-sm"}`}>
        <span class="field-label">{t("profile_counter")}</span>
        <input
          type="number"
          min={1}
          class="input w-24 text-center"
          value={profile.counter}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            const counter = Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
            onChange({ ...profile, counter });
          }}
        />
      </label>
    </div>
  );
}

function RandomEditor({
  profile,
  onChange,
}: {
  profile: RandomProfile;
  onChange: (next: Profile) => void;
  compact?: boolean | undefined;
}) {
  return (
    <div class="flex flex-col gap-3">
      <label class="flex items-center gap-3 text-sm">
        <span class="field-label">{t("profile_length")}</span>
        <input
          type="range"
          min={5}
          max={35}
          value={profile.length}
          onInput={(e) =>
            onChange({ ...profile, length: Number((e.target as HTMLInputElement).value) })
          }
        />
        <span class="text-xs text-(--color-ink-muted) w-8 text-right">{profile.length}</span>
      </label>
      <div class="flex flex-wrap gap-2">
        <ChipToggle
          label="aa"
          pressed={profile.lower}
          onClick={() => onChange({ ...profile, lower: !profile.lower })}
        />
        <ChipToggle
          label="AA"
          pressed={profile.upper}
          onClick={() => onChange({ ...profile, upper: !profile.upper })}
        />
        <ChipToggle
          label="00"
          pressed={profile.digits}
          onClick={() => onChange({ ...profile, digits: !profile.digits })}
        />
        <ChipToggle
          label="@#"
          pressed={profile.symbols}
          onClick={() => onChange({ ...profile, symbols: !profile.symbols })}
        />
      </div>
    </div>
  );
}

function MemorableEditor({
  profile,
  onChange,
}: {
  profile: MemorableProfile;
  onChange: (next: Profile) => void;
  compact?: boolean | undefined;
}) {
  return (
    <div class="flex flex-col gap-3">
      <label class="flex items-center gap-3 text-sm">
        <span class="field-label">{t("profile_words")}</span>
        <input
          type="range"
          min={5}
          max={8}
          value={profile.wordCount}
          onInput={(e) =>
            onChange({ ...profile, wordCount: Number((e.target as HTMLInputElement).value) })
          }
        />
        <span class="text-xs text-(--color-ink-muted) w-6 text-right">{profile.wordCount}</span>
      </label>
      <div class="segmented grid-cols-3">
        {(["-", ".", "_"] as const).map((sep) => (
          <button
            type="button"
            key={sep}
            aria-pressed={profile.separator === sep}
            onClick={() => onChange({ ...profile, separator: sep })}
          >
            {sep}
          </button>
        ))}
      </div>
      <div class="flex flex-wrap gap-2">
        <ChipToggle
          label="Aa"
          pressed={profile.capitalise}
          onClick={() => onChange({ ...profile, capitalise: !profile.capitalise })}
        />
        <ChipToggle
          label="0@"
          pressed={profile.suffix}
          onClick={() => onChange({ ...profile, suffix: !profile.suffix })}
        />
      </div>
    </div>
  );
}

function ChipToggle({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" class="chip" aria-pressed={pressed} onClick={onClick}>
      {label}
    </button>
  );
}
