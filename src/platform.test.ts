import { describe, expect, it, afterEach } from "vitest";
import { detectPlatform, isMobile } from "./platform.js";

const ORIGINAL_UA = Object.getOwnPropertyDescriptor(navigator, "userAgent");

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

describe("detectPlatform", () => {
  afterEach(() => {
    if (ORIGINAL_UA) Object.defineProperty(navigator, "userAgent", ORIGINAL_UA);
  });

  it("detects Android from the UA", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro) AppleWebKit/537.36");
    expect(detectPlatform()).toBe("android");
  });

  it("detects iOS iPhone from the UA", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15");
    expect(detectPlatform()).toBe("ios");
  });

  it("detects iPadOS 13+ Safari (UA pretends to be Macintosh, has touch)", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15");
    try {
      Object.defineProperty(document, "ontouchend", { value: () => {}, configurable: true });
      expect(detectPlatform()).toBe("ios");
    } finally {
      Reflect.deleteProperty(document, "ontouchend");
    }
  });

  it("returns macos for desktop Safari", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15");
    expect(detectPlatform()).toBe("macos");
  });
});

describe("isMobile", () => {
  afterEach(() => {
    if (ORIGINAL_UA) Object.defineProperty(navigator, "userAgent", ORIGINAL_UA);
  });

  it("is true on Android", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14)");
    expect(isMobile()).toBe(true);
  });

  it("is true on iOS", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15");
    expect(isMobile()).toBe(true);
  });

  it("is false on Linux desktop", () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    expect(isMobile()).toBe(false);
  });
});
