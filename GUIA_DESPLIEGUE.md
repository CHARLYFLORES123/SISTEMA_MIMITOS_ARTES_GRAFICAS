# 🚀 Guía de Despliegue en la Nube: Neon + Render + Vercel

Esta guía te explica paso a paso cómo desplegar todo el sistema de **Venta de Ropa (Perfisoft POS)** de forma **100% gratuita**, con certificados SSL automáticos (HTTPS) y accesible desde cualquier dispositivo o computadora.

---

## 🏛️ Arquitectura del Despliegue

```
┌─────────────────────────────────┐
│   Frontend (React + Vite)       │  --> Vercel (https://tu-pos.vercel.app)
└───────────────┬─────────────────┘
                │ Llamadas HTTP/REST
                ▼
┌─────────────────────────────────┐
│   Backend API (Node.js/Express) │  --> Render (https://tu-pos-api.onrender.com)
└───────────────┬─────────────────┘
                │ Conexión PostgreSQL (SSL)
                ▼
┌─────────────────────────────────┐
│   Base de Datos PostgreSQL      │  --> Neon.tech (neondb en la nube)
└─────────────────────────────────┘
```

---

## 📦 Paso 1: Guardar y Subir los Cambios a GitHub

Tanto Render como Vercel se conectan a tu repositorio de GitHub para compilar y desplegar automáticamente.

En tu terminal de PowerShell en la raíz del proyecto, ejecuta:

```powershell
git add .
git commit -m "Configurar proyecto para despliegue en Neon, Render y Vercel"
git push origin main
```

*(Si te pide credenciales de GitHub, ingresa tu usuario y token/contraseña de GitHub).*

---

## 🐘 Paso 2: Crear la Base de Datos en Neon.tech (2 minutos)

