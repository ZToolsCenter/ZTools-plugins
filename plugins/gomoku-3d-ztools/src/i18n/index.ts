import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { readPersistent } from "@/lib/pluginHost";
import { zh } from "./locales/zh";
import { en } from "./locales/en";

export const resources = {
  zh: { translation: zh },
  en: { translation: en },
} as const;

export const SUPPORTED_LANGS = ["zh", "en"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

const savedLanguage = readPersistent<unknown>("language", "zh");
const initialLanguage: Lang = savedLanguage === "en" ? "en" : "zh";

i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: "zh",
  supportedLngs: SUPPORTED_LANGS as unknown as string[],
  load: "languageOnly",
  nonExplicitSupportedLngs: true,
  interpolation: { escapeValue: false },
});

export default i18n;
