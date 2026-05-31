import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n"; // Initialize i18next before rendering
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Fade out startup placeholder after React hydrates (Req 19.3)
const placeholder = document.getElementById("startup-placeholder");
if (placeholder) {
  placeholder.classList.add("fade-out");
  placeholder.addEventListener("transitionend", () => placeholder.remove());
}
