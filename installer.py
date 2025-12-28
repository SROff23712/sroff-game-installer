#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import zipfile
import shutil
import urllib.request
from pathlib import Path
import subprocess
import time
import json
from datetime import datetime

# ================== CONFIG ==================
GITHUB_REPO = "SROff23712/sroff-game-installer"
GITHUB_BRANCH = "master"

BASE_DIR = Path(os.path.expanduser("~")) / "AppData" / "Local" / "Programs" / "Sroff Game Installer"
DESKTOP_DIR = Path(os.path.expanduser("~")) / "Desktop"

ENV_URL = "https://download1351.mediafire.com/u55cjj9ve14g5mtqLOhQUsF2TcQagShEW1bhCpP6y0PelXkXXnwRP8L1OojKn8z3kr1rMLlTlI0O8bt0EjSFPZ-bjPT_Ys9rfsq90dyUH-gdxUrBUENyIwh67Haz-91ie_jFNwOnshdvbM88GWlV0Kj9GBK0uwO9rrtbeXrKU74qjdU/fveciqsap0f5k1l/.env"

APP_VERSION_FILE = BASE_DIR.parent / "ash-version-app.json"
UPDATE_SCRIPT_PATH = BASE_DIR.parent / "update.py"
# ============================================

def get_latest_commit_sha(repo, branch):
    try:
        api_url = f"https://api.github.com/repos/{repo}/commits/{branch}"
        req = urllib.request.Request(api_url, headers={"User-Agent": "Sroff-Installer"})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            sha = data["sha"]
            commit_date = datetime.fromisoformat(data["commit"]["committer"]["date"].replace("Z", "+00:00")).timestamp()
            return sha, commit_date
    except Exception as e:
        print(f"❌ Impossible de récupérer le dernier commit : {e}")
        return None, None

def download_github_repo(repo, branch, output_dir, commit_sha):
    zip_url = f"https://github.com/{repo}/archive/{commit_sha}.zip"
    zip_path = output_dir.parent / "repo.zip"
    try:
        output_dir.parent.mkdir(parents=True, exist_ok=True)
        print(f"📥 Téléchargement du repo : {zip_url}")
        urllib.request.urlretrieve(zip_url, zip_path)
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(output_dir.parent)
        extracted_dir = next(output_dir.parent.glob(f"{repo.split('/')[-1]}-*"))
        if output_dir.exists():
            shutil.rmtree(output_dir)
        extracted_dir.rename(output_dir)
        zip_path.unlink()
        print(f"✅ Repo installé : {output_dir}")
        return True
    except Exception as e:
        print(f"❌ Erreur téléchargement repo : {e}")
        return False

def write_app_version_file(commit_sha, commit_date):
    APP_VERSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "installed_sha": commit_sha,
        "install_date": commit_date or time.time(),
        "installation_date": time.time()
    }
    with open(APP_VERSION_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"✅ Fichier ash-version-app.json créé : {APP_VERSION_FILE}")

def download_env(url, dest_path):
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    if not dest_path.exists():
        try:
            print(f"⬇️ Téléchargement .env : {dest_path}")
            urllib.request.urlretrieve(url, dest_path)
            print(f"✅ .env téléchargé : {dest_path}")
        except Exception as e:
            print(f"❌ Erreur téléchargement .env : {e}")
    else:
        print(f"ℹ️ .env déjà existant : {dest_path}")

def find_npm():
    for p in [
        os.path.expandvars(r"%ProgramFiles%\nodejs\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\nodejs\npm.cmd")
    ]:
        if os.path.exists(p):
            return p
    return None

def run_npm_install(base_dir):
    print("📦 npm install...")
    npm = find_npm()
    if not npm:
        print("❌ npm introuvable")
        return False
    return subprocess.run([npm, "install"], cwd=base_dir, shell=True).returncode == 0

def create_desktop_shortcut(target, name, icon):
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
    print(f"✅ Raccourci créé : {shortcut}")

