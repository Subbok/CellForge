import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import pl from '../locales/pl.json';

const LS_KEY = 'cellforge.language';

function savedLanguage(): string {
  if (typeof localStorage === 'undefined') return 'en';
  return localStorage.getItem(LS_KEY) ?? 'en';
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, pl: { translation: pl } },
  lng: savedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(lng: string) {
  i18n.changeLanguage(lng);
  try { localStorage.setItem(LS_KEY, lng); } catch { /* ignored */ }
}

export default i18n;