1. Ingresa a **[neon.tech](https://neon.tech)** y regístrate o inicia sesión con tu cuenta de GitHub.
2. Crea un nuevo proyecto:
   - **Project Name:** `pos-ventas` (o el nombre que gustes).
   - **Database Name:** `neondb` (por defecto).
   - **Region:** Selecciona la más cercana (ej. `US East (Ohio)` o `US East (N. Virginia)`).
3. Una vez creado el proyecto, Neon te mostrará la pantalla de conexión (**Connection details**).
4. Copia la cadena **Connection string** (asegúrate de que tenga el formato PostgreSQL con `sslmode=require`).
   - Ejemplo de cadena:
     ```text
     postgresql://neondb_owner:npg_xYz12345@ep-cool-flower-a123.us-east-2.aws.neon.tech/neondb?sslmode=require
     ```

### ⚡ Crear las tablas en Neon:

Abre tu terminal de PowerShell en tu computadora y corre este comando con tu URL de Neon:

```powershell
# 1. Definir la variable temporalmente con tu URL de Neon
$env:DATABASE_URL="TU_CADENA_COPIADA_DE_NEON"

# 2. Empujar el esquema de base de datos a Neon (creará todas las tablas)
pnpm db:push
```

> **¿Quieres migrar todos tus datos locales actuales (productos, marcas, categorías)?**
> Si ya tienes datos en tu PostgreSQL local y quieres copiarlos a Neon:
> ```powershell
> $env:NEON_DATABASE_URL="TU_CADENA_COPIADA_DE_NEON"
> node lib/db/migrate-to-neon.mjs
> ```
> *(Este script copiará de forma automática tus tablas locales a Neon).*

---

## 🚀 Paso 3: Desplegar el Backend en Render.com (3 minutos)

1. Ingresa a **[render.com](https://render.com)** e inicia sesión con tu cuenta de GitHub.
2. En el panel principal, haz clic en el botón **New +** y selecciona **Web Service**.
3. Selecciona tu repositorio de GitHub: `PROYECTO_SISTEMA_VENTAS_REACT_EXPRESS`.
4. Configura los siguientes campos:
   - **Name:** `pos-ventas-api` (o como prefieras llamarlo).
   - **Region:** La misma o cercana a la de Neon (ej. `Ohio (US East)`).
   - **Branch:** `main`
   - **Root Directory:** *(Déjalo en blanco / vacío)*
   - **Runtime:** `Node`
   - **Build Command:**
     ```bash
     pnpm install && pnpm run build:server
     ```
   - **Start Command:**
     ```bash
     pnpm run start:server
     ```
   - **Instance Type:** `Free` ($0 / mes)

5. Ve a la sección **Environment Variables** (Variables de Entorno) y agrega:
   | Variable | Valor |
   | :--- | :--- |
   | `DATABASE_URL` | *(Pega aquí la cadena de conexión de Neon que obtuviste en el Paso 2)* |
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | `25712087eacbfd85c4551de93aaace104a462228de6d63d4cd1aebabdc2586c3` |
   | `PORT` | `10000` |

   *(Opcional: Si vas a enviar boletas por correo, también puedes agregar `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`).*

6. Haz clic en **Deploy Web Service** (o Create Web Service).
7. Espera unos 2 minutos a que termine de compilar. Cuando termine, verás el estado en verde **"Live"** y arriba tendrás tu URL pública HTTPS, por ejemplo:
   ```text
   https://pos-ventas-api.onrender.com
   ```
   *(Copia esa URL, la necesitarás en el paso de Vercel).*

---

## 🌐 Paso 4: Desplegar el Frontend en Vercel (2 minutos)

1. Ingresa a **[vercel.com](https://vercel.com)** e inicia sesión con GitHub.
2. En tu Dashboard, haz clic en **Add New...** ➔ **Project**.
3. Busca e importa tu repositorio: `PROYECTO_SISTEMA_VENTAS_REACT_EXPRESS`.
4. En la pantalla de configuración:
   - **Framework Preset:** `Vite` (lo detectará automáticamente).
   - **Root Directory:** Haz clic en **Edit** y selecciona la carpeta:
     ```text
     artifacts/pos-ventas
     ```
   - **Build and Output Settings:**
     - Puedes dejar los valores automáticos porque ya configuramos `vercel.json` con `"outputDirectory": "dist/public"`.
     *(Si prefieres configurarlo manualmente en la UI, Build Command es `vite build --config vite.config.ts` y Output Directory es `dist/public`).*

5. En la sección **Environment Variables**, agrega una variable muy importante:
   | Nombre | Valor |
   | :--- | :--- |
   | `VITE_API_URL` | `https://pos-ventas-api.onrender.com/api` |

   > ⚠️ **IMPORTANTE:** Usa la URL que te dio Render en el Paso 3 y asegúrate de añadirle **/api** al final.

6. Haz clic en **Deploy**.
7. En menos de 1 minuto Vercel compilará la aplicación y te dará tu enlace en vivo, por ejemplo:
   ```text
   https://pos-ventas.vercel.app
   ```

---

## 🔑 Usuarios y Credenciales por Defecto

Al arrancar el servidor backend por primera vez contra la base de datos de Neon, se crean automáticamente los siguientes usuarios de prueba:

| Rol | Correo Electrónico | Contraseña |
| :--- | :--- | :--- |
| **Administrador** | `admin@demo.com` | `admin123` |
| **Vendedor** | `vendedor@demo.com` | `vendedor123` |
| **Inventario** | `inventario@demo.com` | `inventario123` |
| **Compras** | `compras@demo.com` | `compras123` |
| **Diseñador** | `disenador@demo.com` | `disenador123` |

---

## 💡 Consejos Útiles del Plan Gratuito

1. **Suspensión por inactividad en Render (Free Tier):**
   - En el plan gratuito de Render, el backend entra en "modo reposo" si no recibe peticiones durante 15 minutos.
   - La primera vez que abras la aplicación tras varias horas de inactividad, puede tardar unos 30-40 segundos en responder mientras Render levanta el contenedor. Después de eso, responderá de inmediato.
   - Si deseas mantenerlo siempre despierto de forma gratuita, puedes usar servicios como [Cron-Job.org](https://cron-job.org) o [UptimeRobot](https://uptimerobot.com) haciendo un ping cada 10 minutos a `https://tu-api.onrender.com/api/business-settings/public`.
