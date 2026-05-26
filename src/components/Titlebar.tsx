/**
 * Empty drag bar at the very top of the window.
 *
 * Tauri's `data-tauri-drag-region` only fires when the mousedown lands on
 * the element itself — so this element MUST sit above every interactive
 * component and CANNOT carry `pointer-events: none`. On macOS the traffic
 * lights live in the leftmost ~80 px, so we offset the drag region with
 * `left` (not padding) so clicks in that strip fall through to the native
 * buttons.
 *
 * The element is rendered at the App root rather than inside `AppShell`
 * so it always escapes `framer-motion` transforms — a parent with any
 * `transform` becomes the containing block for `position: fixed`
 * children, which broke the drag region inside the animated shell.
 */
export function Titlebar() {
  const platform =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac") ? "mac" : "other";
  return (
    <div
      class="fixed top-0 right-0 z-[100] select-none"
      style={{
        height: "30px",
        left: platform === "mac" ? "80px" : "0",
      }}
      data-tauri-drag-region
    />
  );
}
