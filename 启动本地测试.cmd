@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 goto failed

set "LOCAL_TEST_NODE=node"
where node >nul 2>&1
if errorlevel 1 set "LOCAL_TEST_NODE=%ProgramFiles%\nodejs\node.exe"
"%LOCAL_TEST_NODE%" --version >nul 2>&1
if errorlevel 1 goto missing_node

"%LOCAL_TEST_NODE%" "scripts\build-local-test.mjs"
if errorlevel 1 goto failed
if /i "%~1"=="--check" exit /b 0

echo.
echo Local test server: http://127.0.0.1:4177/
echo Keep this window open. Press Ctrl+C to stop.
echo.
"%LOCAL_TEST_NODE%" "scripts\preview.mjs"
if errorlevel 1 goto failed
exit /b 0

:missing_node
echo [ERROR] Node.js was not found. Install Node.js 22 or newer.
goto failed

:failed
echo [ERROR] Local test startup failed. Please keep the error above.
if /i not "%~1"=="--check" pause
exit /b 1
