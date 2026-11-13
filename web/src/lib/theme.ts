import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "boukarou-theme";
const listeners = new Set<() => void>();
const media = window.matchMedia("(prefers-color-scheme: dark)");

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "system";
}
let theme: Theme = read();

function apply() {
  const dark = theme === "dark" || (theme === "system" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
apply();
media.addEventListener("change", () => {
  apply();
  listeners.forEach((fn) => fn());
});

export function setTheme(v: Theme) {
  theme = v;
  try {
    if (v === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch {}
  apply();
  listeners.forEach((fn) => fn());
}
export const useTheme = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => theme,
  );
export const isDark = () => document.documentElement.dataset.theme === "dark";
