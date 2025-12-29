#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Script de mise à jour automatique pour Sroff Game Installer
Vérifie s'il y a eu de nouveaux commits depuis la dernière installation
et réinstalle si nécessaire
"""

import os
import sys
import json
import zipfile
import shutil
import urllib.request
from pathlib import Path
import subprocess
import time
from datetime import datetime

# ================== CONFIG ==================

GITHUB_REPO = "SROff23712/sroff-game-installer"
GITHUB_BRANCH = "main"

BASE_DIR = Path(os.path.expanduser("~")) / "AppData" / "Local" / "Programs" / "Sroff Game Installer"
DESKTOP_DIR = Path(os.path.expanduser("~")) / "Desktop"
STATE_FILE = BASE_DIR.parent / "sroff-installer-state.json"

ENV_CONTENT = """# Configuration Firebase

FIREBASE_API_KEY=AIzaSyCfOHNKbsuVR6wwDZGEdtTtmrR048hYzYY
FIREBASE_AUTH_DOMAIN=sroff-crack.firebaseapp.com
FIREBASE_PROJECT_ID=sroff-crack
FIREBASE_STORAGE_BUCKET=sroff-crack.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=332063357062
FIREBASE_APP_ID=1:332063357062:web:5de7e4ae3b86999faa3907

GITHUB_TOKEN=99ftjH9MDsOkHNwiwqXc1J7IjO0isD29kiDT
"""

# ============================================

def get_latest_commit_date(repo, branch):
    """Récupère la date du dernier commit depuis GitHub API"""
    try:
        api_url = f"https://api.github.com/repos/{repo}/commits/{branch}"
        req = urllib.request.Request(api_url)
        req.add_header('User-Agent', 'Sroff-Updater')
        
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            commit_date = data['commit']['committer']['date']
            commit_sha = data['sha']
            
            # Convertir en timestamp
            dt = datetime.fromisoformat(commit_date.replace('Z', '+00:00'))
            return dt.timestamp(), commit_sha
    except Exception as e:
        print(f"⚠️ Erreur lors de la récupération du dernier commit : {e}")
        return None, None


def load_installation_state():
    """Charge l'état de la dernière installation"""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠️ Erreur lecture état : {e}")
    return None


def save_installation_state(commit_sha, commit_date):
    """Sauvegarde l'état de l'installation"""
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        state = {
            'last_commit_sha': commit_sha,
            'last_commit_date': commit_date,
            'installation_date': time.time()
        }
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, indent=2)
        print(f"✅ État sauvegardé : {STATE_FILE}")
    except Exception as e:
        print(f"⚠️ Erreur sauvegarde état : {e}")


def download_github_repo(repo, branch, output_dir):
    """Télécharge et extrait le dépôt GitHub"""
    print(f"📥 Téléchargement du dépôt {repo}...")

    zip_url = f"https://github.com/{repo}/archive/refs/heads/{branch}.zip?ts={int(time.time())}"
    zip_path = output_dir.parent / f"{repo.split('/')[-1]}-{branch}.zip"

    try:
        output_dir.parent.mkdir(parents=True, exist_ok=True)

        urllib.request.urlretrieve(zip_url, zip_path)

        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(output_dir.parent)

        extracted_dir = output_dir.parent / f"{repo.split('/')[-1]}-{branch}"

        if output_dir.exists():
            shutil.rmtree(output_dir)

        extracted_dir.rename(output_dir)
        zip_path.unlink()

        print(f"✅ Dépôt installé dans : {output_dir}")
        return True

    except Exception as e:
        print(f"❌ Erreur téléchargement : {e}")
        return False


def create_env(path):
    """Crée le fichier .env"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(ENV_CONTENT)
    print(f"✅ .env créé : {path}")


def find_npm():
    """Trouve npm sur Windows"""
    paths = [
        os.path.expandvars(r"%ProgramFiles%\nodejs\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\nodejs\npm.cmd")
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    return None


def run_npm_install(base_dir):
    """Exécute npm install"""
    print("\n📦 Installation des dépendances (npm install)...")

    npm = find_npm()
    if not npm:
        print("❌ npm introuvable. Installe Node.js avant de lancer l'app.")
        return False

    try:
        process = subprocess.run(
            [npm, "install"],
            cwd=base_dir,
            shell=True
        )

        if process.returncode == 0:
            print("✅ npm install terminé avec succès")
            return True
        else:
            print("❌ Erreur pendant npm install")
            return False

    except Exception as e:
        print(f"❌ Erreur npm install : {e}")
        return False


def create_launcher_vbs(base_dir):
    """Crée le launcher VBS"""
    vbs_path = base_dir / "launcher.vbs"
    icon_path = base_dir / "icon.ico"
    base_dir_escaped = str(base_dir).replace("\\", "\\\\")

    content = f"""Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

