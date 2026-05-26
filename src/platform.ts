/**
 * Lightweight host-platform detection for UI labels (Touch ID vs.
 * Windows Hello, "Mac" vs. "Desktop" device-label default, etc.).
 *
 * `navigator.userAgent` is good enough for the UI — we don't need
 * the precision of `@tauri-apps/plugin-os` here. Tauri's webview UA
 * always carries the host platform string ("Macintosh", "Windows
 * NT", "Linux") so this is reliable across both the bundled app and
 * `tauri dev`.
 */

export type Platform = "macos" | "windows" | "linux" | "other";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  if (/Linux/.test(ua)) return "linux";
  return "other";
}
