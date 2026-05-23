@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0..\modules\fairy-guardian"

set GITHUB_REPO=https://github.com/openchat-ai/fairy-guardian.git

echo ========================================
echo     fairy-guardian Publish Script
echo ========================================
echo.

REM 1. show current version
node -e "const p=require('./package.json'); console.log('Current: v'+p.version)"
echo.

REM 2. bump
set /p BUMP="Bump type [patch] minor major skip: "
if "%BUMP%"=="" set BUMP=patch
if /i "%BUMP%"=="skip" goto :publish
call npm version %BUMP% --no-git-tag-version
echo.

:publish
REM 3. publish to npm
call npm publish
if errorlevel 1 (
  echo [ERROR] npm publish failed
  exit /b 1
)

REM 4. sync to standalone GitHub repo (temp init)
echo Syncing to GitHub...
if exist .git rd /s /q .git
git init
git add .
git commit -m "fairy-guardian release"
git remote add origin %GITHUB_REPO%
git push -u origin master --force
git push --tags --force
rd /s /q .git

node -e "const p=require('./package.json'); console.log('\nDone! v'+p.version)" 
echo npm: https://www.npmjs.com/package/fairy-guardian
echo git: %GITHUB_REPO%
