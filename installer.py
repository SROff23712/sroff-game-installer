#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Script d'installation pour Sroff Game Installer
- Télécharge le repo GitHub
- Télécharge le .env depuis MediaFire
- npm install automatique
- raccourci bureau via VBS
"""

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

# ============================================

def download_github_repo(repo, branch, output_dir, commit_sha=None):
    target = commit_sha or branch
    print(f"📥 Téléchargement du dépôt {repo}...")

    zip_url = (
        f"https://github.com/{repo}/archive/{commit_sha}.zip"
        if commit_sha
        else f"https://github.com/{repo}/archive/refs/heads/{branch}.zip"
    )

    zip_path = output_dir.parent / "repo.zip"

    try:
        output_dir.parent.mkdir(parents=True, exist_ok=True)
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


def get_latest_commit_date(repo, branch):
    try:
        api_url = f"https://api.github.com/repos/{repo}/commits/{branch}"
        req = urllib.request.Request(api_url, headers={"User-Agent": "Sroff-Installer"})

        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            dt = datetime.fromisoformat(data["commit"]["committer"]["date"].replace("Z", "+00:00"))
            return dt.timestamp(), data["sha"]
    except:
        return None, None


def write_app_version_file(commit_sha, commit_date):
    APP_VERSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(APP_VERSION_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "installed_sha": commit_sha,
            "install_date": commit_date,
            "installation_date": time.time()
        }, f, indent=2)


def download_env(url, dest_path):
    try:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(url, dest_path)
        print(f"✅ .env téléchargé : {dest_path}")
        return True
    except Exception as e:
        print(f"❌ Erreur téléchargement .env : {e}")
        return False


def find_npm():
    for p in [
        os.path.expandvars(r"%ProgramFiles%\nodejs\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\nodejs\npm.cmd")
    ]:
        if os.path.exists(p):
            return p
    return None


def run_npm_install(base_dir):
    print("\n📦 npm install...")
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


def main():
    print("=" * 60)
    print("🚀 Installation Sroff Game Installer")
    print("=" * 60)

    ts, sha = get_latest_commit_date(GITHUB_REPO, GITHUB_BRANCH)

    if not download_github_repo(GITHUB_REPO, GITHUB_BRANCH, BASE_DIR, sha):
        return False

    if sha:
        write_app_version_file(sha, ts)

    print("\n📝 Téléchargement des fichiers .env...")
    download_env(ENV_URL, BASE_DIR / ".env")
    download_env(ENV_URL, BASE_DIR / "test" / ".env")

    run_npm_install(BASE_DIR)

    print("\n🔗 Création raccourci bureau...")
    create_desktop_shortcut(
        BASE_DIR / "launcher.vbs",
        "Sroff Game Installer",
        BASE_DIR / "icon.ico"
    )

    print("\n✅ INSTALLATION TERMINÉE")
    return True


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
