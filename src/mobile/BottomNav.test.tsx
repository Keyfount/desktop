import { describe, expect, it } from "vitest";
import { render } from "preact";
import { BottomNav } from "./BottomNav.js";
import { historyEnabled } from "../state.js";

describe("<BottomNav />", () => {
  it("renders three tabs labelled Accounts / Generator / Settings", () => {
    historyEnabled.value = true;
    const root = document.createElement("div");
    render(<BottomNav active="generator" platform="ios" onChange={() => {}} />, root);
    // Match either FR or EN — depends on the runtime locale.
    expect(root.textContent).toMatch(/Comptes|Accounts/);
    expect(root.textContent).toMatch(/Générateur|Generator/);
    expect(root.textContent).toMatch(/Réglages|Settings/);
    historyEnabled.value = false;
  });

  it("uses the iOS glass class on iOS", () => {
    historyEnabled.value = true;
    const root = document.createElement("div");
    render(<BottomNav active="generator" platform="ios" onChange={() => {}} />, root);
    expect(root.querySelector(".glass-ios-bottom")).not.toBeNull();
    expect(root.querySelector(".surface-android")).toBeNull();
    historyEnabled.value = false;
  });

  it("uses the Android surface class on Android", () => {
    historyEnabled.value = true;
    const root = document.createElement("div");
    render(<BottomNav active="generator" platform="android" onChange={() => {}} />, root);
    expect(root.querySelector(".surface-android")).not.toBeNull();
    expect(root.querySelector(".glass-ios-bottom")).toBeNull();
    historyEnabled.value = false;
  });

  it("calls onChange with the tapped tab id", () => {
    historyEnabled.value = true;
    const root = document.createElement("div");
    let last: string | null = null;
    render(<BottomNav active="generator" platform="ios" onChange={(id) => (last = id)} />, root);
    const buttons = root.querySelectorAll("button");
    // Order: 0=accounts, 1=generator, 2=settings
    (buttons[2] as HTMLButtonElement).click();
    expect(last).toBe("settings");
    historyEnabled.value = false;
  });
});
