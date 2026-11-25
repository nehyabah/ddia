// Theme preference: "system" follows the OS; "light"/"dark" are explicit and remembered on this device.
export type ThemePref = "system" | "light" | "dark";

const KEY = "ddia-theme";
const BG = { light: "#F6F5F3", dark: "#131312" };

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function effectiveTheme(pref = getThemePref()): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* storage unavailable */ }
  // Keep the phone's status bar / browser chrome in step with the chosen theme.
  const color = BG[effectiveTheme(pref)];
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", pref === "system" ? (m.getAttribute("media")?.includes("dark") ? BG.dark : BG.light) : color);
  });
  window.dispatchEvent(new CustomEvent("ddia:theme", { detail: pref }));
}
