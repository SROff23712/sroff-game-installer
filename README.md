# Sroff Game Installer
Application Electron pour télécharger et installer automatiquement les jeux depuis votre site sroff-crack.

## Fonctionnalités

- 📥 Téléchargement automatique des jeux ( ZIP et Torrent )
- 📦 Extraction automatique des fichiers ZIP
- 🎮 Installation dans `C:\sroff-game\nomdujeux`
- 🔗 Création automatique de raccourcis sur le bureau 
- 🔍 Recherche de jeux 
- ✅ Indication des jeux déjà installés
- 📊 Suivi de progression en temps  réel

## Prérequis

- Node.js (version  16 ou supérieure)
- npm ou yarn
- Windows 10/11

## Installation rapide (Windows)

1. Double-cliquez sur `install.bat`  pour installer automatiquement les dépendances

OU

1. Ouvrez un terminal dans le dossier `installer-app`
2. Installez les dépendances :
```bash
npm install
```

## Configuration Firebase

### Étape 1 : Variables d'environnement

1. Copiez `env.example.txt` vers `.env` :
```bash
copy env.example.txt .env
```

2. Ouvrez le fichier `.env` et remplissez avec vos identifiants Firebase :
   - Allez sur [Firebase Console](https://console.firebase.google.com/)
   - Sélectionnez votre projet
   - Allez dans Paramètres du projet > Vos applications
   - Copiez les valeurs de configuration

### Étape 2 : Règles Firestore

**⚠️ IMPORTANT** : L'application nécessite l'authentification pour lire les données Firestore.

Vous avez deux options :

#### Option A : Authentification (Recommandé)
L'application affichera un écran de connexion. Les utilisateurs devront se connecter avec Google ou GitHub.

1. Activez les providers dans Firebase Console :
   - Authentication > Sign-in method
   - Activez "Google" et/ou "GitHub"

#### Option B : Lecture publique (Développement uniquement)
Pour permettre la lecture sans authentification, modifiez vos règles Firestore :

1. Utilisez le fichier `firestore.rules.installer` fourni
2. Ou modifiez manuellement vos règles pour permettre `allow read: if true;`

**⚠️ Attention** : L'option B permet à n'importe qui de lire vos données. Utilisez uniquement en développement.

Voir `FIREBASE_SETUP.md` pour plus de détails.

Exemple de `.env` :
```
FIREBASE_API_KEY=AIzaSy...
FIREBASE_AUTH_DOMAIN=votre-projet.firebaseapp.com
FIREBASE_PROJECT_ID=votre-projet-id
FIREBASE_STORAGE_BUCKET=votre-projet.appspot.com
FIREBASE_MESSAGING_SENDER_ID=123456789
FIREBASE_APP_ID=1:123456789:web:abc123
```

## Utilisation

### Mode développement
```bash
npm start
```

### Mode développement avec DevTools
```bash
npm run dev
```

## Build pour Windows

Pour créer un exécutable Windows (.exe) :
```bash
npm run build
```

L'exécutable sera créé dans le dossier `dist/`.

## Fonctionnement

1. **Récupération des jeux** : L'application se connecte à Firebase Firestore pour récupérer la liste des jeux disponibles
2. **Téléchargement** : 
   - Pour les fichiers ZIP : téléchargement direct avec barre de progression
   - Pour les torrents : utilisation de WebTorrent pour le téléchargement P2P
3. **Extraction** : Les fichiers ZIP sont automatiquement extraits dans `C:\sroff-game\nomdujeux`
4. **Détection du .exe** : L'application recherche automatiquement le fichier .exe principal
5. **Raccourci** : Un raccourci est créé sur le bureau de l'utilisateur

## Structure du projet

```
installer-app/
├── main.js              # Processus principal Electron
├── index.html           # Interface utilisateur
├── config.js            # Configuration de l'application
├── package.json         # Dépendances et scripts
├── utils/
│   └── shortcut.js     # Utilitaires pour créer les raccourcis Windows
├── .env                # Variables d'environnement (à créer)
└── README.md           # Documentation
```



## Configuration avancée

Vous pouvez modifier le dossier d'installation dans `config.js` ou via la variable d'environnement `GAMES_DIR` dans votre fichier `.env`.

## Dépannage

### L'application ne se connecte pas à Firebase
- Vérifiez que votre fichier `.env` contient toutes les variables nécessaires
- Vérifiez que les règles Firestore autorisent la lecture (l'application n'utilise pas d'authentification)

### Les téléchargements échouent
- Vérifiez votre connexion internet
- Pour les torrents, assurez-vous qu'il y a des seeders disponibles

### Les raccourcis ne sont pas créés
- Vérifiez que l'application a les permissions d'écriture sur le bureau
- Exécutez l'application en tant qu'administrateur si nécessaire

## Démarrage rapide

1. Double-cliquez sur `install.bat` pour installer les dépendances
2. Configurez votre fichier `.env` (copiez `env.example.txt` vers `.env`)
3. Double-cliquez sur `start.bat` pour lancer l'application

## Notes importantes

- Les jeux sont installés dans `C:\sroff-game\` par défaut
- Les raccourcis sont créés sur le bureau de l'utilisateur Windows
- L'application détecte automatiquement les fichiers .exe principaux (ignore les fichiers "uninstall")
- Les fichiers ZIP temporaires sont supprimés après extraction
- Pour une icône personnalisée, placez un fichier `icon.ico` dans le dossier `installer-app/`

## Support

En cas de problème :
1. Vérifiez que toutes les dépendances sont installées (`npm install`)
2. Vérifiez votre fichier `.env` contient toutes les variables Firebase
3. Vérifiez que votre connexion internet fonctionne
4. Consultez la console (F12) pour voir les erreurs détaillées

