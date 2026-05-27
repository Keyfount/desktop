import { useEffect, useRef } from "preact/hooks";
import { motion } from "framer-motion";

import { t } from "../i18n.js";
import { POP_IN, TAP_SCALE } from "../motion.js";

interface Props {
  title: string;
  body: string;
  confirmLabel?: string;
  /** Style the confirm button as danger (default true). */
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Reusable confirmation modal. Closes on Escape and on backdrop click.
 * Auto-focuses the Cancel button so a stray Return keypress doesn't
 * accidentally confirm a destructive action.
 */
export function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger = true,
  onCancel,
  onConfirm,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      class="fixed inset-0 z-[200] grid place-items-center bg-(--color-surface)/70 backdrop-blur-sm p-6"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <motion.div
        class="card !p-6 w-full max-w-md flex flex-col gap-4"
        variants={POP_IN}
        initial="initial"
        animate="animate"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <h2 class="text-lg font-medium text-(--color-ink)">{title}</h2>
        <p class="text-sm text-(--color-ink-muted) leading-relaxed">{body}</p>
        <div class="flex justify-end gap-2 pt-2">
          <motion.button
            ref={cancelRef}
            type="button"
            class="btn btn-ghost btn-sm"
            whileTap={TAP_SCALE}
            onClick={onCancel}
          >
            {t("common_cancel")}
          </motion.button>
          <motion.button
            type="button"
            class={danger ? "btn btn-danger btn-sm" : "btn btn-sm"}
            whileTap={TAP_SCALE}
            onClick={onConfirm}
          >
            {confirmLabel ?? t("common_delete")}
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
