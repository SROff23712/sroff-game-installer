// Fichier de configuration pour l'application
// Vous pouvez modifier ces valeurs selon vos besoins

const path = require('path');
const fs = require('fs');

// Charger les variables d'environnement du projet parent si disponibles
try {
  const parentEnv = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(parentEnv)) {
    require('dotenv').config({ path: parentEnv });
  }
} catch (e) {
  // Ignorer si le fichier n'existe pas
}

const os = require('os');

module.exports = {
  // Dossier d'installation des jeux
  GAMES_DIR: process.env.GAMES_DIR || 'C:\\sroff-game',
  
  // Configuration GitHub
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  GAMES_URL: process.env.GAMES_URL || 'https://raw.githubusercontent.com/pipionkakiandpipi/frostapppppp/refs/heads/main/games.json',
  
  // Chemin vers le fichier local de jeux (fallback)
  LOCAL_GAMES_PATH: process.env.LOCAL_GAMES_PATH || path.join(__dirname, 'test', 'games_updated.json')
};