def create_update_script():
    # Même contenu que ton update.py précédent
    content = f'''#!/usr/bin/env python3
import os, sys, json, subprocess, urllib.request, zipfile, shutil, time
from pathlib import Path

BASE_DIR = Path(r"{BASE_DIR}")
APP_VERSION_FILE = BASE_DIR.parent / "ash-version-app.json"
GITHUB_REPO = "{GITHUB_REPO}"
GITHUB_BRANCH = "{GITHUB_BRANCH}"

def get_latest_sha():
    try:
        req = urllib.request.Request(f"https://api.github.com/repos/{{GITHUB_REPO}}/commits/{{GITHUB_BRANCH}}")
        req.add_header("User-Agent", "Sroff-Updater")
        with urllib.request.urlopen(req) as r:
            data = json.load(r)
            return data["sha"]
    except:
        return None

def read_local_sha():
    try:
        with open(APP_VERSION_FILE, "r") as f:
            return json.load(f).get("installed_sha")
    except:
        return None

def download_repo(sha):
    zip_url = f"https://github.com/{{GITHUB_REPO}}/archive/{{sha}}.zip"
    zip_path = BASE_DIR.parent / f"{{GITHUB_REPO.split('/')[-1]}}-{{sha}}.zip"
    urllib.request.urlretrieve(zip_url, zip_path)
    with zipfile.ZipFile(zip_path, "r") as zip_ref:
        zip_ref.extractall(BASE_DIR.parent)
    extracted_dir = BASE_DIR.parent / f"{{GITHUB_REPO.split('/')[-1]}}-{{sha}}"
    if BASE_DIR.exists():
        shutil.rmtree(BASE_DIR)
    extracted_dir.rename(BASE_DIR)
    zip_path.unlink()

def run_npm_start():
    npm_cmds = [
        os.path.expandvars(r"%ProgramFiles%\\nodejs\\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\\nodejs\\npm.cmd")
    ]
    npm = next((c for c in npm_cmds if Path(c).exists()), None)
    if npm:
        subprocess.Popen([npm, "start"], cwd=BASE_DIR, shell=True)

def update_sha_file(latest_sha):
    APP_VERSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(APP_VERSION_FILE, "w") as f:
        json.dump({{"installed_sha": latest_sha, "install_date": time.time(), "installation_date": time.time()}}, f, indent=2)

def main():
    while True:
        local_sha = read_local_sha()
        latest_sha = get_latest_sha()
        if local_sha == latest_sha:
            run_npm_start()
            break
        elif latest_sha:
            download_repo(latest_sha)
            npm = next((c for c in [
                os.path.expandvars(r"%ProgramFiles%\\nodejs\\npm.cmd"),
                os.path.expandvars(r"%ProgramFiles(x86)%\\nodejs\\npm.cmd")
            ] if Path(c).exists()), None)
            if npm:
                subprocess.run([npm, "install"], cwd=BASE_DIR, shell=True)
            update_sha_file(latest_sha)

if __name__ == "__main__":
    main()
'''
    with open(UPDATE_SCRIPT_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"✅ update.py créé : {UPDATE_SCRIPT_PATH}")

# ----------------- MAIN -----------------
def main():
    print("🚀 Début installation Sroff Game Installer")

    sha, ts = get_latest_commit_sha(GITHUB_REPO, GITHUB_BRANCH)
    if not sha:
        print("❌ Impossible de récupérer le SHA du dernier commit. Vérifie ta connexion internet et le repo.")
        sys.exit(1)

    if not download_github_repo(GITHUB_REPO, GITHUB_BRANCH, BASE_DIR, sha):
        print("❌ Échec installation")
        sys.exit(1)

    write_app_version_file(sha, ts)
    download_env(ENV_URL, BASE_DIR / ".env")
    download_env(ENV_URL, BASE_DIR / "test" / ".env")
    run_npm_install(BASE_DIR)
    create_desktop_shortcut(BASE_DIR / "launcher.vbs", "Sroff Game Installer", BASE_DIR / "icon.ico")
    create_update_script()

    print("✅ INSTALLATION TERMINÉE")

if __name__ == "__main__":
    main()
