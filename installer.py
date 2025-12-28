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

BASE_PROGRAMS = Path.home() / "AppData" / "Local" / "Programs"
BASE_DIR = BASE_PROGRAMS / "Sroff Game Installer"
SCRIPTS_DIR = BASE_PROGRAMS

DESKTOP_DIR = Path.home() / "Desktop"

ENV_URL = "https://download1351.mediafire.com/u55cjj9ve14g5mtqLOhQUsF2TcQagShEW1bhCpP6y0PelXkXXnwRP8L1OojKn8z3kr1rMLlTlI0O8bt0EjSFPZ-bjPT_Ys9rfsq90dyUH-gdxUrBUENyIwh67Haz-91ie_jFNwOnshdvbM88GWlV0Kj9GBK0uwO9rrtbeXrKU74qjdU/fveciqsap0f5k1l/.env"

GITHUB_REPO = "SROff23712/sroff-game-installer"
GITHUB_BRANCH = "master"

APP_VERSION_FILE = BASE_DIR / "ash-version-app.json"
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

def get_latest_commit():
    url = f"https://api.github.com/repos/{GITHUB_REPO}/commits/{GITHUB_BRANCH}"
    req = urllib.request.Request(url, headers={"User-Agent": "Sroff-Installer"})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.load(r)
        sha = data["sha"]
        ts = datetime.fromisoformat(
            data["commit"]["committer"]["date"].replace("Z", "+00:00")
        ).timestamp()
        return sha, ts

def download_repo(sha):
    zip_url = f"https://github.com/{GITHUB_REPO}/archive/{sha}.zip"
    zip_path = BASE_PROGRAMS / "repo.zip"

    BASE_PROGRAMS.mkdir(parents=True, exist_ok=True)

    if BASE_DIR.exists():
        shutil.rmtree(BASE_DIR)

    print("📥 Téléchargement du repo...")
    urllib.request.urlretrieve(zip_url, zip_path)

    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(BASE_PROGRAMS)

    extracted = next(BASE_PROGRAMS.glob("sroff-game-installer-*"))
    extracted.rename(BASE_DIR)

    zip_path.unlink()
    print("✅ Repo installé")

# ================= FILES =================

def write_version_file(sha, ts):
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    with open(APP_VERSION_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "installed_sha": sha,
            "install_date": ts,
            "updated_at": time.time()
        }, f, indent=2)
    print("✅ SHA enregistré")

def download_env(dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        urllib.request.urlretrieve(ENV_URL, dest)

def run_npm_install():
    npm = find_npm()
    if npm:
        print("📦 npm install...")
        subprocess.run([npm, "install"], cwd=BASE_DIR, shell=True)

# ================= SCRIPTS =================

def create_version_script():
    content = f'''#!/usr/bin/env python3
import os, shutil, zipfile, urllib.request, subprocess, json, time
from pathlib import Path
from datetime import datetime

BASE_PROGRAMS = Path.home() / "AppData" / "Local" / "Programs"
BASE_DIR = BASE_PROGRAMS / "Sroff Game Installer"
ENV_URL = r"{ENV_URL}"
REPO = "{GITHUB_REPO}"
BRANCH = "{GITHUB_BRANCH}"
APP_VERSION_FILE = BASE_DIR / "ash-version-app.json"

def find_npm():
    for p in [
        os.path.expandvars(r"%ProgramFiles%\\\\nodejs\\\\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\\\\nodejs\\\\npm.cmd")
    ]:
        if Path(p).exists():
            return p
    return None

def get_latest_commit():
    url = f"https://api.github.com/repos/{{REPO}}/commits/{{BRANCH}}"
    req = urllib.request.Request(url, headers={{"User-Agent": "Sroff-Updater"}})
    with urllib.request.urlopen(req) as r:
        data = json.load(r)
        sha = data["sha"]
        ts = datetime.fromisoformat(
            data["commit"]["committer"]["date"].replace("Z", "+00:00")
        ).timestamp()
        return sha, ts

def main():
    sha, ts = get_latest_commit()

    if BASE_DIR.exists():
        shutil.rmtree(BASE_DIR)

    zip_url = f"https://github.com/{{REPO}}/archive/{{sha}}.zip"
    zip_path = BASE_PROGRAMS / "repo.zip"

    urllib.request.urlretrieve(zip_url, zip_path)
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(BASE_PROGRAMS)

    extracted = next(BASE_PROGRAMS.glob("sroff-game-installer-*"))
    extracted.rename(BASE_DIR)
    zip_path.unlink()

    for p in [BASE_DIR / ".env", BASE_DIR / "test/.env"]:
        p.parent.mkdir(parents=True, exist_ok=True)
        if not p.exists():
            urllib.request.urlretrieve(ENV_URL, p)

    npm = find_npm()
    if npm:
        subprocess.run([npm, "install"], cwd=BASE_DIR, shell=True)

    with open(APP_VERSION_FILE, "w", encoding="utf-8") as f:
        json.dump({{
            "installed_sha": sha,
            "install_date": ts,
            "updated_at": time.time()
        }}, f, indent=2)

    if npm:
        subprocess.Popen([npm, "start"], cwd=BASE_DIR, shell=True)

if __name__ == "__main__":
    main()
'''
    VERSION_SCRIPT_PATH.write_text(content, encoding="utf-8")
    print("✅ version.py créé")

def create_update_script():
    content = f'''#!/usr/bin/env python3
import json, subprocess, urllib.request, ctypes
from pathlib import Path

BASE_PROGRAMS = Path.home() / "AppData" / "Local" / "Programs"
BASE_DIR = BASE_PROGRAMS / "Sroff Game Installer"
APP_VERSION_FILE = BASE_DIR / "ash-version-app.json"

def read_sha():
    try:
        with open(APP_VERSION_FILE, "r", encoding="utf-8") as f:
            return json.load(f).get("installed_sha")
    except:
        return None

def get_latest_sha():
    req = urllib.request.Request(
        "https://api.github.com/repos/{GITHUB_REPO}/commits/{GITHUB_BRANCH}",
        headers={{"User-Agent": "Sroff-Updater"}}
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)["sha"]

def popup():
    ctypes.windll.user32.MessageBoxW(
        0,
        "Mise à jour disponible",
        "Sroff Game Installer",
        0x40
    )

def main():
    if read_sha() == get_latest_sha():
        subprocess.Popen("npm start", cwd=str(BASE_DIR), shell=True)
    else:
        popup()
        subprocess.Popen(
            ["cmd", "/k", "python version.py"],
            cwd=str(BASE_PROGRAMS),
            shell=True
        )

if __name__ == "__main__":
    main()
'''
    UPDATE_SCRIPT_PATH.write_text(content, encoding="utf-8")
    print("✅ update.py créé")

# ================= SHORTCUT =================

def create_desktop_shortcut():
    shortcut = DESKTOP_DIR / "Sroff Game Installer.lnk"
    ps = f'''
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("{shortcut}")
$Shortcut.TargetPath = "cmd.exe"
$Shortcut.Arguments = '/k python "{UPDATE_SCRIPT_PATH}"'
$Shortcut.WorkingDirectory = "{BASE_PROGRAMS}"
$Shortcut.Save()
'''
    subprocess.run(["powershell", "-Command", ps], capture_output=True)
    print("✅ Raccourci bureau créé")

# ================= MAIN =================

def main():
    print("🚀 Installation en cours...")

    sha, ts = get_latest_commit()
    download_repo(sha)
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