shell.CurrentDirectory = "{base_dir_escaped}"

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
"""

    with open(vbs_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"✅ launcher.vbs créé : {vbs_path}")
    return vbs_path, icon_path


def create_desktop_shortcut(target, name, icon):
    """Crée un raccourci sur le bureau"""
    shortcut = DESKTOP_DIR / f"{name}.lnk"

    ps = f"""
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("{shortcut}")
$Shortcut.TargetPath = "{target}"
$Shortcut.WorkingDirectory = "{target.parent}"
$Shortcut.IconLocation = "{icon}"
$Shortcut.Save()
"""

    subprocess.run(["powershell", "-Command", ps], capture_output=True)
    print("✅ Raccourci créé sur le bureau")


def check_and_update():
    """Vérifie et met à jour si nécessaire"""
    print("=" * 60)
    print("🔄 Vérification des mises à jour")
    print("=" * 60)

    # Récupérer le dernier commit
    latest_timestamp, latest_sha = get_latest_commit_date(GITHUB_REPO, GITHUB_BRANCH)
    if not latest_timestamp or not latest_sha:
        print("❌ Impossible de vérifier les mises à jour")
        return False

    print(f"📅 Dernier commit GitHub : {datetime.fromtimestamp(latest_timestamp).strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"🔑 SHA : {latest_sha[:8]}...")

    # Charger l'état de l'installation
    state = load_installation_state()
    
    if state and state.get('last_commit_sha') == latest_sha:
        print("\n✅ L'application est à jour !")
        print(f"📅 Dernière installation : {datetime.fromtimestamp(state.get('installation_date', 0)).strftime('%Y-%m-%d %H:%M:%S')}")
        return False

    if state:
        print(f"\n📅 Dernière installation : {datetime.fromtimestamp(state.get('installation_date', 0)).strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"🔑 SHA installé : {state.get('last_commit_sha', 'N/A')[:8]}...")
        print("\n🆕 Nouvelle version détectée !")
    else:
        print("\n📦 Première installation détectée")

    # Supprimer l'ancienne installation
    if BASE_DIR.exists():
        print(f"\n🗑️ Suppression de l'ancienne installation : {BASE_DIR}")
        try:
            shutil.rmtree(BASE_DIR)
            print("✅ Ancienne installation supprimée")
        except Exception as e:
            print(f"⚠️ Erreur lors de la suppression : {e}")
            print("⚠️ Tentative de réinstallation quand même...")

    # Réinstaller
    print("\n📥 Installation de la nouvelle version...")
    if not download_github_repo(GITHUB_REPO, GITHUB_BRANCH, BASE_DIR):
        return False

    print("\n📝 Création des fichiers .env...")
    create_env(BASE_DIR / ".env")
    create_env(BASE_DIR / "test" / ".env")

    if not run_npm_install(BASE_DIR):
        print("⚠️ Installation terminée MAIS sans dépendances npm")
        print("👉 Lance npm install manuellement si besoin")

    print("\n🔧 Création du launcher...")
    vbs_path, icon_path = create_launcher_vbs(BASE_DIR)

    print("\n🔗 Création du raccourci...")
    create_desktop_shortcut(vbs_path, "Sroff Game Installer", icon_path)

    # Sauvegarder l'état
    save_installation_state(latest_sha, latest_timestamp)

    print("\n" + "=" * 60)
    print("✅ MISE À JOUR TERMINÉE")
    print(f"📁 Dossier : {BASE_DIR}")
    print("=" * 60)

    return True


if __name__ == "__main__":
    try:
        sys.exit(0 if check_and_update() else 0)  # Retourne 0 dans tous les cas (à jour ou mis à jour)
    except KeyboardInterrupt:
        print("\n❌ Mise à jour annulée")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Erreur : {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

