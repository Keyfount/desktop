import { render } from "preact";
import { App } from "./App.js";
import "./theme.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element");
}
render(<App />, root);
