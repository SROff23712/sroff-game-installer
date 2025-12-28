#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import json
import subprocess
import urllib.request
from pathlib import Path
import time

# ================== CONFIG ==================
GITHUB_REPO = "SROff23712/sroff-game-installer"
GITHUB_BRANCH = "master"

BASE_DIR = Path(os.path.expanduser("~")) / "AppData" / "Local" / "Programs" / "Sroff Game Installer"
APP_VERSION_FILE = BASE_DIR.parent / "ash-version-app.json"
DESKTOP_DIR = Path(os.path.expanduser("~")) / "Desktop"
# ============================================

# ----------------- Charger le TOKEN depuis .env -----------------
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            if "=" in line:
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v)
TOKEN = os.getenv("TOKEN")

# ----------------- Fonctions -----------------
def get_latest_commit_sha(repo, branch):
    """Récupère le dernier SHA d’un commit via l’API GitHub"""
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
    """Lance npm start"""
    npm_cmds = [
        os.path.expandvars(r"%ProgramFiles%\nodejs\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\nodejs\npm.cmd")
    ]
    npm = next((cmd for cmd in npm_cmds if Path(cmd).exists()), None)
    if not npm:
        print("❌ npm introuvable. Installe Node.js avant de lancer l'app.")
        return
    subprocess.Popen([npm, "start"], cwd=base_dir, shell=True)

def create_update_script(latest_sha):
    """Crée update.py dans AppData\Local\Programs"""
    update_path = BASE_DIR.parent / "update.py"
    content = f'''#!/usr/bin/env python3
import os, sys, shutil, subprocess, zipfile, urllib.request, json, time
from pathlib import Path

BASE_DIR = Path(r"{BASE_DIR}")
DESKTOP_DIR = Path(r"{DESKTOP_DIR}")
APP_VERSION_FILE = BASE_DIR.parent / "ash-version-app.json"
GITHUB_REPO = "{GITHUB_REPO}"
GITHUB_BRANCH = "{GITHUB_BRANCH}"
LATEST_SHA = "{latest_sha}"

def download_github():
    target = LATEST_SHA
    zip_url = f"https://github.com/{{GITHUB_REPO}}/archive/{{target}}.zip"
    zip_path = BASE_DIR.parent / f"{{GITHUB_REPO.split('/')[-1]}}-{{target}}.zip"
    try:
        urllib.request.urlretrieve(zip_url, zip_path)
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(BASE_DIR.parent)
        extracted_dir = BASE_DIR.parent / f"{{GITHUB_REPO.split('/')[-1]}}-{{target}}"
        time.sleep(1)
        if BASE_DIR.exists():
            shutil.rmtree(BASE_DIR)
        extracted_dir.rename(BASE_DIR)
        zip_path.unlink()
        return True
    except Exception as e:
        print("❌ Erreur téléchargement:", e)
        return False

def run_npm_install():
    npm_cmds = [
        os.path.expandvars(r"%ProgramFiles%\\nodejs\\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\\nodejs\\npm.cmd")
    ]
    npm = next((cmd for cmd in npm_cmds if Path(cmd).exists()), None)
    if not npm:
        print("❌ npm introuvable.")
        return False
    process = subprocess.run([npm, "install"], cwd=BASE_DIR, shell=True)
    return process.returncode == 0

def create_shortcut():
    vbs_path = BASE_DIR / "launcher.vbs"
    icon_path = BASE_DIR / "icon.ico"
    shortcut = DESKTOP_DIR / "Sroff Game Installer.lnk"
    ps = f"""
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('{{shortcut}}')
$Shortcut.TargetPath = '{{vbs_path}}'
$Shortcut.WorkingDirectory = '{{vbs_path.parent}}'
$Shortcut.IconLocation = '{{icon_path}}'
$Shortcut.Save()
"""
    subprocess.run(["powershell", "-Command", ps], capture_output=True)

def update_sha_file():
    APP_VERSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {{
        'installed_sha': LATEST_SHA,
        'install_date': time.time(),
        'installation_date': time.time()
    }}
    with open(APP_VERSION_FILE, 'w', encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

def launch_vbs():
    vbs_path = BASE_DIR / "launcher.vbs"
    subprocess.Popen(["cscript", str(vbs_path)], shell=True)

def self_delete():
    try:
        Path(__file__).unlink()
    except: pass

if download_github():
    run_npm_install()
    create_shortcut()
    update_sha_file()
    launch_vbs()
    self_delete()
'''
    with open(update_path, "w", encoding="utf-8") as f:
        f.write(content)

    # Création du BAT pour lancer update.py
    bat_path = BASE_DIR.parent / "update.bat"
    bat_content = f'''@echo off
python "{update_path}"
'''
    with open(bat_path, "w", encoding="utf-8") as f:
        f.write(bat_content)

    return bat_path

# ----------------- Main -----------------
def main():
    local_sha = read_local_sha()
    latest_sha = get_latest_commit_sha(GITHUB_REPO, GITHUB_BRANCH)
    if not latest_sha:
        print("⚠️ Impossible de récupérer le dernier commit.")
        return
    if local_sha == latest_sha:
        print("✅ Application à jour, lancement...")
        run_npm_start(BASE_DIR)
    else:
        print("⬆️ Nouvelle version détectée, mise à jour en cours...")
        bat_path = create_update_script(latest_sha)
        # Lancer le BAT qui lui lance update.py
        subprocess.Popen(f'cmd /c "{bat_path}"', shell=True)
        # Quitter pour libérer BASE_DIR
        sys.exit(0)

if __name__ == "__main__":
    main()
