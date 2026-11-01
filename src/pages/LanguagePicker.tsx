import { useState } from 'react';
import { Brand } from '../components/Brand';
import { detectLang, Lang, translate } from '../i18n';
import { hapticClick } from '../lib/haptics';
import { useSettings } from '../store/settings';

const LANGS: { value: Lang; flag: string; name: string; hint: string }[] = [
  { value: 'fr', flag: '🇫🇷', name: 'Français', hint: 'French' },
  { value: 'en', flag: '🇬🇧', name: 'English', hint: 'Anglais' },
];

/** Premier lancement : choix de la langue (avant l'écran d'accueil). */
export default function LanguagePicker() {
  const update = useSettings((s) => s.update);
  const [choice, setChoice] = useState<Lang>(detectLang());

  return (
    <div className="welcome lang-picker">
      <div className="welcome-top">
        <Brand size={44} />
      </div>

      <div className="lang-body">
        <h1 className="lang-title">
          <span>{translate(choice, 'lang.title')}</span>
          <small>{translate(choice === 'fr' ? 'en' : 'fr', 'lang.title')}</small>
        </h1>

        <div className="lang-options" role="radiogroup" aria-label="Langue / Language">
          {LANGS.map((l) => (
            <button
              key={l.value}
              role="radio"
              aria-checked={choice === l.value}
              className={`lang-option ${choice === l.value ? 'on' : ''}`}
              onClick={() => {
                hapticClick();
                setChoice(l.value);
              }}
            >
              <span className="flag" aria-hidden>
                {l.flag}
              </span>
              <span className="name">
                {l.name}
                <small>{l.hint}</small>
              </span>
              <span className="radio" aria-hidden />
            </button>
          ))}
        </div>
        <p className="tagline" style={{ textAlign: 'center' }}>
          {translate(choice, 'lang.subtitle')}
        </p>
      </div>

      <button className="btn accent block" style={{ height: 58, fontSize: 16 }} onClick={() => update({ language: choice })}>
        {translate(choice, 'lang.continue')}
      </button>
    </div>
  );
}
