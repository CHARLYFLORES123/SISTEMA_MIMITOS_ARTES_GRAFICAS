@echo off
title POS Ventas - Backend (Puerto 5000)
color 0E

:: Asegurar PATH con Node y pnpm
set "PATH=%SystemRoot%\System32;%SystemRoot%;C:\Program Files\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\node;%PATH%"

cd /d "%~dp0..\artifacts\api-server"

:: Variables de entorno del Backend
set "PORT=5000"
set "NODE_ENV=development"
set "DATABASE_URL=postgresql://postgres:12345@localhost:5432/bd_mimitos_artes_graficas"
set "JWT_SECRET=25712087eacbfd85c4551de93aaace104a462228de6d63d4cd1aebabdc2586c3"
set "VITE_API_URL=http://localhost:5000/api"

echo =====================================================================
echo                POS VENTAS - SERVIDOR BACKEND (API)
echo                Puerto: 5000  ^|  Base: http://localhost:5000/api
echo =====================================================================
echo.

echo [INFO] Compilando Backend API con las rutas y cambios actuales...
call node build.mjs
if errorlevel 1 (
    echo.
    echo [ERROR] No se pudo compilar el Backend API.
    pause
    exit /b 1
)

node --enable-source-maps ./dist/index.mjs

if errorlevel 1 (
    echo.
    echo [ERROR] El servidor Backend se detuvo inesperadamente.
    pause
)
