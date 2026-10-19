# 🚀 Guía de Configuración Local — Sistema POS Perfisoft

## 📋 Requisitos Previos

Antes de iniciar, asegúrate de tener instalado:

- **Node.js** ≥ 18 LTS ([descargar](https://nodejs.org/))
- **pnpm** ≥ 9.x ([descargar](https://pnpm.io/))
- **PostgreSQL** ≥ 14 ([descargar](https://www.postgresql.org/download/))
- **Git**

### Verificar instalación:
```bash
node --version      # v18+
pnpm --version      # 9.x+
psql --version      # 14+
```

---

## 1️⃣ Clonar y Preparar el Proyecto

```bash
# Clonar repositorio (si no está clonado)
git clone <repositorio-url>
cd PROYECTO_SOFTWARE_VENTAS

# Instalar dependencias del workspace
pnpm install
```

**Nota:** El proyecto usa **pnpm workspaces**, no npm ni yarn. Es obligatorio usar `pnpm`.

---

## 2️⃣ Configurar Base de Datos PostgreSQL

### Opción A: Crear DB localmente

```bash
# Abrir PostgreSQL
psql -U postgres

# En la consola de psql, ejecutar:
CREATE DATABASE pos_ventas;
CREATE USER pos_user WITH PASSWORD 'tu_contraseña_segura';
ALTER ROLE pos_user SET client_encoding TO 'utf8';
ALTER ROLE pos_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE pos_user SET default_transaction_deferrable TO on;
ALTER ROLE pos_user SET timezone TO 'UTC';
GRANT ALL PRIVILEGES ON DATABASE pos_ventas TO pos_user;
\q
```

### Opción B: Usar Docker (Recomendado)

```bash
# Crear contenedor PostgreSQL
docker run --name pos-ventas-db \
  -e POSTGRES_USER=pos_user \
  -e POSTGRES_PASSWORD=tu_contraseña_segura \
  -e POSTGRES_DB=pos_ventas \
  -p 5432:5432 \
  -d postgres:16-alpine
```

---

## 3️⃣ Variables de Entorno

### Crear archivo `.env` en `artifacts/api-server/`

El API carga automáticamente este archivo al iniciar. No publiques este archivo ni compartas la contraseña SMTP.

```env
# DATABASE
DATABASE_URL="postgresql://pos_user:tu_contraseña_segura@localhost:5432/pos_ventas"

# API SERVER
PORT=5000
NODE_ENV=development
JWT_SECRET="tu_jwt_secret_super_largo_y_seguro_al_menos_32_caracteres"

# FRONTEND
VITE_API_URL="http://localhost:5000/api"

# EMAIL DE BOLETAS (SMTP)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="tu-correo@gmail.com"
SMTP_PASSWORD="tu-clave-de-aplicacion"
SMTP_FROM="tu-correo@gmail.com"
```

**Archivo `.env` completo para referencia:**
```env
# ==================== DATABASE ====================
DATABASE_URL="postgresql://pos_user:tu_contraseña_segura@localhost:5432/pos_ventas"

# ==================== API SERVER ====================
PORT=5000
NODE_ENV=development

# JWT Token Secret (genera uno con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
JWT_SECRET="88a7f9c2e3d1b4a6f8c0e2d4f6a8b0c2e4f6a8b0c2e4f6a8b0c2e4f6a8b0c2"

# ==================== FRONTEND ====================
# URL de la API para el cliente React
VITE_API_URL="http://localhost:5000/api"

# ==================== LOGGING ====================
LOG_LEVEL="debug"
```

---

## 4️⃣ Inicializar Base de Datos (Migraciones + Seed)

```bash
# Ejecutar migraciones de Drizzle
cd lib/db
pnpm run push
cd ../..

# Nota: El seed de usuarios demo se ejecuta automáticamente cuando se inicia el API server
# En una instalación existente, vuelve a ejecutar el push para agregar las tablas de reservas.
```

**Usuarios de demostración creados automáticamente:**
| Email | Contraseña | Rol |
|-------|-----------|-----|
| vendedor@demo.com | vendedor123 | vendedor |
| inventario@demo.com | inventario123 | inventario |
| compras@demo.com | compras123 | compras |

---

## 5️⃣ Estructura de Carpetas (Monorepo)

```
.
├── artifacts/
│   ├── api-server/          ← API Express (puerto 5000)
│   ├── pos-ventas/          ← Frontend React (puerto 5173)
│   └── mockup-sandbox/      ← UI Components preview
├── lib/
│   ├── db/                  ← Drizzle ORM + Migraciones
│   ├── api-spec/            ← OpenAPI spec + Orval config
│   ├── api-zod/             ← Zod schemas generados
│   └── api-client-react/    ← TanStack Query hooks generados
└── scripts/
```

---

## 6️⃣ Iniciar el Proyecto

### Terminal 1: Iniciar API Server
```bash
cd artifacts/api-server
pnpm run dev
```

**Salida esperada:**
```
Server running on http://localhost:5000/api
✓ Database connected
✓ Demo users created
```

### Terminal 2: Iniciar Frontend React
```bash
cd artifacts/pos-ventas
pnpm run dev
```

**Salida esperada:**
```
  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

---

## 7️⃣ Verificar que Todo Funciona

### 1. Health Check
```bash
curl http://localhost:5000/api/health
```

**Respuesta esperada:**
```json
{ "status": "ok" }
```

### 2. Login en el Frontend
1. Abre http://localhost:5173 en el navegador
2. Login con cualquier usuario de demo (ej: `vendedor@demo.com` / `vendedor123`)
3. Deberías ver el **Dashboard** con KPIs y gráficos

### 3. Verificar API endpoints
```bash
# Listar productos (requiere JWT token)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:5000/api/products

# Listar categorías
curl http://localhost:5000/api/categories
```

---

## 8️⃣ Compilación y Build

### Build para producción
```bash
# Root del workspace
pnpm run build

# Genera:
# - artifacts/api-server/dist/index.mjs
# - artifacts/pos-ventas/dist/
```

### Build individual
```bash
# Solo API
cd artifacts/api-server && pnpm run build

# Solo Frontend
cd artifacts/pos-ventas && pnpm run build
```

---

## 🔧 Troubleshooting

### Error: "Port 5000 already in use"
```bash
# Windows: Ver qué proceso usa el puerto
netstat -ano | findstr :5000

# Linux/Mac:
lsof -i :5000

# Cambiar puerto en .env o liberar el puerto existente
```

### Error: "DATABASE_URL not set"
```bash
# Verificar que .env existe en la raíz
ls -la .env

# Verificar que DATABASE_URL está definida
echo $DATABASE_URL  # Linux/Mac
echo %DATABASE_URL% # Windows
```

### Error: "Cannot find module @workspace/db"
```bash
# Reinstalar dependencias del workspace
pnpm install

# Limpiar node_modules
pnpm clean
pnpm install
```

### Base de datos conexión rechazada
```bash
# Verificar PostgreSQL está corriendo
psql -U pos_user -d pos_ventas -c "SELECT NOW();"

# Si usa Docker:
docker ps | grep postgres
docker logs pos-ventas-db
```

### Frontend muestra errores de CORS
- Verifica que `PORT` en .env es 5000
- Verifica que `VITE_API_URL` es `http://localhost:5000/api`
- Reinicia ambos servidores

---

## 📚 Stack Técnico Detallado

| Componente | Tecnología | Propósito |
|-----------|-----------|----------|
| **Backend** | Node.js + Express | API REST |
| **Frontend** | React 18 + Vite | Single Page App (SPA) |
| **Database** | PostgreSQL + Drizzle ORM | Persistencia |
| **Auth** | JWT + bcryptjs | Seguridad |
| **Styling** | Tailwind CSS | Estilos |
| **UI Components** | Radix UI | Componentes accesibles |
| **Data Fetching** | TanStack Query | Cache y sincronización |
| **Forms** | React Hook Form + Zod | Validación y manejo |
| **Charts** | Recharts | Visualización de datos |
| **Export** | SheetJS (xlsx) | Exportar a Excel |
| **Package Manager** | pnpm | Gestor de dependencias |

---

## 🚀 Próximos Pasos

1. **Revisar la API:** Documentación OpenAPI en `/api/docs` (próximamente)
2. **Explorar el Dashboard:** Ver KPIs, gráficos de ventas
3. **Crear datos de prueba:** Agregar productos, clientes, realizar ventas
4. **Entender la BD:** Revisar schema en `lib/db/src/schema/`
5. **Extender funcionalidades:** Seguir arquitectura del proyecto

---

## 📞 Soporte Rápido

### Comandos útiles
```bash
# Ver estructura del workspace
pnpm ls --depth=0

# Type check en todo el workspace
pnpm run typecheck

# Limpiar caché
pnpm clean

# Ver logs en desarrollo
pnpm run dev -- --verbose
```

### Archivos clave
- `replit.md` — Documentación completa del proyecto
- `lib/db/drizzle.config.ts` — Configuración de BD
- `artifacts/api-server/src/routes/` — Endpoints API
- `artifacts/pos-ventas/src/pages/` — Páginas del frontend

---

**✅ ¡Listo! El proyecto debería estar corriendo en http://localhost:5173**

Última actualización: 2025-09-02
