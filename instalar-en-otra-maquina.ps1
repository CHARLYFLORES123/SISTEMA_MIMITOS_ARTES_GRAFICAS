# Script para instalar y dejar corriendo el proyecto en otra máquina (Windows)
# Uso:  powershell -ExecutionPolicy Bypass -File .\instalar-en-otra-maquina.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

Write-Host "=== 1/6 Verificando prerrequisitos ===" -ForegroundColor Cyan
foreach ($cmd in @("node", "pnpm", "psql")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: '$cmd' no está instalado. Asegúrate de instalar Node.js, pnpm (npm i -g pnpm) y PostgreSQL primero." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Node: $(node --version) | pnpm: $(pnpm --version)" -ForegroundColor Gray

Write-Host "=== 2/6 Instalando dependencias (pnpm install) ===" -ForegroundColor Cyan
# Si pnpm v12+ bloquea los scripts de construcción, autorizamos automáticamente
pnpm config set enable-pre-post-scripts true 2>$null
pnpm install

Write-Host "=== 3/6 Configurando .env si falta ===" -ForegroundColor Cyan
if (-not (Test-Path "$root\.env")) {
    $dbPass = Read-Host "Contraseña de PostgreSQL del usuario 'postgres'"
    @"
DATABASE_URL="postgresql://postgres:$dbPass@localhost:5432/bd_mimitos_artes_graficas"
PORT=5000
BASE_PATH="/"
JWT_SECRET="25712087eacbfd85c4551de93aaace104a462228de6d63d4cd1aebabdc2586c3"
VITE_API_URL="http://localhost:5000/api"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_SECURE="false"
SMTP_USER="hospitalveterinarioupeamvz@gmail.com"
SMTP_PASSWORD="nlfahgxwgxtrkbhw"
SMTP_FROM="hospitalveterinarioupeamvz@gmail.com"
"@ | Set-Content "$root\.env"
    Write-Host ".env creado exitosamente"
} else {
    Write-Host ".env ya existe, no se toca"
}

# Cargar variables del .env a la sesión actual de PowerShell
Get-Content "$root\.env" | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $val = $matches[2].Trim().Trim('"').Trim("'")
        [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
    }
}

Write-Host "=== 4/6 Verificando / Creando base de datos PostgreSQL ===" -ForegroundColor Cyan
try {
    # Extraer contraseña si existe para PGPASSWORD
    if ($env:DATABASE_URL -match 'postgresql://[^:]+:([^@]+)@') {
        $env:PGPASSWORD = $matches[1]
    }
    # Intentar crear la base de datos si no existe
    psql -U postgres -h localhost -p 5432 -tc "SELECT 1 FROM pg_database WHERE datname = 'bd_mimitos_artes_graficas'" | Select-String "1" -Quiet | ForEach-Object {
        if (-not $_) {
            Write-Host "Creando base de datos 'bd_mimitos_artes_graficas'..." -ForegroundColor Yellow
            psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE bd_mimitos_artes_graficas;"
        } else {
            Write-Host "Base de datos 'bd_mimitos_artes_graficas' ya existe." -ForegroundColor Green
        }
    }
} catch {
    Write-Host "Aviso: No se pudo verificar o crear la DB automáticamente con psql. Asegúrate de que PostgreSQL esté corriendo y la base de datos 'bd_mimitos_artes_graficas' exista." -ForegroundColor Yellow
}

Write-Host "=== 5/6 Ejecutando migraciones (creando tablas) ===" -ForegroundColor Cyan
Push-Location "$root\lib\db"
pnpm run push
Pop-Location

Write-Host "=== 6/7 Creando acceso directo en el Escritorio ===" -ForegroundColor Cyan
try {
    & "$root\scripts\create-shortcut.ps1"
} catch {
    Write-Host "Aviso: No se pudo crear el acceso directo automáticamente. Puedes ejecutar 'crear-acceso-directo.bat' manualmente." -ForegroundColor Yellow
}

Write-Host "=== 7/7 ¡Listo para usar! ===" -ForegroundColor Green
Write-Host @"
¡Instalación completada exitosamente!

Para iniciar el sistema en cualquier momento:
  1. Haz doble clic en el acceso directo 'Iniciar POS Ventas' en tu Escritorio.
  O ejecuta 'iniciar-sistema.bat' en esta carpeta.

Usuarios demo disponibles:
  - Admin:       admin@demo.com    / admin123
  - Vendedor:    vendedor@demo.com / vendedor123
  - Inventario:  inventario@demo.com / inventario123
"@
