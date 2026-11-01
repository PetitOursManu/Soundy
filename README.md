# 🎧 Soundy

**Soundy** est un lecteur de musique au style **neumorphique** pour votre serveur **Emby**.
Il fonctionne dans le navigateur (application web installable / PWA) et sur **Android** (via Capacitor).

| Fonction | Détail |
|---|---|
| 🎵 Streaming Emby | Lecture à distance de toute la bibliothèque musicale Emby (qualité réglable). |
| 📥 Téléchargement | Bouton de téléchargement sur chaque album / titre. **Un titre téléchargé est toujours lu depuis l'appareil en priorité**, même connecté. Espace utilisé et suppression dans les Réglages. |
| 🎧 Bluetooth | Sortie vers casque / enceinte Bluetooth, détection de l'appareil connecté (Android), choix de la sortie (navigateur), boutons du casque/de la voiture (lecture, pause, suivant, précédent). |
| 💿 Bibliothèque | Classement **par album par défaut**, ou **titre par titre**. Tri A→Z, artiste, ajouts récents, année. |
| 🎡 Navigation en roue | Dans un album et dans la vue Titres, les morceaux défilent le long d'un arc, le titre centré est mis en avant. **PC** : molette / trackpad, flèches ↑ ↓, Page ↑/↓, Début/Fin, Entrée pour lire. **Mobile** : glisser au doigt. |
| 🔍 Recherche | Par **album** et par **titre** (filtres Tout / Albums / Titres), recherches récentes. |
| 📨 Demandes | Onglet pour demander à l'admin l'ajout d'**un album entier** ou de **plusieurs titres**. L'admin les valide / refuse avec un message. Notification Discord/Slack/Gotify possible. |
| 🌗 Thème | Clair, sombre ou automatique. |

---

## 🧱 Architecture

```
┌──────────────────────┐        ┌───────────────────────────┐
│  Soundy (web/Android)│──API──▶│  Emby (musique, pochettes)│
│  React + Vite        │        └───────────────────────────┘
│  IndexedDB (hors     │                     ▲ vérifie le jeton
│  ligne)              │──API──▶┌────────────┴──────────────┐
└──────────────────────┘        │  Serveur Soundy (Node.js) │
                                │  - API des demandes       │
                                │  - héberge l'app web      │
                                │  - proxy Emby (option)    │
                                └───────────────────────────┘
```

- **Connexion** : chaque utilisateur se connecte avec **son compte Emby**. Les administrateurs Emby sont automatiquement administrateurs dans Soundy (gestion des demandes).
- **Demandes** : stockées dans `data/requests.json` sur le serveur Soundy. Le serveur vérifie chaque requête auprès d'Emby : personne ne peut se faire passer pour un autre utilisateur.
- **Téléchargements** : stockés dans le navigateur / la WebView (IndexedDB), avec les pochettes.

```
src/
  api/emby.ts          Client de l'API Emby (connexion, albums, titres, recherche, flux audio)
  api/requests.ts      Client de l'API des demandes
  store/player.ts      Lecteur (file d'attente, aléatoire, répétition, lecture locale prioritaire, MediaSession)
  store/downloads.ts   Gestionnaire de téléchargements (file, progression, stockage)
  lib/db.ts            Stockage IndexedDB (audio, pochettes, métadonnées)
  lib/nativeBridge.ts  Liaison avec le service Android (notification, boutons Bluetooth)
  components/TrackWheel.tsx  Navigation en roue (molette, clavier, glisser)
  pages/               Bibliothèque, Album, Lecteur, Recherche, Demandes, Réglages
  styles/global.css    Design system neumorphique (thèmes clair / sombre)
server/index.js        Serveur Soundy (Express)
android/               Projet Android (Capacitor) + plugin natif SoundyAudio
```

---

## ☁️ Installation sur Coolify

1. **+ New → Resource → Private Repository (with GitHub App)** (ou *Public Repository*), choisissez le dépôt `Soundy`, branche **`main`**.
2. **Build Pack** : `Dockerfile` (le `Dockerfile` à la racine est détecté).
3. **Ports Exposes** : `8080`.
4. **Domains** : par exemple `https://soundy.mondomaine.fr` (Coolify génère le certificat HTTPS).
5. **Environment Variables** :
   - `EMBY_URL` = adresse de votre Emby, ex. `https://emby.mondomaine.fr` (ou `http://emby:8096` si Emby est sur le même réseau Docker) — **obligatoire** ;
   - facultatif : `WEBHOOK_URL`, `EMBY_PROXY=true`, `MAX_PENDING` ;
   - facultatif, en **Build Variable** : `VITE_EMBY_URL` pour pré-remplir l'adresse Emby sur l'écran de connexion.
6. **Storages** → *Add* → volume monté sur **`/data`** (conserve les demandes entre les déploiements).
7. **Health Check** (facultatif) : chemin `/api/health`, port `8080`.
8. **Deploy**, puis ouvrez le domaine et connectez-vous avec un compte Emby.

