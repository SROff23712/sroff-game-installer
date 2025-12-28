const { exec } = require('child_process');
const path = require('path');
const util = require('util');

const execPromise = util.promisify(exec);

/**
 * Crée un raccourci Windows (.lnk) sur le bureau
 * @param {string} targetPath - Chemin vers le fichier .exe
 * @param {string} shortcutPath - Chemin où créer le raccourci
 * @param {string} description - Description du raccourci
 */
async function createShortcut(targetPath, shortcutPath, description = '') {
  const fs = require('fs');
  
  try {
    // Vérifier que le fichier cible existe
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Le fichier cible n'existe pas: ${targetPath}`);
    }
    
    // Vérifier que le dossier du bureau existe
    const desktopDir = path.dirname(shortcutPath);
    if (!fs.existsSync(desktopDir)) {
      throw new Error(`Le dossier du bureau n'existe pas: ${desktopDir}`);
    }
    
    // Utiliser une approche plus robuste : créer un fichier PowerShell temporaire
    // Cela évite les problèmes d'échappement de caractères
    const tempScriptPath = path.join(require('os').tmpdir(), `create_shortcut_${Date.now()}.ps1`);
    const displayName = description || path.basename(shortcutPath, '.lnk');
    
    // Fonction pour échapper les caractères spéciaux pour PowerShell
    function escapeForPowerShell(str) {
      // Échapper les guillemets doubles et les backticks
      return str.replace(/"/g, '`"').replace(/\$/g, '`$');
    }
    
    // Créer le script PowerShell avec les chemins directement insérés
    // Utiliser des guillemets doubles pour préserver les caractères spéciaux
    const script = `$WshShell = New-Object -ComObject WScript.Shell
$ShortcutPath = "${escapeForPowerShell(shortcutPath)}"
$TargetPath = "${escapeForPowerShell(targetPath)}"
$WorkingDir = "${escapeForPowerShell(path.dirname(targetPath))}"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetPath
$Shortcut.WorkingDirectory = $WorkingDir
$Shortcut.Description = "${escapeForPowerShell(displayName)}"
$Shortcut.Save()
if (Test-Path $ShortcutPath) {
  Write-Output "SUCCESS"
} else {
  Write-Output "FAILED"
}`;

    // Écrire le script dans un fichier temporaire avec encodage UTF-8 BOM
    // Cela permet à PowerShell de lire correctement les caractères spéciaux comme les apostrophes
    const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
    fs.writeFileSync(tempScriptPath, BOM + Buffer.from(script, 'utf8'));
    
    try {
      // Exécuter le script PowerShell
      const result = await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempScriptPath}"`);
      
      // Vérifier le résultat
      if (result.stdout && result.stdout.includes('FAILED')) {
        throw new Error('Le script PowerShell a échoué');
      }
      
      // Attendre un peu pour que le fichier soit écrit
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Vérifier que le raccourci a bien été créé
      if (!fs.existsSync(shortcutPath)) {
        // Essayer avec le chemin normalisé
        if (!fs.existsSync(normalizedShortcut)) {
          throw new Error(`Le raccourci n'a pas été créé: ${shortcutPath}`);
        }
      }
      
      console.log(`✅ Raccourci créé avec succès: ${shortcutPath} -> ${targetPath} (Nom: ${displayName})`);
      return true;
    } finally {
      // Supprimer le fichier temporaire
      try {
        if (fs.existsSync(tempScriptPath)) {
          fs.unlinkSync(tempScriptPath);
        }
      } catch (e) {
        // Ignorer les erreurs de suppression
      }
    }
  } catch (error) {
    console.error('❌ Erreur création raccourci:', error.message);
    if (error.stdout) console.error('Stdout:', error.stdout);
    if (error.stderr) console.error('Stderr:', error.stderr);
    throw error;
  }
}

module.exports = { createShortcut };

