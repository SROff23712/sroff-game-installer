#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import zipfile
import shutil
import urllib.request
import subprocess
import time
import json
from pathlib import Path
from datetime import datetime

# ================= CONFIG =================

BASE_DIR = Path.home() / "AppData" / "Local" / "Programs" / "Sroff Game Installer"
DESKTOP_DIR = Path.home() / "Desktop"

ENV_URL = "https://download1351.mediafire.com/u55cjj9ve14g5mtqLOhQUsF2TcQagShEW1bhCpP6y0PelXkXXnwRP8L1OojKn8z3kr1rMLlTlI0O8bt0EjSFPZ-bjPT_Ys9rfsq90dyUH-gdxUrBUENyIwh67Haz-91ie_jFNwOnshdvbM88GWlV0Kj9GBK0uwO9rrtbeXrKU74qjdU/fveciqsap0f5k1l/.env"

GITHUB_REPO = "SROff23712/sroff-game-installer"
GITHUB_BRANCH = "master"

APP_VERSION_FILE = BASE_DIR / "ash-version-app.json"

SCRIPTS_DIR = BASE_DIR.parent
UPDATE_SCRIPT_PATH = SCRIPTS_DIR / "update.py"
VERSION_SCRIPT_PATH = SCRIPTS_DIR / "version.py"

# ================= UTILS =================

def find_npm():
    for p in [
        os.path.expandvars(r"%ProgramFiles%\nodejs\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\nodejs\npm.cmd")
    ]:
        if Path(p).exists():
            return p
    return None

# ================= GITHUB =================

def get_latest_commit_sha(repo, branch):
    try:
        url = f"https://api.github.com/repos/{repo}/commits/{branch}"
        req = urllib.request.Request(url, headers={"User-Agent": "Sroff-Installer"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.load(r)
            sha = data["sha"]
            ts = datetime.fromisoformat(
                data["commit"]["committer"]["date"].replace("Z", "+00:00")
            ).timestamp()
            return sha, ts
    except Exception as e:
        print("❌ Erreur GitHub :", e)
        return None, None

def download_repo(repo, sha, output_dir):
    zip_url = f"https://github.com/{repo}/archive/{sha}.zip"
    zip_path = output_dir.parent / "repo.zip"

    try:
        print("📥 Téléchargement du repo...")
        output_dir.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(zip_url, zip_path)

        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(output_dir.parent)

        extracted = next(output_dir.parent.glob(f"{repo.split('/')[-1]}-*"))
        if output_dir.exists():
            shutil.rmtree(output_dir)
        extracted.rename(output_dir)

        zip_path.unlink()
        print("✅ Repo installé :", output_dir)
        return True
    except Exception as e:
        print("❌ Erreur repo :", e)
        return False

# ================= FILES =================

def write_version_file(sha, ts):
    APP_VERSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(APP_VERSION_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "installed_sha": sha,
            "install_date": ts,
            "installation_date": time.time()
        }, f, indent=2)
    print("✅ SHA enregistré")

def download_env(dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        print("⬇️ Téléchargement .env :", dest)
        urllib.request.urlretrieve(ENV_URL, dest)

def run_npm_install():
    npm = find_npm()
    if not npm:
        print("❌ npm introuvable")
        return
    print("📦 npm install...")
    subprocess.run([npm, "install"], cwd=BASE_DIR, shell=True)

# ================= SHORTCUT =================

def create_desktop_shortcut():
    shortcut = DESKTOP_DIR / "Sroff Game Installer.lnk"
    ps = f'''
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("{shortcut}")
$Shortcut.TargetPath = "{UPDATE_SCRIPT_PATH}"
$Shortcut.WorkingDirectory = "{SCRIPTS_DIR}"
$Shortcut.IconLocation = "{BASE_DIR / 'icon.ico'}"
$Shortcut.Save()
'''
    subprocess.run(["powershell", "-Command", ps], capture_output=True)
    print("✅ Raccourci bureau créé")

# ================= VERSION.PY =================

def create_version_script():
    content = f'''#!/usr/bin/env python3
import os, subprocess, urllib.request
from pathlib import Path

BASE_DIR = Path.home() / "AppData" / "Local" / "Programs" / "Sroff Game Installer"
ENV_URL = r"{ENV_URL}"

def download_env(dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        urllib.request.urlretrieve(ENV_URL, dest)

def find_npm():
    for p in [
        os.path.expandvars(r"%ProgramFiles%\\\\nodejs\\\\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\\\\nodejs\\\\npm.cmd")
    ]:
        if Path(p).exists():
            return p
    return None

def main():
    download_env(BASE_DIR / ".env")
    download_env(BASE_DIR / "test/.env")
    npm = find_npm()
    if npm:
        subprocess.run([npm, "install"], cwd=BASE_DIR, shell=True)
        subprocess.Popen([npm, "start"], cwd=BASE_DIR, shell=True)

if __name__ == "__main__":
    main()
'''
    with open(VERSION_SCRIPT_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print("✅ version.py créé")

# ================= UPDATE.PY =================

def create_update_script():
    content = f'''#!/usr/bin/env python3
import os, json, subprocess, urllib.request
from pathlib import Path

BASE_DIR = Path.home() / "AppData" / "Local" / "Programs" / "Sroff Game Installer"
APP_VERSION_FILE = BASE_DIR / "ash-version-app.json"
VERSION_SCRIPT = BASE_DIR.parent / "version.py"

def read_sha():
    try:
        with open(APP_VERSION_FILE, "r", encoding="utf-8") as f:
            return json.load(f).get("installed_sha")
    except:
        return None

def get_latest_sha():
    req = urllib.request.Request(
        "https://api.github.com/repos/SROff23712/sroff-game-installer/commits/master",
        headers={{"User-Agent": "Sroff-Updater"}}
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)["sha"]

def find_npm():
    for p in [
        os.path.expandvars(r"%ProgramFiles%\\\\nodejs\\\\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\\\\nodejs\\\\npm.cmd")
    ]:
        if Path(p).exists():
            return p
    return None

def main():
    if read_sha() == get_latest_sha():
        npm = find_npm()
        if npm:
            subprocess.Popen([npm, "start"], cwd=BASE_DIR, shell=True)
    else:
        subprocess.Popen(["cmd", "/k", "python", str(VERSION_SCRIPT)], shell=True)

if __name__ == "__main__":
    main()
'''
    with open(UPDATE_SCRIPT_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print("✅ update.py créé")

# ================= MAIN =================

def main():
    print("🚀 Début installation")

    sha, ts = get_latest_commit_sha(GITHUB_REPO, GITHUB_BRANCH)
    if not sha:
        sys.exit(1)

    if not download_repo(GITHUB_REPO, sha, BASE_DIR):
        sys.exit(1)

    write_version_file(sha, ts)
    download_env(BASE_DIR / ".env")
    download_env(BASE_DIR / "test/.env")
    run_npm_install()
    create_version_script()
    create_update_script()
    create_desktop_shortcut()

    print("🎉 INSTALLATION TERMINÉE")

if __name__ == "__main__":
    main()
