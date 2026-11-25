import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ProfileProvider } from "./state";
import { App } from "./App";
import "./styles.css";

try {
  const theme = localStorage.getItem("ddia-theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch { /* storage unavailable */ }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ProfileProvider>
        <App />
      </ProfileProvider>
    </BrowserRouter>
  </StrictMode>,
);

// Installable PWA: register the service worker in production builds only.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* offline support is best-effort */ });
  });
}
