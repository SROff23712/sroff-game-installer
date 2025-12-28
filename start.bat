@echo off
echo Demarrage de Sroff Game Installer...
echo.

REM Lancer update.py dans le dossier parent
set UPDATE_PATH=%~dp0..\update.py

if exist "%UPDATE_PATH%" (
    echo Lancement de update.py...
    python "%UPDATE_PATH%" || py "%UPDATE_PATH%" || (
        echo Impossible d'executer update.py - Python introuvable.
        echo Lancer l'application manuellement.
    )
) else (
    echo update.py introuvable, lancer l'application manuellement.
)

exit
