// Charger les variables d'environnement
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const yauzl = require('yauzl');
const WebTorrent = require('webtorrent');
const { spawn } = require('child_process');
const { createShortcut } = require('./utils/shortcut');
const config = require('./config');

let mainWindow;

const GAMES_DIR = config.GAMES_DIR;
const GITHUB_TOKEN = config.GITHUB_TOKEN;
const GAMES_URL = config.GAMES_URL;

// Système de gestion des téléchargements multiples
const activeDownloads = new Map(); // Map<downloadId, downloadInfo>
const downloadProcesses = new Map(); // Map<downloadId, { type, process, cancelToken }>
let downloadHistory = []; // Historique des téléchargements (terminés, annulés, erreurs)
let downloadIdCounter = 0;

// Chemin pour sauvegarder l'historique
const HISTORY_FILE = path.join(app.getPath('userData'), 'download-history.json');

// Configuration pour les mises à jour
const GITHUB_REPO = "SROff23712/sroff-game-installer";
const GITHUB_BRANCH = "main";
const os = require('os');

// Fonction pour obtenir le chemin LocalAppData de manière fiable
function getLocalAppData() {
  // Essayer d'abord la variable d'environnement
  if (process.env.LOCALAPPDATA) {
    return process.env.LOCALAPPDATA;
  }
  // Sinon construire le chemin manuellement
  const homeDir = os.homedir();
  return path.join(homeDir, 'AppData', 'Local');
}

// Utiliser le dossier userData de l'app au lieu de Programs (plus fiable et pas besoin de permissions admin)
const BASE_DIR = path.join(app.getPath('userData'), '..', '..', 'Programs', 'Sroff Game Installer');
// Alternative si le dossier Programs n'est pas accessible : utiliser userData directement
const BASE_DIR_FALLBACK = path.join(app.getPath('userData'), 'Sroff Game Installer');
const STATE_FILE = path.join(app.getPath('userData'), 'installer-state.json');

// Charger l'historique au démarrage
function loadDownloadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const historyData = fs.readFileSync(HISTORY_FILE, 'utf-8');
      downloadHistory = JSON.parse(historyData);
      console.log('[History] Historique chargé:', downloadHistory.length, 'téléchargements');
    } else {
      downloadHistory = [];
      console.log('[History] Aucun historique trouvé, création d\'un nouveau');
    }
  } catch (error) {
    console.error('[History] Erreur chargement historique:', error);
    downloadHistory = [];
  }
}

// Sauvegarder l'historique
function saveDownloadHistory() {
  try {
    // Garder seulement les 100 derniers téléchargements
    if (downloadHistory.length > 100) {
      downloadHistory = downloadHistory.slice(0, 100);
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(downloadHistory, null, 2), 'utf-8');
    console.log('[History] Historique sauvegardé:', downloadHistory.length, 'téléchargements');
  } catch (error) {
    console.error('[History] Erreur sauvegarde historique:', error);
  }
}

// Fonction pour trouver l'exécutable Python
function getPythonExecutable() {
  // Option 1: Python Embedded bundlé avec l'app (dans resources/)
  const bundledPython = path.join(process.resourcesPath || '', 'python-embedded', 'python.exe');
  if (fs.existsSync(bundledPython)) {
    console.log('[Python] ✅ Utilisation de Python Embedded bundlé');
    return bundledPython;
  }
  
  // Option 2: Python en développement (depuis le dossier du projet)
  const devPython = path.join(__dirname, 'test', 'python-embedded', 'python.exe');
  if (fs.existsSync(devPython)) {
    console.log('[Python] ✅ Utilisation de Python Embedded dev');
    return devPython;
  }
  
  // Option 3: Python système (PATH)
  console.log('[Python] ⚠️ Utilisation de Python système');
  return 'python';
}

const pythonExe = getPythonExecutable();
console.log('[Python] Exécutable Python utilisé:', pythonExe);

// Fonction pour obtenir le chemin du script Python
function getPythonScriptPath(scriptName) {
  // En développement
  const devPath = path.join(__dirname, 'python', scriptName);
  if (fs.existsSync(devPath)) {
    return devPath;
  }
  
  // En production (bundlé)
  const bundledPath = path.join(process.resourcesPath || '', 'python', scriptName);
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }
  
  throw new Error(`Script Python introuvable: ${scriptName}`);
}

