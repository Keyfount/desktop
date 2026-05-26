import { describe, expect, it } from "vitest";
import { render } from "preact";
import { BottomNav } from "./BottomNav.js";

describe("<BottomNav />", () => {
  it("renders three tabs labelled Accounts / Generator / Settings", () => {
    const root = document.createElement("div");
    render(<BottomNav active="generator" platform="ios" onChange={() => {}} />, root);
    // Match either FR or EN — depends on the runtime locale.
    expect(root.textContent).toMatch(/Comptes|Accounts/);
    expect(root.textContent).toMatch(/Générateur|Generator/);
    expect(root.textContent).toMatch(/Réglages|Settings/);
  });

  it("uses the iOS glass class on iOS", () => {
    const root = document.createElement("div");
    render(<BottomNav active="generator" platform="ios" onChange={() => {}} />, root);
    expect(root.querySelector(".glass-ios")).not.toBeNull();
    expect(root.querySelector(".surface-android")).toBeNull();
  });

  it("uses the Android surface class on Android", () => {
    const root = document.createElement("div");
    render(<BottomNav active="generator" platform="android" onChange={() => {}} />, root);
    expect(root.querySelector(".surface-android")).not.toBeNull();
    expect(root.querySelector(".glass-ios")).toBeNull();
  });

  it("calls onChange with the tapped tab id", () => {
    const root = document.createElement("div");
    let last: string | null = null;
    render(<BottomNav active="generator" platform="ios" onChange={(id) => (last = id)} />, root);
    const buttons = root.querySelectorAll("button");
    // Order: 0=accounts, 1=generator, 2=settings
    (buttons[2] as HTMLButtonElement).click();
    expect(last).toBe("settings");
  });
});
