import { render } from "preact";
import { App } from "./App.js";
import { isMobile } from "./platform.js";
import "./theme.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element");
}

if (isMobile()) {
  void (async () => {
    const { MobileApp } = await import("./mobile/MobileApp.js");
    render(<MobileApp />, root);
  })();
} else {
  render(<App />, root);
}