// Récupérer les jeux depuis GitHub ou fichier local
async function getGamesFromGitHub() {
  // Essayer d'abord depuis GitHub
  try {
    console.log('Récupération des jeux depuis GitHub...');
    console.log('URL:', GAMES_URL);
    
    const headers = {
      'Accept': 'application/vnd.github.v3.raw',
      'User-Agent': 'SroffGameInstaller-Electron'
    };
    
    // Ajouter le token si disponible
    if (GITHUB_TOKEN) {
      headers['Authorization'] = `token ${GITHUB_TOKEN}`;
      console.log('Token GitHub utilisé');
    } else {
      console.log('Aucun token GitHub, tentative sans authentification');
    }
    
    const response = await axios.get(GAMES_URL, {
      headers: headers,
      timeout: 30000
    });
    
    console.log('Jeux récupérés avec succès depuis GitHub:', response.data.length, 'jeux');
    return response.data;
  } catch (error) {
    console.error('Erreur récupération jeux GitHub:', error.message);
    console.log('Tentative de fallback vers le fichier local...');
    
    // Fallback: utiliser le fichier local s'il existe
    const localGamesPath = config.LOCAL_GAMES_PATH || path.join(__dirname, 'test', 'games_updated.json');
    if (fs.existsSync(localGamesPath)) {
      try {
        console.log('Lecture du fichier local:', localGamesPath);
        const localGamesData = fs.readFileSync(localGamesPath, 'utf-8');
        const localGames = JSON.parse(localGamesData);
        console.log('Jeux récupérés depuis le fichier local:', localGames.length, 'jeux');
        return localGames;
      } catch (localError) {
        console.error('Erreur lecture fichier local:', localError.message);
        throw new Error(`Impossible de récupérer les jeux depuis GitHub (${error.message}) et le fichier local est corrompu (${localError.message})`);
      }
    } else {
      console.error('Fichier local non trouvé:', localGamesPath);
      throw new Error(`Impossible de récupérer les jeux depuis GitHub (${error.message}) et aucun fichier local trouvé`);
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // Enlever la barre de titre par défaut
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'icon.ico'),
    title: 'sroff-crack launcher',
    backgroundColor: '#0a0a0f',
    show: false // Ne pas afficher la fenêtre avant qu'elle soit prête
  });

  mainWindow.loadFile('index.html');

  // Afficher la fenêtre seulement quand elle est prête
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Ouvrir DevTools en mode développement
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  // Charger l'historique au démarrage
  loadDownloadHistory();
  
  createWindow();

  // Créer le dossier des jeux s'il n'existe pas
  if (!fs.existsSync(GAMES_DIR)) {
    fs.mkdirSync(GAMES_DIR, { recursive: true });
  }

  // Vérifier les mises à jour au démarrage
  setTimeout(() => {
    checkForUpdates();
  }, 2000); // Attendre 2 secondes après le démarrage

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Sauvegarder l'historique avant de quitter
app.on('before-quit', () => {
  saveDownloadHistory();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

// Vérifier l'état d'authentification
ipcMain.handle('check-auth', async () => {
  return { 
    authenticated: currentUser !== null, 
    user: currentUser ? { email: currentUser.email, uid: currentUser.uid } : null 
  };
});

// Se connecter avec Google
ipcMain.handle('sign-in-google', async () => {
  try {
    if (!auth) {
      throw new Error('Firebase non initialisé');
    }
    const provider = new GoogleAuthProvider();
    
    // Dans Electron, signInWithPopup devrait fonctionner avec le navigateur intégré
    const result = await signInWithPopup(auth, provider);
    return { success: true, user: { email: result.user.email, uid: result.user.uid } };
  } catch (error) {
    console.error('Erreur connexion Google:', error);
    return { success: false, error: error.message };
  }
});

// Se connecter avec GitHub
ipcMain.handle('sign-in-github', async () => {
  try {
    if (!auth) {
      throw new Error('Firebase non initialisé');
    }
    const provider = new GithubAuthProvider();
    const result = await signInWithPopup(auth, provider);
    return { success: true, user: { email: result.user.email, uid: result.user.uid } };
  } catch (error) {
    console.error('Erreur connexion GitHub:', error);
    return { success: false, error: error.message };
  }
});

// Se déconnecter
ipcMain.handle('sign-out', async () => {
  try {
    if (auth && currentUser) {
      await auth.signOut();
      return { success: true };
    }
    return { success: false, error: 'Pas d\'utilisateur connecté' };
  } catch (error) {
    console.error('Erreur déconnexion:', error);
    return { success: false, error: error.message };
  }
});

// Récupérer la liste des jeux depuis GitHub
ipcMain.handle('get-games', async () => {
  try {
    const games = await getGamesFromGitHub();
    
    // Transformer les jeux GitHub au format attendu par l'application
    const formattedGames = games.map((game, index) => {
      const downloadLink = game.dl && game.dl.length > 0 ? game.dl[0] : '';
      const sourceInfo = downloadLink ? detectDownloadService(downloadLink) : { type: 'unknown', name: 'Inconnu' };
      
      return {
        id: `game-${index}`,
        title: game.title,
        downloadLink: downloadLink,
        imageUrl: game.image || '',
        description: game.description || '',
        isMultiplayer: game.online || false,
        isTorrent: false, // À déterminer selon le lien
        genres: game.categories || [],
        releaseDate: game.release_date || '',
        size: game.size || '',
        source: sourceInfo.name || 'Inconnu'
      };
    });
    
    return { success: true, games: formattedGames };
  } catch (error) {
    console.error('Erreur récupération jeux:', error);
    return { 
      success: false, 
      error: error.message || 'Erreur lors de la récupération des jeux depuis GitHub', 
      games: [] 
    };
  }
});

// Télécharger et installer un jeu
ipcMain.handle('install-game', async (event, game) => {
  try {
    // Générer un ID unique pour ce téléchargement
    const downloadId = `download-${Date.now()}-${++downloadIdCounter}`;
    
    // Utiliser le même dossier que l'autre application FrostApp
    // Les jeux sont téléchargés et extraits directement dans ~/.FrostApp/downloads/nomdujeu
    const gameDir = path.join(GAMES_DIR, sanitizeFileName(game.title));
    
    // Créer le dossier du jeu
    if (!fs.existsSync(gameDir)) {
      fs.mkdirSync(gameDir, { recursive: true });
    }

    const downloadLink = game.downloadLink;
    
    // Enregistrer le téléchargement dans la Map
    activeDownloads.set(downloadId, {
      id: downloadId,
      gameTitle: game.title,
      gameDir: gameDir,
      status: 'starting',
      progress: 0,
      message: 'Démarrage...',
      startTime: Date.now()
    });
    
    // Envoyer la notification de démarrage
    event.sender.send('download-started', {
      id: downloadId,
      gameTitle: game.title,
      status: 'starting',
      progress: 0
    });
    
    // Détecter si c'est un torrent (vérifier l'URL)
    const isTorrent = downloadLink.includes('.torrent') || 
                      downloadLink.includes('magnet:') || 
                      game.isTorrent;
    
    // Lancer le téléchargement en arrière-plan (non bloquant)
    const downloadPromise = isTorrent 
      ? downloadTorrent(downloadLink, gameDir, game.title, event, downloadId)
      : downloadAndExtractZip(downloadLink, gameDir, game.title, event, downloadId);
    
    // Ne pas attendre la fin du téléchargement, retourner immédiatement
    downloadPromise.then(result => {
      const downloadInfo = activeDownloads.get(downloadId) || {
        id: downloadId,
        gameTitle: game.title,
        status: 'starting',
        progress: 0,
        startTime: Date.now()
      };
      
      if (result.success) {
        const completedInfo = {
          ...downloadInfo,
          status: 'completed',
          progress: 100,
          endTime: Date.now()
        };
        
        activeDownloads.set(downloadId, completedInfo);
        
        // Ajouter à l'historique
        downloadHistory.unshift({
          ...completedInfo,
          id: downloadId,
          gameTitle: game.title,
          gameId: game.id
        });
        
        // Garder seulement les 100 derniers téléchargements dans l'historique
        if (downloadHistory.length > 100) {
          downloadHistory.pop();
        }
        
        // Sauvegarder l'historique
        saveDownloadHistory();
        
        console.log('[Download] Téléchargement terminé:', game.title, 'Historique:', downloadHistory.length);
        
        // Retirer immédiatement des téléchargements actifs
        activeDownloads.delete(downloadId);
        event.sender.send('download-removed-from-active', { id: downloadId });
        
        event.sender.send('download-completed', {
          id: downloadId,
          gameTitle: game.title,
          success: true
        });
      } else {
        const errorInfo = {
          ...downloadInfo,
          status: 'error',
          error: result.error,
          endTime: Date.now()
        };
        
        activeDownloads.set(downloadId, errorInfo);
        
        // Ajouter à l'historique
        downloadHistory.unshift({
          ...errorInfo,
          id: downloadId,
          gameTitle: game.title,
          gameId: game.id
        });
        
        if (downloadHistory.length > 100) {
          downloadHistory.pop();
        }
        
        // Sauvegarder l'historique
        saveDownloadHistory();
        
        console.log('[Download] Erreur téléchargement:', game.title, 'Historique:', downloadHistory.length);
        
        // Retirer immédiatement des téléchargements actifs
        activeDownloads.delete(downloadId);
        event.sender.send('download-removed-from-active', { id: downloadId });
        
        event.sender.send('download-error', {
          id: downloadId,
          gameTitle: game.title,
          error: result.error
        });
      }
    }).catch(error => {
      const downloadInfo = activeDownloads.get(downloadId) || {
        id: downloadId,
        gameTitle: game.title,
        status: 'starting',
        progress: 0,
        startTime: Date.now()
      };
      
      // Vérifier si le téléchargement a été annulé manuellement
      // Si oui, ne pas ajouter à l'historique ici (évite les doublons)
      if (downloadInfo.status === 'cancelled' || error.message.includes('cancel') || error.message.includes('Cancel')) {
        console.log(`[Cancel] Téléchargement ${downloadId} déjà annulé, ignoré dans catch`);
        // Nettoyer seulement
        activeDownloads.delete(downloadId);
        return;
      }
      
      // Vérifier si le téléchargement existe déjà dans l'historique (évite les doublons)
      const existingInHistory = downloadHistory.find(d => d.id === downloadId);
      if (existingInHistory) {
        console.log(`[Cancel] Téléchargement ${downloadId} existe déjà dans l'historique, ignoré dans catch`);
        activeDownloads.delete(downloadId);
        return;
      }
      
      const errorInfo = {
        ...downloadInfo,
        status: 'error',
        error: error.message,
        endTime: Date.now()
      };
      
      activeDownloads.set(downloadId, errorInfo);
      
      // Ajouter à l'historique
      downloadHistory.unshift({
        ...errorInfo,
        id: downloadId,
        gameTitle: game.title,
        gameId: game.id
      });
      
      if (downloadHistory.length > 100) {
        downloadHistory.pop();
      }
      
      // Sauvegarder l'historique
      saveDownloadHistory();
      
      console.log('[Download] Exception téléchargement:', game.title, error.message, 'Historique:', downloadHistory.length);
      
      // Retirer immédiatement des téléchargements actifs
      activeDownloads.delete(downloadId);
      event.sender.send('download-removed-from-active', { id: downloadId });
      
      event.sender.send('download-error', {
        id: downloadId,
        gameTitle: game.title,
        error: error.message
      });
    });
    
    // Retourner immédiatement avec l'ID du téléchargement
    return { 
      success: true, 
      downloadId: downloadId,
      message: 'Téléchargement démarré'
    };
  } catch (error) {
    console.error('Erreur installation jeu:', error);
    return { success: false, error: error.message };
  }
});

// Obtenir la liste des téléchargements actifs
ipcMain.handle('get-active-downloads', async () => {
  return Array.from(activeDownloads.values());
});

// Obtenir l'historique des téléchargements
ipcMain.handle('get-download-history', async () => {
  return downloadHistory;
});

// Annuler un téléchargement
ipcMain.handle('cancel-download', async (event, downloadId) => {
  try {
    const download = activeDownloads.get(downloadId);
    if (!download) {
      return { success: false, error: 'Téléchargement introuvable' };
    }

    // Marquer comme annulé IMMÉDIATEMENT pour éviter les doublons
    download.status = 'cancelled';
    activeDownloads.set(downloadId, download);

    const processInfo = downloadProcesses.get(downloadId);
    
    // Arrêter le processus de téléchargement
    if (processInfo) {
      if (processInfo.type === 'torrent' && processInfo.process) {
        // Arrêter le client WebTorrent
        processInfo.process.destroy();
        console.log(`[Cancel] Client WebTorrent arrêté pour ${downloadId}`);
      } else if (processInfo.type === 'python' && processInfo.process) {
        // Tuer le processus Python
        processInfo.process.kill();
        console.log(`[Cancel] Processus Python arrêté pour ${downloadId}`);
      } else if (processInfo.type === 'axios' && processInfo.cancelToken) {
        // Annuler la requête axios
        processInfo.cancelToken.cancel('Téléchargement annulé par l\'utilisateur');
        console.log(`[Cancel] Requête axios annulée pour ${downloadId}`);
      }
      downloadProcesses.delete(downloadId);
    }

    // Supprimer les fichiers téléchargés
    // Attendre un peu pour que les processus se terminent
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (download.gameDir && fs.existsSync(download.gameDir)) {
      try {
        // Fonction récursive pour supprimer le dossier
        const deleteFolderRecursive = (dirPath) => {
          if (fs.existsSync(dirPath)) {
            const files = fs.readdirSync(dirPath);
            files.forEach((file) => {
              const curPath = path.join(dirPath, file);
              const stat = fs.statSync(curPath);
              if (stat.isDirectory()) {
                deleteFolderRecursive(curPath);
              } else {
                try {
                  fs.unlinkSync(curPath);
                } catch (err) {
                  // Ignorer les erreurs de fichiers verrouillés
                  console.warn(`[Cancel] Impossible de supprimer ${curPath}: ${err.message}`);
                }
              }
            });
            try {
              fs.rmdirSync(dirPath);
            } catch (err) {
              console.warn(`[Cancel] Impossible de supprimer le dossier ${dirPath}: ${err.message}`);
            }
          }
        };
        
        // Essayer plusieurs fois avec fs.rmSync d'abord
        let deleted = false;
        for (let i = 0; i < 3; i++) {
          try {
            fs.rmSync(download.gameDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            deleted = true;
            console.log(`[Cancel] Dossier supprimé: ${download.gameDir}`);
            break;
          } catch (err) {
            if (i < 2) {
              // Attendre un peu avant de réessayer
              await new Promise(resolve => setTimeout(resolve, 200));
            } else {
              // Dernière tentative avec la méthode récursive
              console.log(`[Cancel] Tentative de suppression récursive manuelle...`);
              deleteFolderRecursive(download.gameDir);
              if (fs.existsSync(download.gameDir)) {
                // Dernier essai avec fs.rmSync
                try {
                  fs.rmSync(download.gameDir, { recursive: true, force: true });
                  deleted = true;
                } catch (finalErr) {
                  console.error(`[Cancel] Échec final de suppression: ${finalErr.message}`);
                }
              } else {
                deleted = true;
              }
            }
          }
        }
        
        if (!deleted && fs.existsSync(download.gameDir)) {
          console.error(`[Cancel] Impossible de supprimer complètement le dossier: ${download.gameDir}`);
        }
      } catch (err) {
        console.error(`[Cancel] Erreur lors de la suppression du dossier: ${err.message}`);
      }
    }

    // Ajouter à l'historique
    const cancelledInfo = {
      ...download,
      status: 'cancelled',
      endTime: Date.now()
    };
    
    downloadHistory.unshift({
      ...cancelledInfo,
      id: downloadId,
      gameTitle: download.gameTitle,
      gameId: download.gameId
    });

    // Garder seulement les 100 derniers téléchargements
    if (downloadHistory.length > 100) {
      downloadHistory.pop();
    }

    // Sauvegarder l'historique
    saveDownloadHistory();
    
    // Retirer des téléchargements actifs après un court délai
    setTimeout(() => {
      activeDownloads.delete(downloadId);
    }, 100);
    
    // Notifier le renderer
    event.sender.send('download-removed-from-active', { id: downloadId });
    event.sender.send('download-cancelled', {
      id: downloadId,
      gameTitle: download.gameTitle
    });

    console.log(`[Cancel] Téléchargement annulé: ${download.gameTitle}`);
    return { success: true };
  } catch (error) {
    console.error(`[Cancel] Erreur lors de l'annulation:`, error);
    return { success: false, error: error.message };
  }
});

// Handlers pour la barre de titre personnalisée
ipcMain.on('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// Détecter le type de service de téléchargement
function detectDownloadService(url) {
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('gofile.io') || urlLower.includes('gofile')) {
    return { type: 'gofile', name: 'Gofile' };
  }
  if (urlLower.includes('mega.nz') || urlLower.includes('mega.co.nz')) {
    return { type: 'mega', name: 'Mega' };
  }
  if (urlLower.includes('mediafire.com') || urlLower.includes('mediafire')) {
    return { type: 'mediafire', name: 'MediaFire' };
  }
  if (urlLower.includes('zippyshare.com') || urlLower.includes('zippyshare')) {
    return { type: 'zippyshare', name: 'ZippyShare' };
  }
  if (urlLower.includes('1fichier.com') || urlLower.includes('1fichier')) {
    return { type: '1fichier', name: '1Fichier' };
  }
  if (urlLower.includes('dlink7.com') || urlLower.includes('dlink7')) {
    return { type: 'dlink7', name: 'DLink7' };
  }
  if (urlLower.includes('clictune.com') || urlLower.includes('clictune')) {
    return { type: 'clictune', name: 'ClicTune' };
  }
  if (urlLower.includes('uploaded.net') || urlLower.includes('uploaded')) {
    return { type: 'uploaded', name: 'Uploaded' };
  }
  if (urlLower.includes('turbobit.net') || urlLower.includes('turbobit')) {
    return { type: 'turbobit', name: 'Turbobit' };
  }
  if (urlLower.includes('buzzheavier.com') || urlLower.includes('buzzheavier')) {
    return { type: 'buzzheavier', name: 'BuzzHeavier' };
  }
  if (urlLower.includes('pixeldrain.com') || urlLower.includes('pixeldrain')) {
    return { type: 'pixeldrain', name: 'PixelDrain' };d
  }
  
  return { type: 'unknown', name: 'Inconnu' };
}

// Suivre les redirections (pour les liens ClicTune)
async function followRedirects(url, maxRedirects = 10) {
  let currentUrl = url;
  let redirectCount = 0;

  console.log('Suivi des redirections pour:', url);

  // Utiliser une approche HEAD d'abord pour suivre les redirections sans télécharger
  while (redirectCount < maxRedirects) {
    try {
      const response = await axios.head(currentUrl, {
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 500,
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // Si c'est une redirection (3xx)
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (location) {
          currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
          redirectCount++;
          console.log(`Redirection ${redirectCount}: ${currentUrl}`);
          
          // Détecter si on arrive sur un service qui nécessite une interaction
          const service = detectDownloadService(currentUrl);
          if (service.type !== 'unknown') {
            console.log(`Service détecté: ${service.name}`);
            return { url: currentUrl, service: service };
          }
          
          continue;
        }
      }

      // Si c'est une réponse OK, vérifier le service
      const service = detectDownloadService(currentUrl);
      if (service.type !== 'unknown') {
        return { url: currentUrl, service: service };
      }
      
      return { url: currentUrl, service: null };
    } catch (error) {
      // Si c'est une erreur de redirection, récupérer la location depuis les headers
      if (error.response) {
        const status = error.response.status;
        const location = error.response.headers.location;
        
        if (status >= 300 && status < 400 && location) {
          currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
          redirectCount++;
          console.log(`Redirection ${redirectCount} (via error): ${currentUrl}`);
          
          // Détecter le service
          const service = detectDownloadService(currentUrl);
          if (service.type !== 'unknown') {
            return { url: currentUrl, service: service };
          }
          
          continue;
        }
      }

      // Si HEAD ne fonctionne pas, essayer GET mais seulement pour la première requête
      if (redirectCount === 0) {
        try {
          const getResponse = await axios.get(currentUrl, {
            maxRedirects: 5,
            validateStatus: () => true,
            timeout: 10000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          
          // Récupérer l'URL finale
          const finalUrl = getResponse.request.res.responseUrl || getResponse.request.url || currentUrl;
          console.log('URL finale après GET:', finalUrl);
          
          const service = detectDownloadService(finalUrl);
          return { url: finalUrl, service: service };
        } catch (getError) {
          console.warn('Erreur lors du GET, utilisation de l\'URL actuelle:', currentUrl);
          const service = detectDownloadService(currentUrl);
          return { url: currentUrl, service: service };
        }
      }
      
      // Si tout échoue, retourner l'URL actuelle
      console.warn('Impossible de suivre les redirections, utilisation de l\'URL actuelle:', currentUrl);
      const service = detectDownloadService(currentUrl);
      return { url: currentUrl, service: service };
    }
  }

  console.log('URL finale après redirections:', currentUrl);
  const service = detectDownloadService(currentUrl);
  return { url: currentUrl, service: service };
}

// Télécharger et extraire un fichier ZIP
async function downloadAndExtractZip(url, destinationDir, gameTitle, event, downloadId = null) {
  try {
    const updateProgress = (status, progress, message = null, service = null) => {
      const update = { 
        id: downloadId,
        gameTitle, 
        status, 
        progress 
      };
      if (message) update.message = message;
      if (service) update.service = service;
      
      // Mettre à jour la Map
      if (downloadId && activeDownloads.has(downloadId)) {
        const download = activeDownloads.get(downloadId);
        activeDownloads.set(downloadId, {
          ...download,
          status,
          progress,
          message: message || download.message
        });
      }
      
      event.sender.send('download-progress', update);
    };
    
    updateProgress('resolving-url', 0);

    // Suivre les redirections pour obtenir le vrai lien (ClicTune, etc.)
    const redirectResult = await followRedirects(url);
    const realUrl = redirectResult.url;
    const service = redirectResult.service;
    
    console.log('URL résolue:', realUrl);
    
    // Vérifier d'abord si c'est un lien direct vers un fichier ZIP
    // Si oui, on peut télécharger directement avec axios
    const isDirectZipLink = realUrl.toLowerCase().endsWith('.zip') || 
                           realUrl.toLowerCase().includes('.zip?') ||
                           realUrl.toLowerCase().includes('.zip#');
    
    // Si ce n'est PAS un lien direct ZIP, utiliser le script Python
    // Le script Python peut gérer tous les services (Gofile, Mega, BuzzHeavier, etc.)
    if (!isDirectZipLink) {
      const serviceName = service ? service.name : 'Service inconnu';
      console.log(`Utilisation du script Python pour télécharger depuis ${serviceName}...`);
      
      updateProgress('downloading-with-python', 0, `Téléchargement via ${serviceName}...`, serviceName);
      
      // Utiliser le script Python pour télécharger
      return await downloadWithPython(realUrl, destinationDir, gameTitle, event, downloadId);
    }
    
    // Si c'est un lien direct ZIP, continuer avec le téléchargement axios normal
    console.log('Lien direct ZIP détecté, téléchargement direct...');

    updateProgress('downloading', 0);

    const tempZipPath = path.join(destinationDir, 'temp.zip');
    
    // Créer un token d'annulation pour axios
    const CancelToken = axios.CancelToken;
    const source = CancelToken.source();
    
    // Stocker le token d'annulation
    if (downloadId) {
      downloadProcesses.set(downloadId, {
        type: 'axios',
        cancelToken: source
      });
    }
    
    // Télécharger le fichier avec gestion d'erreurs améliorée
    const response = await axios({
      url: realUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 300000, // 5 minutes timeout
      maxContentLength: 10 * 1024 * 1024 * 1024, // 10GB max
      cancelToken: source.token,
      onDownloadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          updateProgress('downloading', percentCompleted);
        } else {
          // Si la taille totale n'est pas connue, afficher la taille téléchargée
          const mbDownloaded = (progressEvent.loaded / (1024 * 1024)).toFixed(2);
          updateProgress('downloading', 0, `${mbDownloaded} MB téléchargés`);
        }
      }
    });

    // Vérifier le type de contenu
    const contentType = response.headers['content-type'] || '';
    const contentLength = response.headers['content-length'];
    console.log('Content-Type reçu:', contentType);
    console.log('Content-Length:', contentLength);

    // Si c'est du HTML, utiliser le script Python pour télécharger
    if (contentType.includes('text/html')) {
      const detectedService = detectDownloadService(realUrl);
      
      console.log(`Content-Type HTML détecté, utilisation du script Python pour télécharger depuis ${detectedService.name}...`);
      
      updateProgress('downloading-with-python', 0, `Téléchargement via ${detectedService.name}...`, detectedService.name);
      
      // Utiliser le script Python pour télécharger
      return await downloadWithPython(realUrl, destinationDir, gameTitle, event, downloadId);
    }

    // Vérifier que ce n'est pas du HTML même si le Content-Type dit autre chose
    if (!contentType.includes('zip') && !contentType.includes('octet-stream') && !contentType.includes('application/zip') && !contentType.includes('application/x-zip')) {
      console.warn('Type de contenu inattendu:', contentType, '- Le fichier sera quand même téléchargé');
    }

    const writer = fs.createWriteStream(tempZipPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', () => {
        // Vérifier que le fichier a été téléchargé complètement
        const stats = fs.statSync(tempZipPath);
        if (stats.size === 0) {
          reject(new Error('Le fichier téléchargé est vide'));
          return;
        }
        resolve();
      });
      writer.on('error', reject);
      response.data.on('error', reject);
    });

    // Vérifier que le fichier est un ZIP valide avant extraction
    updateProgress('validating', 0);

    // Vérifier la taille du fichier
    const stats = fs.statSync(tempZipPath);
    if (stats.size === 0) {
      if (fs.existsSync(tempZipPath)) {
        fs.unlinkSync(tempZipPath);
      }
      throw new Error('Le fichier téléchargé est vide. Le lien peut être incorrect.');
    }

    // Vérifier les magic bytes du fichier (PK pour ZIP)
    const fileBuffer = fs.readFileSync(tempZipPath, { start: 0, end: Math.min(100, stats.size) });
    const isZip = fileBuffer.length >= 2 && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4B; // PK signature
    
    if (!isZip) {
      // Vérifier si c'est du HTML (commence par <)
      const textStart = fileBuffer.toString('utf-8', 0, Math.min(100, fileBuffer.length));
      const lowerText = textStart.toLowerCase();
      
      if (lowerText.trim().startsWith('<') || 
          lowerText.includes('<!doctype') || 
          lowerText.includes('<html') ||
          lowerText.includes('<body') ||
          lowerText.includes('html>') ||
          textStart.includes('Error') ||
          textStart.includes('error') ||
          textStart.includes('404') ||
          textStart.includes('Not Found')) {
        if (fs.existsSync(tempZipPath)) {
          fs.unlinkSync(tempZipPath);
        }
        throw new Error('Le lien redirige vers une page HTML au lieu d\'un fichier ZIP. Le lien de téléchargement peut être incorrect ou nécessiter une authentification. URL: ' + realUrl.substring(0, 100));
      }
      
      // Vérifier si c'est un fichier torrent
      if (textStart.includes('d8:announce') || textStart.includes('magnet:')) {
        if (fs.existsSync(tempZipPath)) {
          fs.unlinkSync(tempZipPath);
        }
        throw new Error('Le fichier téléchargé est un torrent, pas un ZIP. Utilisez l\'option torrent pour ce jeu.');
      }
      
      // Vérifier si c'est du JSON (peut-être une erreur API)
      if (textStart.trim().startsWith('{') || textStart.trim().startsWith('[')) {
        if (fs.existsSync(tempZipPath)) {
          fs.unlinkSync(tempZipPath);
        }
        throw new Error('Le serveur a retourné du JSON au lieu d\'un fichier ZIP. Le lien peut être incorrect.');
      }
      
      if (fs.existsSync(tempZipPath)) {
        fs.unlinkSync(tempZipPath);
      }
      throw new Error(`Le fichier téléchargé n'est pas un ZIP valide (signature: ${fileBuffer.slice(0, 4).toString('hex')}). Le lien peut être incorrect ou le fichier corrompu. URL: ${realUrl.substring(0, 100)}`);
    }

    // Tester si le fichier ZIP peut être ouvert
    try {
      await new Promise((resolve, reject) => {
        yauzl.open(tempZipPath, { lazyEntries: true }, (err) => {
          if (err) {
            reject(new Error(`Le fichier ZIP est corrompu: ${err.message}. Le téléchargement peut être incomplet.`));
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      // Supprimer le fichier invalide
      if (fs.existsSync(tempZipPath)) {
        fs.unlinkSync(tempZipPath);
      }
      throw error;
    }

    updateProgress('extracting', 0);

    // Extraire le ZIP
    await extractZip(tempZipPath, destinationDir, event, gameTitle, downloadId);

    // Supprimer le fichier ZIP temporaire
    fs.unlinkSync(tempZipPath);

    // Trouver le fichier .exe principal (recherche récursive dans tous les sous-dossiers)
    const exePath = findExeFile(destinationDir, gameTitle);
    
    if (exePath) {
      // Créer un raccourci sur le bureau avec le nom du jeu
      const desktopPath = path.join(require('os').homedir(), 'Desktop');
      const cleanGameName = sanitizeFileName(gameTitle);
      const shortcutPath = path.join(desktopPath, `${cleanGameName}.lnk`);
      console.log(`Création du raccourci: ${shortcutPath} -> ${exePath}`);
      await createShortcut(exePath, shortcutPath, gameTitle);
    } else {
      console.warn(`Aucun fichier .exe trouvé dans ${destinationDir}`);
    }

    updateProgress('completed', 100);

    return { 
      success: true, 
      gameDir: destinationDir,
      exePath: exePath || null
    };
  } catch (error) {
    updateProgress('error', 0, null, null);
    event.sender.send('download-error', {
      id: downloadId,
      gameTitle,
      error: error.message
    });
    throw error;
  }
}

// Extraire un fichier ZIP
function extractZip(zipPath, destinationDir, event, gameTitle, downloadId = null) {
  return new Promise((resolve, reject) => {
    let totalEntries = 0;
    let extractedEntries = 0;

    // Fonction helper pour mettre à jour la progression
    const updateProgress = (status, progress, message = null) => {
      const update = { 
        id: downloadId,
        gameTitle, 
        status, 
        progress 
      };
      if (message) update.message = message;
      
      // Mettre à jour la Map
      if (downloadId && activeDownloads.has(downloadId)) {
        const download = activeDownloads.get(downloadId);
        activeDownloads.set(downloadId, {
          ...download,
          status,
          progress,
          message: message || download.message
        });
      }
      
      event.sender.send('download-progress', update);
    };

    // D'abord, compter le nombre total d'entrées
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(err);
        return;
      }

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        totalEntries++;
        zipfile.readEntry();
      });

      zipfile.on('end', () => {
        // Maintenant, extraire les fichiers
        yauzl.open(zipPath, { lazyEntries: true }, (err2, zipfile2) => {
          if (err2) {
            reject(err2);
            return;
          }

          zipfile2.readEntry();

          zipfile2.on('entry', (entry) => {
            if (/\/$/.test(entry.fileName)) {
              // C'est un dossier
              const dirPath = path.join(destinationDir, entry.fileName);
              if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
              }
              zipfile2.readEntry();
            } else {
              // C'est un fichier
              zipfile2.openReadStream(entry, (err3, readStream) => {
                if (err3) {
                  reject(err3);
                  return;
                }

                const filePath = path.join(destinationDir, entry.fileName);
                const dirPath = path.dirname(filePath);
                
                if (!fs.existsSync(dirPath)) {
                  fs.mkdirSync(dirPath, { recursive: true });
                }

                const writeStream = fs.createWriteStream(filePath);
                readStream.pipe(writeStream);

                writeStream.on('close', () => {
                  extractedEntries++;
                  const progress = totalEntries > 0 ? Math.round((extractedEntries / totalEntries) * 100) : 0;
                  
                  updateProgress('extracting', progress);

                  zipfile2.readEntry();
                });

                writeStream.on('error', (err) => {
                  reject(err);
                });
              });
            }
          });

          zipfile2.on('end', () => {
            resolve();
          });

          zipfile2.on('error', reject);
        });
      });

      zipfile.on('error', reject);
    });
  });
}

