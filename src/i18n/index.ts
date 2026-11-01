// Traductions de Soundy (français / anglais), sans dépendance.
//  - t('cle', { var })        : texte traduit, avec variables {var}
//  - tn('cle', n, { var })    : pluriel (clés « cle_one » / « cle_other »)
//  - useT()                   : version React (se met à jour au changement de langue)
// Le dictionnaire anglais doit contenir TOUTES les clés du français :
// sinon la compilation échoue (aucun texte ne peut être oublié).
import { useCallback } from 'react';
import { useSettings } from '../store/settings';
import en from './en';
import fr from './fr';

export type Lang = 'fr' | 'en';
export type Key = keyof typeof fr;
type Vars = Record<string, string | number>;

const dicts: Record<Lang, Record<Key, string>> = { fr, en };

/** Langue suggérée d'après l'appareil (avant tout choix). */
export function detectLang(): Lang {
  return /^fr/i.test(navigator.language || '') ? 'fr' : 'en';
}

export const currentLang = (): Lang => useSettings.getState().language ?? detectLang();
export const localeOf = (lang: Lang) => (lang === 'en' ? 'en-US' : 'fr-FR');
export const currentLocale = () => localeOf(currentLang());

function format(s: string, vars?: Vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  return format(dicts[lang][key] ?? dicts.fr[key] ?? key, vars);
}

/** Pluriel : français → 0 et 1 au singulier ; anglais → 1 au singulier. */
export function translatePlural(lang: Lang, base: string, n: number, vars?: Vars): string {
  const one = lang === 'fr' ? n <= 1 : n === 1;
  return translate(lang, `${base}_${one ? 'one' : 'other'}` as Key, { n, ...vars });
}

export const t = (key: Key, vars?: Vars) => translate(currentLang(), key, vars);
export const tn = (base: string, n: number, vars?: Vars) => translatePlural(currentLang(), base, n, vars);

export function useT() {
  const lang = useSettings((s) => s.language) ?? detectLang();
  const tt = useCallback((key: Key, vars?: Vars) => translate(lang, key, vars), [lang]);
  const ttn = useCallback((base: string, n: number, vars?: Vars) => translatePlural(lang, base, n, vars), [lang]);
  return { t: tt, tn: ttn, lang, locale: localeOf(lang) };
}
