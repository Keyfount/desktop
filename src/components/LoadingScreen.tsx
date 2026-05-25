import { motion } from "framer-motion";
import { Logo } from "../Logo.js";

export function LoadingScreen() {
  return (
    <motion.div
      class="flex flex-col items-center justify-center min-h-screen gap-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        animate={{ opacity: [1, 0.4, 1] }}
        transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
      >
        <Logo class="w-9 h-9" />
      </motion.div>
      <span class="mono-tag">Loading…</span>
    </motion.div>
  );
}
