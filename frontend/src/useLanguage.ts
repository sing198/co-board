import { useState, useEffect, useCallback } from "react";

export type Language = "th" | "en";

const LANG_STORAGE_KEY = "co_board_lang";
const LANG_EVENT = "co_board_lang_change";

function getInitialLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === "th" || saved === "en") return saved;
  } catch {
    // ignore storage errors
  }
  const isTestEnv =
    typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === "test";
  return isTestEnv ? "en" : "th";
}

export function useLanguage() {
  const [lang, setLangState] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    const handleLangChange = (e: Event) => {
      const custom = e as CustomEvent<Language>;
      if (custom.detail === "th" || custom.detail === "en") {
        setLangState(custom.detail);
      }
    };
    window.addEventListener(LANG_EVENT, handleLangChange);
    return () => window.removeEventListener(LANG_EVENT, handleLangChange);
  }, []);

  const setLang = useCallback((next: Language) => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
    setLangState(next);
    window.dispatchEvent(new CustomEvent<Language>(LANG_EVENT, { detail: next }));
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === "th" ? "en" : "th");
  }, [lang, setLang]);

  const t = useCallback(
    (en: string, th: string) => (lang === "th" ? th : en),
    [lang]
  );

  return { lang, setLang, toggleLang, t };
}
