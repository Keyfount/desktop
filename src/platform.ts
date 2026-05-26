/**
 * Lightweight host-platform detection for UI labels (Touch ID vs.
 * Windows Hello, "Mac" vs. "Desktop" device-label default, etc.) and
 * for the mobile/desktop shell switch in `main.tsx`.
 *
 * `navigator.userAgent` is good enough for the UI — we don't need
 * the precision of `@tauri-apps/plugin-os` here. Tauri's webview UA
 * always carries the host platform string ("Macintosh", "Windows
 * NT", "Linux") so this is reliable across both the bundled app and
 * `tauri dev`.
 */

export type Platform = "macos" | "windows" | "linux" | "android" | "ios" | "other";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return "android";
  // iPadOS 13+ Safari pretends to be Macintosh; touch support is the giveaway.
  if (/iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof document !== "undefined" && "ontouchend" in document)) {
    return "ios";
  }
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  if (/Linux/.test(ua)) return "linux";
  return "other";
}

export function isMobile(): boolean {
  const p = detectPlatform();
  return p === "android" || p === "ios";
}
