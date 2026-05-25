/**
 * Empty titlebar laid out at the very top of the window so the user can
 * drag the window from anywhere along the top edge.
 *
 * Tauri's `data-tauri-drag-region` only fires for mousedown events that
 * actually reach the element — so the titlebar has to sit on a z-index
 * higher than every interactive component, and crucially CANNOT carry
 * `pointer-events: none`. On macOS we leave the leftmost ~80 px alone
 * so the native traffic-light buttons stay clickable.
 */
export function Titlebar() {
  const platform = navigator.userAgent.includes("Mac") ? "mac" : "other";
  return (
    <div
      class="fixed inset-x-0 top-0 z-50 select-none"
      style={{
        height: "30px",
        paddingLeft: platform === "mac" ? "80px" : "0",
      }}
      data-tauri-drag-region
    />
  );
}
