#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import json
import subprocess
import urllib.request
import zipfile
import shutil
import time
from pathlib import Path

# ================== CONFIG ==================
GITHUB_REPO = "SROff23712/sroff-game-installer"
GITHUB_BRANCH = "master"

BASE_DIR = Path(os.path.expanduser("~")) / "AppData" / "Local" / "Programs" / "Sroff Game Installer"
APP_VERSION_FILE = BASE_DIR.parent / "ash-version-app.json"
DESKTOP_DIR = Path(os.path.expanduser("~")) / "Desktop"
# ============================================

# Charger le TOKEN depuis .env si présent
env_path = BASE_DIR / ".env"
if env_path.exists():
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v)
TOKEN = os.getenv("TOKEN")

# ----------------- Fonctions -----------------
def get_latest_commit_sha(repo, branch):
    """Récupère le dernier SHA via l'API GitHub"""
    try:
        api_url = f"https://api.github.com/repos/{repo}/commits/{branch}"
        req = urllib.request.Request(api_url)
        req.add_header("User-Agent", "Sroff-Updater")
        if TOKEN:
            req.add_header("Authorization", f"token {TOKEN}")
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            return data["sha"]
    except Exception as e:
        print(f"⚠️ Erreur récupération dernier commit : {e}")
        return None

def read_local_sha():
    try:
        with open(APP_VERSION_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("installed_sha")
    except:
        return None

def run_npm_start(base_dir):
    npm_cmds = [
        os.path.expandvars(r"%ProgramFiles%\nodejs\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\nodejs\npm.cmd")
    ]
    npm = next((cmd for cmd in npm_cmds if Path(cmd).exists()), None)
    if not npm:
        print("❌ npm introuvable. Installe Node.js avant de lancer l'app.")
        return
    print("▶️ Lancement de l'application...")
    subprocess.Popen([npm, "start"], cwd=base_dir, shell=True)

def download_and_replace_repo(latest_sha):
    zip_url = f"https://github.com/{GITHUB_REPO}/archive/{latest_sha}.zip"
    zip_path = BASE_DIR.parent / f"{GITHUB_REPO.split('/')[-1]}-{latest_sha}.zip"

    try:
        print("⬇️ Téléchargement de la nouvelle version...")
        urllib.request.urlretrieve(zip_url, zip_path)

        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(BASE_DIR.parent)

        extracted_dir = BASE_DIR.parent / f"{GITHUB_REPO.split('/')[-1]}-{latest_sha}"

        if BASE_DIR.exists():
            shutil.rmtree(BASE_DIR)
        extracted_dir.rename(BASE_DIR)
        zip_path.unlink()
        print("✅ Mise à jour téléchargée et installée")
        return True
    except Exception as e:
        print("❌ Erreur mise à jour :", e)
        return False

def run_npm_install():
    npm_cmds = [
        os.path.expandvars(r"%ProgramFiles%\nodejs\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\nodejs\npm.cmd")
    ]
    npm = next((cmd for cmd in npm_cmds if Path(cmd).exists()), None)
    if not npm:
        print("❌ npm introuvable.")
        return False
    print("📦 Installation des dépendances...")
    process = subprocess.run([npm, "install"], cwd=BASE_DIR, shell=True)
    return process.returncode == 0

def create_shortcut():
    vbs_path = BASE_DIR / "launcher.vbs"
    icon_path = BASE_DIR / "icon.ico"
    shortcut = DESKTOP_DIR / "Sroff Game Installer.lnk"
    ps = f"""
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("{shortcut}")
$Shortcut.TargetPath = "{vbs_path}"
$Shortcut.WorkingDirectory = "{vbs_path.parent}"
$Shortcut.IconLocation = "{icon_path}"
$Shortcut.Save()
"""
    subprocess.run(["powershell", "-Command", ps], capture_output=True)

def update_sha_file(latest_sha):
    APP_VERSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'installed_sha': latest_sha,
        'install_date': time.time(),
        'installation_date': time.time()
    }
    with open(APP_VERSION_FILE, 'w', encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

# ----------------- Main -----------------
def main():
    while True:
        local_sha = read_local_sha()
        latest_sha = get_latest_commit_sha(GITHUB_REPO, GITHUB_BRANCH)
        if not latest_sha:
            print("⚠️ Impossible de récupérer le dernier commit. Nouvel essai dans 30s...")
            time.sleep(30)
            continue

        if local_sha == latest_sha:
            print("✅ Application à jour")
            run_npm_start(BASE_DIR)
            break
        else:
            print("⬆️ Nouvelle version détectée, mise à jour en cours...")
            if download_and_replace_repo(latest_sha):
                if run_npm_install():
                    create_shortcut()
                    update_sha_file(latest_sha)
                else:
                    print("❌ Échec npm install")
                    time.sleep(10)
            else:
                print("❌ Échec téléchargement")
                time.sleep(10)

if __name__ == "__main__":
    main()
