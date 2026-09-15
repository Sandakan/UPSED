import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { enUS, fr } from 'date-fns/locale';

import enCommon from '../locales/en/common.json';
import enNav from '../locales/en/nav.json';
import enDashboard from '../locales/en/dashboard.json';
import enControl from '../locales/en/control.json';
import enConfig from '../locales/en/config.json';
import enHistory from '../locales/en/history.json';
import enEvents from '../locales/en/events.json';
import enSettings from '../locales/en/settings.json';
import enModals from '../locales/en/modals.json';
import enNotifications from '../locales/en/notifications.json';

import frCommon from '../locales/fr/common.json';
import frNav from '../locales/fr/nav.json';
import frDashboard from '../locales/fr/dashboard.json';
import frControl from '../locales/fr/control.json';
import frConfig from '../locales/fr/config.json';
import frHistory from '../locales/fr/history.json';
import frEvents from '../locales/fr/events.json';
import frSettings from '../locales/fr/settings.json';
import frModals from '../locales/fr/modals.json';
import frNotifications from '../locales/fr/notifications.json';

export const LOCALE_STORAGE_KEY = 'voltwatch-locale';
export const SYSTEM_DETECTED_LANG_KEY = 'voltwatch-use-system-lang';

export const resources = {
  en: {
    common: enCommon,
    nav: enNav,
    dashboard: enDashboard,
    control: enControl,
    config: enConfig,
    history: enHistory,
    events: enEvents,
    settings: enSettings,
    modals: enModals,
    notifications: enNotifications,
  },
  fr: {
    common: frCommon,
    nav: frNav,
    dashboard: frDashboard,
    control: frControl,
    config: frConfig,
    history: frHistory,
    events: frEvents,
    settings: frSettings,
    modals: frModals,
    notifications: frNotifications,
  },
} as const;

export function getSystemLanguage(): 'en' | 'fr' {
  if (typeof navigator !== 'undefined' && navigator.language) {
    const code = navigator.language.toLowerCase();
    if (code.startsWith('fr')) return 'fr';
  }
  return 'en';
}

// Check initial stored setting
const storedPref = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCALE_STORAGE_KEY) : null;
const useSystem = typeof localStorage !== 'undefined' ? localStorage.getItem(SYSTEM_DETECTED_LANG_KEY) === 'true' : false;

let initialLng = 'en';
if (useSystem || !storedPref) {
  initialLng = getSystemLanguage();
} else if (storedPref === 'fr' || storedPref === 'en') {
  initialLng = storedPref;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLng,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: [
      'common',
      'nav',
      'dashboard',
      'control',
      'config',
      'history',
      'events',
      'settings',
      'modals',
      'notifications',
    ],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LOCALE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    react: {
      useSuspense: false,
    },
  });

/**
 * Returns the active date-fns locale based on i18n's current language
 */
export function getDateFnsLocale(lang?: string) {
  const active = lang || i18n.language || 'en';
  return active.startsWith('fr') ? fr : enUS;
}

export type AppLanguageMode = 'system' | 'en' | 'fr';

/**
 * Changes language to 'system', 'en', or 'fr'.
 */
export async function setAppLanguage(preference: AppLanguageMode) {
  if (preference === 'system') {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SYSTEM_DETECTED_LANG_KEY, 'true');
    }
    const sysLang = getSystemLanguage();
    await i18n.changeLanguage(sysLang);
  } else {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SYSTEM_DETECTED_LANG_KEY, 'false');
      localStorage.setItem(LOCALE_STORAGE_KEY, preference);
    }
    await i18n.changeLanguage(preference);
  }
}

/**
 * Returns whether user configured system default or explicit en / fr
 */
export function getAppLanguageMode(): AppLanguageMode {
  if (typeof localStorage !== 'undefined') {
    const isSystem = localStorage.getItem(SYSTEM_DETECTED_LANG_KEY) === 'true';
    if (isSystem) return 'system';
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'en' || saved === 'fr') return saved;
  }
  return 'system';
}

export default i18n;
