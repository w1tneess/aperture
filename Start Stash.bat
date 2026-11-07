@echo off
setlocal
cd /d "%~dp0"
title Stash
echo.
echo  Stash - starting up
echo  -------------------

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is not installed.
  echo      Run this in PowerShell, then reopen it:  winget install OpenJS.NodeJS.LTS
  goto end
)

set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo  [X] Python is not installed.
  echo      Run this in PowerShell, then reopen it:  winget install Python.Python.3.12
  goto end
)

%PY% -m yt_dlp --version >nul 2>nul
if errorlevel 1 (
  echo  Installing yt-dlp and gallery-dl...
  %PY% -m pip install -U yt-dlp gallery-dl
  if errorlevel 1 goto failed
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo  [!] ffmpeg not found. HD video and MP3 may fail.
  echo      Fix later with:  winget install Gyan.FFmpeg
)

if not exist "server\node_modules" (
  echo  Installing server packages...
  call npm install --prefix server
  if errorlevel 1 goto failed
)
if not exist "web\node_modules" (
  echo  Installing app packages...
  call npm install --prefix web
  if errorlevel 1 goto failed
)
if not exist "web\dist\index.html" (
  echo  Building the app...
  call npm run build --prefix web
  if errorlevel 1 goto failed
)

echo.
echo  Opening http://127.0.0.1:8787 in your browser.
echo  Keep this window open while you use Stash. Close it to stop.
echo.
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:8787"
node server\src\index.js --prod
goto end

:failed
echo.
echo  [X] Something failed above. Copy the messages and send them over.

:end
echo.
pause
