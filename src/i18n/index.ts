import { useSyncExternalStore } from 'react';
import { ru, type TKey } from './ru';
import { en } from './en';
import { uz } from './uz';
import { es } from './es';

export type Lang = 'ru' | 'en' | 'uz' | 'es';
export type { TKey };

const DICTS: Record<Lang, Record<TKey, string>> = { ru, en, uz, es };

export const LANGS: { id: Lang; flag: string; name: string }[] = [
  { id: 'ru', flag: '🇷🇺', name: ru['lang.name'] },
  { id: 'en', flag: '🇬🇧', name: en['lang.name'] },
  { id: 'uz', flag: '🇺🇿', name: uz['lang.name'] },
  { id: 'es', flag: '🇪🇸', name: es['lang.name'] },
];

const LOCALES: Record<Lang, string> = { ru: 'ru-RU', en: 'en-US', uz: 'uz-UZ', es: 'es-ES' };

export function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'ru';
  const l = (navigator.language || 'ru').slice(0, 2).toLowerCase();
  if (l in DICTS) return l as Lang;
  return l === 'kk' || l === 'uk' || l === 'be' || l === 'ky' || l === 'tg' ? 'ru' : 'en';
}

let current: Lang = detectLang();
const listeners = new Set<() => void>();

export const getLang = () => current;

export function setLang(l: Lang) {
  if (l === current || !(l in DICTS)) return;
  current = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

/** Translate a key; `{name}` placeholders are filled from params */
export function t(key: TKey, params?: Record<string, string | number>): string {
  let s = DICTS[current][key] ?? ru[key] ?? key;
  if (params) for (const k in params) s = s.split(`{${k}}`).join(String(params[k]));
  return s;
}

export const fmtNum = (n: number) => n.toLocaleString(LOCALES[current]);

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

/** Re-renders the component when the language changes */
export const useLang = (): Lang => useSyncExternalStore(subscribe, getLang, getLang);