> Avec Coolify, l'application web et l'API des demandes sont sur le même domaine : rien à régler dans
> *Réglages → Serveur de demandes* côté web. Pour l'APK Android, renseignez `https://soundy.mondomaine.fr`.

## 🚀 Installation (Docker Compose)

Sur la machine qui héberge Emby (ou une autre) :

```bash
git clone https://github.com/PetitOursManu/Soundy.git
cd Soundy
```

Éditez `docker-compose.yml` (au minimum `EMBY_URL`), puis :

```bash
docker compose up -d --build
```

Soundy est alors disponible sur `http://IP_DU_SERVEUR:8080`.
Placez-le derrière votre reverse proxy HTTPS (Nginx Proxy Manager, Traefik, Caddy…), par exemple sur `https://soundy.mondomaine.fr`.

### Variables d'environnement du serveur

| Variable | Obligatoire | Description |
|---|---|---|
| `EMBY_URL` | ✅ | Adresse d'Emby **vue depuis le serveur Soundy** (ex. `http://emby:8096` ou `https://emby.mondomaine.fr`). Sert à vérifier les utilisateurs. |
| `PORT` | | Port d'écoute (défaut `8080`). |
| `DATA_DIR` | | Dossier des demandes (défaut `/data` dans Docker). |
| `CORS_ORIGINS` | | Origines autorisées (défaut `*`, nécessaire pour l'application Android). |
| `WEBHOOK_URL` | | URL appelée à chaque nouvelle demande (Discord, Slack, Mattermost, Gotify…). |
| `EMBY_PROXY` | | `true` pour exposer Emby via `https://soundy.mondomaine.fr/emby` (voir dépannage). |
| `MAX_PENDING` | | Nombre max de demandes en attente par utilisateur (défaut `20`). |

### Sans Docker

```bash
npm install
npm run build
EMBY_URL=http://localhost:8096 node server/index.js
```

---

## 📱 Application Android

### Option 1 — APK compilé automatiquement (le plus simple)

Le workflow GitHub Actions `.github/workflows/android.yml` compile l'APK à chaque push :

1. Sur GitHub, ouvrez l'onglet **Actions** → workflow **Android APK** → dernière exécution.
2. Téléchargez l'artefact **soundy-apk** (fichier zip contenant `app-debug.apk`).
3. Copiez l'APK sur le téléphone et installez-le (autorisez « sources inconnues »).

> 💡 Dans *Settings → Secrets and variables → Actions → Variables*, vous pouvez définir
> `SOUNDY_EMBY_URL` (adresse Emby pré-remplie) et `SOUNDY_REQUESTS_URL`
> (adresse du serveur Soundy, ex. `https://soundy.mondomaine.fr`) pour qu'ils soient intégrés à l'APK.

### Option 2 — Android Studio

```bash
npm install
npm run android:sync    # compile le web et le copie dans android/
npm run android:open    # ouvre le projet dans Android Studio
```

Puis *Build → Build APK(s)*.

### Particularités Android

- **Lecture en arrière-plan** : un service affiche une notification « Lecture en cours » avec les contrôles ; la musique continue écran éteint.
- **Bluetooth** : le lecteur affiche le nom de l'appareil Bluetooth connecté et un bouton ouvre directement les réglages Bluetooth d'Android. Les boutons du casque, de l'enceinte ou de la voiture pilotent Soundy.
- **Serveur de demandes** : dans l'app Android, renseignez l'adresse du serveur Soundy dans *Réglages → Serveur de demandes* (sauf si elle a été intégrée à la compilation).
- Un serveur Emby en `http://` (réseau local) est accepté.

---

## 🛠️ Développement

```bash
npm install
cp .env.example .env         # facultatif
npm run server &             # API des demandes sur :8080 (EMBY_URL à définir)
npm run dev                  # application sur http://localhost:5173 (proxy /api → :8080)
```

---

## ❓ Dépannage

**« Impossible de joindre le serveur Emby » à la connexion**
- Vérifiez l'adresse (avec `https://`). Soundy essaie automatiquement le suffixe `/emby`.
- Si Soundy est en `https://`, Emby doit aussi être en `https://` (le navigateur bloque le contenu mixte).
- Si votre Emby/reverse proxy bloque les requêtes « CORS », activez `EMBY_PROXY=true` et utilisez comme adresse de serveur dans Soundy : `https://soundy.mondomaine.fr/emby`.

**Le téléchargement échoue (erreur 403)**
Dans Emby → *Utilisateurs* → *(utilisateur)* → cochez **« Autoriser le téléchargement de médias »**.

**L'onglet Demandes affiche « Service de demandes indisponible »**
Vérifiez que le serveur Soundy tourne (`/api/health`) et, sur Android, que son adresse est renseignée dans les réglages.

**Choix de la sortie audio dans le navigateur**
Le sélecteur d'appareil (casque, enceinte Bluetooth…) est disponible sur Chrome/Edge (ordinateur) et Firefox. Sur téléphone, connectez simplement l'appareil Bluetooth au système : Soundy l'utilise automatiquement.
