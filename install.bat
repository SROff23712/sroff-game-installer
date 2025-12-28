@echo off
echo Installation de Sroff Game Installer...
echo.

REM Vérifier si Node.js est installé
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERREUR: Node.js n'est pas installe. Veuillez installer Node.js depuis https://nodejs.org/
    pause
    exit /b 1
)

echo Installation des dependances...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo ERREUR: Echec de l'installation des dependances
    pause
    exit /b 1
)

echo.
echo Installation terminee avec succes!
echo.
echo IMPORTANT: Configurez votre fichier .env avec vos identifiants Firebase
echo Copiez .env.example vers .env et remplissez les valeurs
echo.
pause

