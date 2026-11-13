import { useSyncExternalStore } from "react";
import { fr } from "./fr";

export type Lang = "en" | "fr";
const KEY = "boukarou-lang";
const listeners = new Set<() => void>();

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "fr") return saved;
  } catch {}
  return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let lang: Lang = initial();
document.documentElement.lang = lang;

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {}
  listeners.forEach((fn) => fn());
}

/** t("English text", { n: 2 }) — English is the key, French comes from fr.ts. */
export function t(text: string, vars?: Record<string, string | number>) {
  let out = lang === "fr" ? fr[text] ?? text : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

export function useLang() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lang,
  );
}
