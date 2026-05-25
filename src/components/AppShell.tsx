import type { ComponentChildren } from "preact";
import { motion } from "framer-motion";

import { SOFT_SPRING } from "../motion.js";
import { Sidebar } from "./Sidebar.js";

interface AppShellProps {
  children: ComponentChildren;
}

/**
 * App shell — the resizable desktop layout with a sidebar on the left
 * and a content area on the right. The macOS drag region sits in the
 * very top of the sidebar so the user can still move the window even
 * with the overlay title bar.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <motion.div
      class="grid h-screen w-screen"
      style={{ gridTemplateColumns: "232px 1fr" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={SOFT_SPRING}
    >
      <Sidebar />
      <section class="relative flex flex-col h-full min-h-0 overflow-hidden">
        <div class="absolute inset-x-0 top-0 h-10 pointer-events-none" data-tauri-drag-region />
        <div class="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </section>
    </motion.div>
  );
}
