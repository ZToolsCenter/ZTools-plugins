import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import type { Locale } from "../../lib/ipc/types";
import { type Parameters } from "./messages";
import { diagnostic } from "./diagnostics";

const I18nContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (source: string, parameters?: Parameters) => string;
} | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("zh-CN");
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === "en" ? "Askills · Skill Manager" : "Askills · skills 管理";
  }, [locale]);
  return (
    <I18nContext
      value={{
        locale,
        setLocale,
        t: (source, parameters) => diagnostic(source, locale, parameters),
      }}
    >
      {children}
    </I18nContext>
  );
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n requires I18nProvider");
  return value;
}
