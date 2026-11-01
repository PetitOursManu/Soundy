// Bouton « retour » d'Android (appli Capacitor).
// Ordre : 1) fermer une fenêtre ouverte (menu, file d'attente, sélection…)
//         2) revenir à l'écran précédent de l'application
//         3) sur l'écran principal : mettre l'appli en arrière-plan
//            (la musique continue, contrairement à une fermeture)
import { App as CapApp } from '@capacitor/app';
import { isNative } from './native';

type Handler = () => boolean; // true = l'appui a été traité

const handlers: Handler[] = [];
let installed = false;

/** Ferme une feuille / un mode ouvert en simulant la touche Échap. */
function closeOverlay(): boolean {
  if (!document.querySelector('.backdrop, .select-bar')) return false;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
}

function install() {
  if (installed || !isNative()) return;
  installed = true;
  void CapApp.addListener('backButton', () => {
    if (closeOverlay()) return;
    // Le gestionnaire enregistré en dernier (écran actuel) est prioritaire
    for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]()) return;
    void CapApp.minimizeApp();
  });
}

/** Enregistre un gestionnaire ; renvoie la fonction de désinscription. */
export function onBackButton(handler: Handler): () => void {
  install();
  handlers.push(handler);
  return () => {
    const i = handlers.indexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}
