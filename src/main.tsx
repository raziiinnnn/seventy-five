import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Dexie opens lazily on first query — no explicit open() needed.

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found.");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

