import { Component, ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Filet de sécurité : si une page plante, on affiche un message et un bouton
 * « Recharger » au lieu d'un écran vide.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Soundy :', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    // Nouvelle version déployée pendant l'utilisation (fichier introuvable)
    const outdated = /dynamically imported module|Loading chunk|Importing a module script failed/i.test(this.state.error.message);
    return (
      <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '80dvh', textAlign: 'center' }}>
        <div className="card" style={{ maxWidth: 380 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
            {outdated ? 'Nouvelle version disponible' : 'Oups, un problème est survenu'}
          </h2>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
            {outdated ? 'Soundy a été mis à jour. Rechargez pour utiliser la dernière version.' : this.state.error.message}
          </p>
          <div className="row" style={{ gap: 12, justifyContent: 'center' }}>
            <button className="btn" onClick={() => (window.location.hash = '#/') && this.setState({ error: null })}>
              Accueil
            </button>
            <button className="btn accent" onClick={() => window.location.reload()}>
              Recharger
            </button>
          </div>
        </div>
      </div>
    );
  }
}