// Télécharger avec le script Python (pour Gofile, Mega, etc.)
async function downloadWithPython(url, destinationDir, gameTitle, event, downloadId = null) {
  return new Promise((resolve, reject) => {
    try {
      const script = getPythonScriptPath('download_manager.py');
      const pythonDownloadId = downloadId || `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const userDataPath = app.getPath('userData');
      
      // Fonction helper pour mettre à jour la progression
      const updateProgress = (status, progress, message = null) => {
        const update = { 
          id: downloadId,
          gameTitle, 
          status, 
          progress 
        };
        if (message) update.message = message;
        
        // Mettre à jour la Map
        if (downloadId && activeDownloads.has(downloadId)) {
          const download = activeDownloads.get(downloadId);
          activeDownloads.set(downloadId, {
            ...download,
            status,
            progress,
            message: message || download.message
          });
        }
        
        event.sender.send('download-progress', update);
      };
      
      console.log('[Python Download] Démarrage téléchargement:', gameTitle);
      console.log('[Python Download] Script:', script);
      console.log('[Python Download] URL:', url);
      console.log('[Python Download] Destination:', destinationDir);
      
      const proc = spawn(pythonExe, [script, 'download', url, destinationDir, pythonDownloadId, userDataPath], { 
        windowsHide: true 
      });
      
      // Stocker le processus Python
      if (downloadId) {
        downloadProcesses.set(downloadId, {
          type: 'python',
          process: proc
        });
      }
      
      let lastProgress = 0;
      let lastMessage = '';
      
      proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const status = JSON.parse(line);
            if (status.progress !== undefined) {
              lastProgress = status.progress;
            }
            if (status.message) {
              lastMessage = status.message;
            }
            
            updateProgress('downloading-with-python', status.progress || lastProgress, status.message || lastMessage);
          } catch (e) {
            // Ignorer les lignes non-JSON
            console.log('[Python Download] Output:', line);
          }
        }
      });
      
      proc.stderr.on('data', (data) => {
        console.error('[Python Download] Error:', data.toString());
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          // Vérifier si un fichier ZIP a été téléchargé
          const files = fs.readdirSync(destinationDir);
          const zipFile = files.find(f => f.endsWith('.zip'));
          
          if (zipFile) {
            const zipPath = path.join(destinationDir, zipFile);
            updateProgress('extracting', 0);
            
            // Extraire le ZIP
            extractZip(zipPath, destinationDir, event, gameTitle, downloadId)
              .then(async () => {
                // Supprimer le ZIP après extraction
                if (fs.existsSync(zipPath)) {
                  fs.unlinkSync(zipPath);
                }
                
                // Trouver le fichier .exe principal (recherche récursive dans tous les sous-dossiers)
                const exePath = findExeFile(destinationDir, gameTitle);
                
                if (exePath) {
                  // Créer un raccourci sur le bureau avec le nom du jeu
                  try {
                    const desktopPath = path.join(require('os').homedir(), 'Desktop');
                    const cleanGameName = sanitizeFileName(gameTitle);
                    const shortcutPath = path.join(desktopPath, `${cleanGameName}.lnk`);
                    console.log(`Création du raccourci: ${shortcutPath} -> ${exePath}`);
                    await createShortcut(exePath, shortcutPath, gameTitle);
                    console.log(`✅ Raccourci créé avec succès: ${shortcutPath}`);
                  } catch (err) {
                    console.error('❌ Erreur lors de la création du raccourci:', err);
                  }
                } else {
                  console.warn(`Aucun fichier .exe trouvé dans ${destinationDir}`);
                }
                
                event.sender.send('download-progress', {
                  gameTitle,
                  status: 'completed',
                  progress: 100
                });
                
                resolve({
                  success: true,
                  gameDir: destinationDir,
                  exePath: exePath || null
                });
              })
              .catch(reject);
          } else {
            // Pas de ZIP, peut-être que le script a déjà extrait
            const exePath = findExeFile(destinationDir, gameTitle);
            
            if (exePath) {
              // Créer un raccourci sur le bureau avec le nom du jeu
              const desktopPath = path.join(require('os').homedir(), 'Desktop');
              const cleanGameName = sanitizeFileName(gameTitle);
              const shortcutPath = path.join(desktopPath, `${cleanGameName}.lnk`);
              console.log(`Création du raccourci: ${shortcutPath} -> ${exePath}`);
              
              createShortcut(exePath, shortcutPath, gameTitle)
                .then(() => {
                  console.log(`✅ Raccourci créé avec succès: ${shortcutPath}`);
                })
                .catch((err) => {
                  console.error('❌ Erreur lors de la création du raccourci:', err);
                });
            } else {
              console.warn(`Aucun fichier .exe trouvé dans ${destinationDir}`);
            }
            
            event.sender.send('download-progress', {
              gameTitle,
              status: 'completed',
              progress: 100
            });
            
            resolve({
              success: true,
              gameDir: destinationDir,
              exePath: exePath || null
            });
          }
        } else {
          reject(new Error(`Erreur lors du téléchargement Python (code ${code})`));
        }
      });
      
      proc.on('error', (err) => {
        reject(new Error(`Impossible de lancer le script Python: ${err.message}`));
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Télécharger un torrent
async function downloadTorrent(torrentUrl, destinationDir, gameTitle, event, downloadId = null) {
  return new Promise((resolve, reject) => {
    const client = new WebTorrent();
    
    // Stocker le client WebTorrent
    if (downloadId) {
      downloadProcesses.set(downloadId, {
        type: 'torrent',
        process: client
      });
    }

    // Fonction helper pour mettre à jour la progression
    const updateProgress = (status, progress, message = null) => {
      const update = { 
        id: downloadId,
        gameTitle, 
        status, 
        progress 
      };
      if (message) update.message = message;
      
      // Mettre à jour la Map
      if (downloadId && activeDownloads.has(downloadId)) {
        const download = activeDownloads.get(downloadId);
        activeDownloads.set(downloadId, {
          ...download,
          status,
          progress,
          message: message || download.message
        });
      }
      
      event.sender.send('download-progress', update);
    };

    updateProgress('downloading-torrent', 0);

    client.add(torrentUrl, { path: destinationDir }, (torrent) => {
      torrent.on('download', () => {
        const progress = Math.round(torrent.progress * 100);
        updateProgress('downloading-torrent', progress);
      });

      torrent.on('done', () => {
        updateProgress('extracting', 0);

        // Trouver le fichier .exe principal
        const exePath = findExeFile(destinationDir, gameTitle);
        
        if (exePath) {
          // Créer un raccourci sur le bureau avec le nom du jeu
          const desktopPath = path.join(require('os').homedir(), 'Desktop');
          const cleanGameName = sanitizeFileName(gameTitle);
          const shortcutPath = path.join(desktopPath, `${cleanGameName}.lnk`);
          console.log(`Création du raccourci: ${shortcutPath} -> ${exePath}`);
          createShortcut(exePath, shortcutPath, gameTitle).then(() => {
            updateProgress('completed', 100);
            
            // Nettoyer le processus
            if (downloadId) {
              downloadProcesses.delete(downloadId);
            }
            
            client.destroy();
            resolve({ 
              success: true, 
              gameDir: destinationDir,
              exePath: exePath 
            });
          }).catch(reject);
        } else {
          updateProgress('completed', 100);
          
          // Nettoyer le processus
          if (downloadId) {
            downloadProcesses.delete(downloadId);
          }
          
          client.destroy();
          resolve({ 
            success: true, 
            gameDir: destinationDir,
            exePath: null 
          });
        }
      });

      torrent.on('error', (err) => {
        // Nettoyer le processus
        if (downloadId) {
          downloadProcesses.delete(downloadId);
        }
        
        client.destroy();
        updateProgress('error', 0, err.message);
        event.sender.send('download-error', {
          id: downloadId,
          gameTitle,
          error: err.message
        });
        reject(err);
      });
    });
  });
}

// Trouver le fichier .exe principal dans un dossier (recherche récursive)
function findExeFile(dir, gameTitle = '') {
  if (!fs.existsSync(dir)) {
    return null;
  }
  
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    const exeFiles = [];
    
    // D'abord, chercher dans les fichiers de la racine
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      
      if (file.isDirectory()) {
        // Ignorer certains dossiers système
        const dirName = file.name.toLowerCase();
        if (dirName === '__pycache__' || dirName === 'node_modules' || dirName.startsWith('.')) {
          continue;
        }
        
        // Chercher récursivement dans les sous-dossiers
        const exe = findExeFile(fullPath, gameTitle);
        if (exe) {
          exeFiles.push(exe);
        }
      } else if (file.name.endsWith('.exe')) {
        const fileName = file.name.toLowerCase();
        
        // Ignorer les fichiers système et d'installation
        if (fileName.includes('uninstall') || 
            fileName.includes('setup') || 
            fileName.includes('installer') ||
            fileName.includes('launcher') && fileName.includes('steam')) {
          continue;
        }
        
        exeFiles.push(fullPath);
      }
    }
    
    // Si on a trouvé des .exe, choisir le meilleur
    if (exeFiles.length > 0) {
      // Priorité 1: Fichier avec le nom du jeu (si disponible)
      if (gameTitle) {
        const gameNameLower = gameTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const exe of exeFiles) {
          const exeName = path.basename(exe, '.exe').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (exeName.includes(gameNameLower) || gameNameLower.includes(exeName)) {
            console.log(`Fichier .exe trouvé (correspond au nom du jeu): ${exe}`);
            return exe;
          }
        }
      }
      
      // Priorité 2: Fichier dans un dossier "bin", "game", "game/bin", etc.
      const preferredDirs = ['bin', 'game', 'game\\bin', 'games', 'exe'];
      for (const exe of exeFiles) {
        const exeDir = path.dirname(exe).toLowerCase();
        for (const prefDir of preferredDirs) {
          if (exeDir.includes(prefDir)) {
            console.log(`Fichier .exe trouvé (dans dossier préféré): ${exe}`);
            return exe;
          }
        }
      }
      
      // Priorité 3: Prendre le premier .exe trouvé (pas uninstall/setup)
      console.log(`Fichier .exe trouvé: ${exeFiles[0]}`);
      return exeFiles[0];
    }
    
    return null;
  } catch (error) {
    console.error(`Erreur lors de la recherche de .exe dans ${dir}:`, error);
    return null;
  }
}

// Nettoyer le nom de fichier
function sanitizeFileName(fileName) {
  return fileName.replace(/[<>:"/\\|?*]/g, '_').trim();
}

// Vérifier si un jeu est déjà installé
ipcMain.handle('is-game-installed', (event, gameTitle) => {
  const gameDir = path.join(GAMES_DIR, sanitizeFileName(gameTitle));
  
  // Vérifier que le dossier existe
  if (!fs.existsSync(gameDir)) {
    return false;
  }
  
  // Vérifier qu'il y a au moins un fichier .exe dans le dossier
  // Cela garantit que le jeu est réellement installé et pas juste un dossier vide
  const exePath = findExeFile(gameDir, gameTitle);
  return exePath !== null;
});

// Obtenir le chemin d'installation d'un jeu
ipcMain.handle('get-game-path', (event, gameTitle) => {
  const gameDir = path.join(GAMES_DIR, sanitizeFileName(gameTitle));
  if (fs.existsSync(gameDir)) {
    const exePath = findExeFile(gameDir, gameTitle);
    return { installed: true, path: gameDir, exePath };
  }
  return { installed: false };
});

// Lancer un jeu
ipcMain.handle('launch-game', async (event, gameTitle) => {
  try {
    const gameDir = path.join(GAMES_DIR, sanitizeFileName(gameTitle));
    
    if (!fs.existsSync(gameDir)) {
      return { success: false, error: 'Le jeu n\'est pas installé' };
    }
    
    const exePath = findExeFile(gameDir, gameTitle);
    
    if (!exePath) {
      return { success: false, error: 'Fichier exécutable introuvable' };
    }
    
    // Lancer le jeu
    const gameProcess = spawn(exePath, [], {
      detached: true,
      stdio: 'ignore'
    });
    
    gameProcess.unref(); // Permet au processus de continuer après la fermeture de l'app
    
    console.log(`✅ Jeu lancé: ${gameTitle} (${exePath})`);
    return { success: true, exePath };
  } catch (error) {
    console.error(`❌ Erreur lors du lancement du jeu ${gameTitle}:`, error);
    return { success: false, error: error.message };
  }
});

// Obtenir tous les jeux installés
ipcMain.handle('get-installed-games', async () => {
  try {
    const installedGames = [];
    
    if (!fs.existsSync(GAMES_DIR)) {
      return installedGames;
    }
    
    const gameDirs = fs.readdirSync(GAMES_DIR, { withFileTypes: true });
    
    for (const dir of gameDirs) {
      if (dir.isDirectory()) {
        const gameDir = path.join(GAMES_DIR, dir.name);
        const exePath = findExeFile(gameDir, dir.name);
        
        if (exePath) {
          installedGames.push({
            title: dir.name,
            path: gameDir,
            exePath: exePath
          });
        }
      }
    }
    
    return installedGames;
  } catch (error) {
    console.error('Erreur lors de la récupération des jeux installés:', error);
    return [];
  }
});

// Désinstaller un jeu
ipcMain.handle('uninstall-game', async (event, gameTitle) => {
  try {
    const gameDir = path.join(GAMES_DIR, sanitizeFileName(gameTitle));
    
    if (!fs.existsSync(gameDir)) {
      return { success: false, error: 'Le jeu n\'est pas installé' };
    }
    
    // Supprimer le dossier du jeu
    fs.rmSync(gameDir, { recursive: true, force: true });
    console.log(`✅ Dossier du jeu supprimé: ${gameDir}`);
    
    // Supprimer le raccourci sur le bureau
    const desktopPath = path.join(require('os').homedir(), 'Desktop');
    const cleanGameName = sanitizeFileName(gameTitle);
    const shortcutPath = path.join(desktopPath, `${cleanGameName}.lnk`);
    
    if (fs.existsSync(shortcutPath)) {
      try {
        fs.unlinkSync(shortcutPath);
        console.log(`✅ Raccourci supprimé: ${shortcutPath}`);
      } catch (err) {
        console.warn(`⚠️ Impossible de supprimer le raccourci: ${err.message}`);
      }
    }
    
    console.log(`✅ Jeu désinstallé: ${gameTitle}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Erreur lors de la désinstallation du jeu ${gameTitle}:`, error);
    return { success: false, error: error.message };
  }
});

// Supprimer un téléchargement de l'historique
ipcMain.handle('remove-from-history', async (event, downloadId) => {
  try {
    const index = downloadHistory.findIndex(d => d.id === downloadId);
    if (index !== -1) {
      downloadHistory.splice(index, 1);
      saveDownloadHistory();
      console.log(`✅ Téléchargement supprimé de l'historique: ${downloadId}`);
      return { success: true };
    }
    return { success: false, error: 'Téléchargement introuvable' };
  } catch (error) {
    console.error('Erreur lors de la suppression de l\'historique:', error);
    return { success: false, error: error.message };
  }
});

