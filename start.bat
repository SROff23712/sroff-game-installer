@echo off
echo Demarrage de Sroff Game Installer...
echo.

REM Lancer updater.py
if exist "%~dp0updater.py" (
    echo Lancement de updater.py...
    python "%~dp0updater.py" || py "%~dp0updater.py" || (
        echo Impossible d'executer updater.py - Python introuvable.
        echo Lancer l'application manuellement.
    )
) else (
    echo updater.py introuvable, lancer l'application manuellement.
)

exit /b