// ==================== SYSTÈME DE MISE À JOUR ====================

// Charger l'état de l'installation
function loadInstallationState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[Update] Erreur lecture état:', error);
  }
  return null;
}

// Sauvegarder l'état de l'installation
function saveInstallationState(commitSha, commitDate) {
  try {
    const state = {
      last_commit_sha: commitSha,
      last_commit_date: commitDate,
      installation_date: Date.now()
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    console.log('[Update] État sauvegardé');
  } catch (error) {
    console.error('[Update] Erreur sauvegarde état:', error);
  }
}

// Récupérer le dernier commit depuis GitHub
async function getLatestCommit() {
  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`;
    const response = await axios.get(apiUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Sroff-Launcher'
      }
    });
    
    const commit = response.data;
    return {
      sha: commit.sha,
      date: new Date(commit.commit.committer.date).getTime(),
      message: commit.commit.message
    };
  } catch (error) {
    console.error('[Update] Erreur récupération commit:', error.message);
    return null;
  }
}

// Vérifier s'il y a une mise à jour disponible
async function checkForUpdates() {
  try {
    const latestCommit = await getLatestCommit();
    if (!latestCommit) return;

    const state = loadInstallationState();
    const needsUpdate = !state || state.last_commit_sha !== latestCommit.sha;

    if (needsUpdate && mainWindow) {
      mainWindow.webContents.send('update-available', {
        commitSha: latestCommit.sha,
        commitMessage: latestCommit.message,
        commitDate: latestCommit.date
      });
    }
  } catch (error) {
    console.error('[Update] Erreur vérification:', error);
  }
}

// Handler pour vérifier les mises à jour
ipcMain.handle('check-updates', async () => {
  const latestCommit = await getLatestCommit();
  if (!latestCommit) {
    return { success: false, error: 'Impossible de vérifier les mises à jour' };
  }

  const state = loadInstallationState();
  const needsUpdate = !state || state.last_commit_sha !== latestCommit.sha;

  return {
    success: true,
    needsUpdate,
    latestCommit: needsUpdate ? {
      sha: latestCommit.sha,
      message: latestCommit.message,
      date: latestCommit.date
    } : null
  };
});

// Fonction pour obtenir le dossier d'installation (avec fallback)
function getInstallDir() {
  try {
    // Essayer d'abord le dossier Programs
    const programsDir = path.dirname(BASE_DIR);
    if (fs.existsSync(programsDir) && fs.statSync(programsDir).isDirectory()) {
      // Vérifier si on peut écrire dedans
      try {
        const testFile = path.join(programsDir, '.test-write');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        return BASE_DIR;
      } catch (e) {
        console.log('[Update] Pas d\'accès en écriture à Programs, utilisation du fallback');
      }
    }
  } catch (e) {
    console.log('[Update] Erreur accès Programs:', e.message);
  }
  // Utiliser le fallback dans userData
  return BASE_DIR_FALLBACK;
}

// Handler pour lancer la mise à jour
ipcMain.handle('perform-update', async (event) => {
  let installDir; // Déclarer en dehors du try pour être accessible partout
  try {
    const latestCommit = await getLatestCommit();
    if (!latestCommit) {
      return { success: false, error: 'Impossible de récupérer la mise à jour' };
    }

    // Déterminer le dossier d'installation
    installDir = getInstallDir();
    console.log('[Update] Installation dans:', installDir);

    // Envoyer le début de la mise à jour
    event.sender.send('update-progress', { status: 'starting', progress: 0, message: 'Démarrage...' });

    // Supprimer l'ancienne installation (avec gestion d'erreurs)
    if (fs.existsSync(installDir)) {
      event.sender.send('update-progress', { status: 'cleaning', progress: 20, message: 'Nettoyage...' });
      try {
        // Essayer de supprimer avec rmSync
        fs.rmSync(installDir, { recursive: true, force: true });
      } catch (error) {
        // Si ça échoue, essayer avec rmdirSync (ancienne méthode)
        try {
          const deleteRecursive = (dirPath) => {
            if (fs.existsSync(dirPath)) {
              fs.readdirSync(dirPath).forEach((file) => {
                const curPath = path.join(dirPath, file);
                if (fs.lstatSync(curPath).isDirectory()) {
                  deleteRecursive(curPath);
                } else {
                  fs.unlinkSync(curPath);
                }
              });
              fs.rmdirSync(dirPath);
            }
          };
          deleteRecursive(installDir);
        } catch (err) {
          console.error('[Update] Erreur suppression:', err);
          // Continuer quand même, on écrasera les fichiers
        }
      }
    }

    // Télécharger la nouvelle version
    event.sender.send('update-progress', { status: 'downloading', progress: 30, message: 'Téléchargement...' });
    const zipUrl = `https://github.com/${GITHUB_REPO}/archive/refs/heads/${GITHUB_BRANCH}.zip`;
    
    // Créer le dossier temp s'il n'existe pas
    const tempDir = app.getPath('temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const zipPath = path.join(tempDir, `sroff-update-${Date.now()}.zip`);
    
    try {
      const response = await axios({
        method: 'GET',
        url: zipUrl,
        responseType: 'stream',
        timeout: 120000, // Augmenter le timeout à 2 minutes
        maxRedirects: 5
      });

      const writer = fs.createWriteStream(zipPath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', (err) => {
          // Nettoyer le fichier partiel en cas d'erreur
          try {
            if (fs.existsSync(zipPath)) {
              fs.unlinkSync(zipPath);
            }
          } catch (e) {
            // Ignorer
          }
          reject(err);
        });
      });
    } catch (error) {
      throw new Error('Erreur lors du téléchargement: ' + (error.message || 'Erreur inconnue'));
    }

    // Extraire
    event.sender.send('update-progress', { status: 'extracting', progress: 60, message: 'Extraction...' });
    const extractPath = path.join(tempDir, 'sroff-extract');
    
    // Nettoyer l'ancien dossier d'extraction s'il existe
    if (fs.existsSync(extractPath)) {
      try {
        fs.rmSync(extractPath, { recursive: true, force: true });
      } catch (e) {
        // Ignorer si on ne peut pas supprimer
      }
    }
    
    fs.mkdirSync(extractPath, { recursive: true });

    try {
      await new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
          if (err) {
            // Nettoyer en cas d'erreur
            try {
              if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
              if (fs.existsSync(extractPath)) fs.rmSync(extractPath, { recursive: true, force: true });
            } catch (e) {
              // Ignorer
            }
            return reject(new Error('Erreur ouverture ZIP: ' + err.message));
          }
          
          zipfile.readEntry();
          zipfile.on('entry', (entry) => {
            if (/\/$/.test(entry.fileName)) {
              // Dossier
              const dirPath = path.join(extractPath, entry.fileName);
              try {
                fs.mkdirSync(dirPath, { recursive: true });
              } catch (e) {
                // Ignorer les erreurs de création de dossier
              }
              zipfile.readEntry();
            } else {
              // Fichier
              zipfile.openReadStream(entry, (err, readStream) => {
                if (err) {
                  console.error('[Update] Erreur lecture entrée:', err);
                  zipfile.readEntry(); // Continuer avec la suivante
                  return;
                }
                const filePath = path.join(extractPath, entry.fileName);
                try {
                  fs.mkdirSync(path.dirname(filePath), { recursive: true });
                  const writeStream = fs.createWriteStream(filePath);
                  readStream.pipe(writeStream);
                  writeStream.on('close', () => zipfile.readEntry());
                  writeStream.on('error', (err) => {
                    console.error('[Update] Erreur écriture fichier:', err);
                    zipfile.readEntry(); // Continuer
                  });
                } catch (e) {
                  console.error('[Update] Erreur création fichier:', e);
                  zipfile.readEntry(); // Continuer
                }
              });
            }
          });
          
          zipfile.on('end', resolve);
          zipfile.on('error', (err) => {
            reject(new Error('Erreur extraction ZIP: ' + err.message));
          });
        });
      });
    } catch (error) {
      // Nettoyer en cas d'erreur
      try {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        if (fs.existsSync(extractPath)) fs.rmSync(extractPath, { recursive: true, force: true });
      } catch (e) {
        // Ignorer
      }
      throw new Error('Erreur lors de l\'extraction: ' + (error.message || 'Erreur inconnue'));
    }

    // Déplacer vers le dossier final
    event.sender.send('update-progress', { status: 'installing', progress: 80, message: 'Installation...' });
    const extractedDir = path.join(extractPath, `${GITHUB_REPO.split('/')[1]}-${GITHUB_BRANCH}`);
    
    // Fonction helper pour copier récursivement
    const copyRecursive = (src, dest) => {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          copyRecursive(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    };

    // Créer le dossier parent si nécessaire
    try {
      fs.mkdirSync(path.dirname(installDir), { recursive: true });
    } catch (err) {
      // Si on ne peut pas créer le dossier parent, utiliser le fallback
      if (installDir !== BASE_DIR_FALLBACK) {
        console.log('[Update] Impossible de créer dans Programs, utilisation du fallback');
        const fallbackDir = BASE_DIR_FALLBACK;
        if (fs.existsSync(fallbackDir)) {
          try {
            fs.rmSync(fallbackDir, { recursive: true, force: true });
          } catch (e) {
            // Ignorer les erreurs de suppression
          }
        }
        fs.mkdirSync(path.dirname(fallbackDir), { recursive: true });
        try {
          fs.renameSync(extractedDir, fallbackDir);
          installDir = fallbackDir; // Réassigner la variable
        } catch (e) {
          // Si rename échoue, copier
          copyRecursive(extractedDir, fallbackDir);
          installDir = fallbackDir; // Réassigner la variable
        }
      } else {
        throw err;
      }
    }
    
    // Si le dossier existe encore, essayer de le supprimer
    if (fs.existsSync(installDir)) {
      try {
        fs.rmSync(installDir, { recursive: true, force: true });
      } catch (e) {
        // Si la suppression échoue, essayer de copier par-dessus
        console.log('[Update] Impossible de supprimer, copie par-dessus');
      }
    }
    
    // Déplacer ou copier le dossier extrait
    try {
      if (!fs.existsSync(installDir)) {
        fs.renameSync(extractedDir, installDir);
      } else {
        // Si le dossier existe encore, copier
        copyRecursive(extractedDir, installDir);
      }
    } catch (err) {
      // Si rename échoue, copier récursivement
      copyRecursive(extractedDir, installDir);
    }

    // Nettoyer les fichiers temporaires
    try {
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
    } catch (e) {
      console.error('[Update] Erreur suppression ZIP:', e);
    }
    
    try {
      if (fs.existsSync(extractPath)) {
        fs.rmSync(extractPath, { recursive: true, force: true });
      }
    } catch (e) {
      console.error('[Update] Erreur suppression extract:', e);
      // Ne pas bloquer si on ne peut pas nettoyer
    }

    // Créer les fichiers .env
    event.sender.send('update-progress', { status: 'configuring', progress: 90, message: 'Configuration...' });
    
    const envContent = `# Configuration Firebase

FIREBASE_API_KEY=AIzaSyCfOHNKbsuVR6wwDZGEdtTtmrR048hYzYY
FIREBASE_AUTH_DOMAIN=sroff-crack.firebaseapp.com
FIREBASE_PROJECT_ID=sroff-crack
FIREBASE_STORAGE_BUCKET=sroff-crack.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=332063357062
FIREBASE_APP_ID=1:332063357062:web:5de7e4ae3b86999faa3907

GITHUB_TOKEN=99ftjH9MDsOkHNwiwqXc1J7IjO0isD29kiDT
`;

    // Créer .env à la racine
    const envPath = path.join(installDir, '.env');
    try {
      fs.writeFileSync(envPath, envContent, 'utf-8');
    } catch (err) {
      console.error('[Update] Erreur création .env:', err);
      throw new Error('Impossible de créer le fichier .env: ' + err.message);
    }

    // Créer .env dans test/
    const testEnvPath = path.join(installDir, 'test', '.env');
    try {
      fs.mkdirSync(path.dirname(testEnvPath), { recursive: true });
      fs.writeFileSync(testEnvPath, envContent, 'utf-8');
    } catch (err) {
      console.error('[Update] Erreur création test/.env:', err);
      // Ne pas bloquer si test/ n'existe pas
    }

    // Créer le launcher.vbs
    const vbsPath = path.join(installDir, 'launcher.vbs');
    const baseDirEscaped = installDir.replace(/\\/g, '\\\\');
    const vbsContent = `Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

shell.CurrentDirectory = "${baseDirEscaped}"

npm = shell.ExpandEnvironmentStrings("%ProgramFiles%\\nodejs\\npm.cmd")
If Not fso.FileExists(npm) Then
    npm = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\\nodejs\\npm.cmd")
End If

If fso.FileExists(npm) Then
    ' 0 = fenêtre cachée
    shell.Run Chr(34) & npm & Chr(34) & " start", 0, False
Else
    MsgBox "Node.js n'est pas installé.", vbCritical, "Erreur"
End If
`;
    fs.writeFileSync(vbsPath, vbsContent, 'utf-8');

    // Sauvegarder l'état
    saveInstallationState(latestCommit.sha, latestCommit.date);

    event.sender.send('update-progress', { status: 'completed', progress: 100, message: 'Terminé !' });

    return { success: true };
  } catch (error) {
    console.error('[Update] Erreur mise à jour:', error);
    event.sender.send('update-progress', { status: 'error', progress: 0, message: error.message });
    return { success: false, error: error.message };
  }
});

