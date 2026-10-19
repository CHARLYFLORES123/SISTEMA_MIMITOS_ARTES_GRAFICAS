# 🚀 Iniciar Proyecto Localmente

## ✅ Estado Actual
- **Frontend:** Corriendo en http://localhost:5173
- **API Server:** Corriendo en http://localhost:5000
- **Base de Datos:** PostgreSQL en localhost:5432

---

## 📝 Terminal 1: Frontend React (Vite)

```powershell
cd "c:\Users\HP VICTUS-CORE I7\Documents\PROYECTO_SOFTWARE_VENTAS\artifacts\pos-ventas"
$env:PORT="5173"
$env:BASE_PATH="/"
pnpm run dev
```

**Salida esperada:**
```
VITE v7.3.6  ready in 906 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.0.14:5173/
```

---

## 📝 Terminal 2: API Server (Express)

```powershell
cd "c:\Users\HP VICTUS-CORE I7\Documents\PROYECTO_SOFTWARE_VENTAS\artifacts\api-server"
$env:DATABASE_URL="postgresql://postgres:12345@localhost:5432/bd_mimitos_artes_graficas"
$env:PORT="5000"
$env:NODE_ENV="development"
$env:JWT_SECRET="25712087eacbfd85c4551de93aaace104a462228de6d63d4cd1aebabdc2586c3"
pnpm run start
```

**Salida esperada:**
```
[01:04:24.367] INFO (5976): Server listening
    port: 5000
```

---

## 🔧 Para Primera Ejecución: Ejecutar Migraciones

```powershell
cd "c:\Users\HP VICTUS-CORE I7\Documents\PROYECTO_SOFTWARE_VENTAS\lib\db"
pnpm run push
```

---

## 🌐 Acceder a la Aplicación

1. **Frontend:** http://localhost:5173
2. **Login con:**
   - Email: `vendedor@demo.com`
   - Password: `vendedor123`
3. **Ver API:** `http://localhost:5000/api`

---

## 🐛 Troubleshooting

### Error: "PORT required"
→ Asegúrate de establecer `$env:PORT="5173"` antes de ejecutar Vite

### Error: "DATABASE_URL not set"
→ Asegúrate de establecer todas las variables `$env:*` en el terminal API

### Error: "Port 5000/5173 already in use"
```powershell
netstat -ano | findstr :5173  # Ver qué proceso usa puerto
taskkill /PID <PID> /F        # Terminar el proceso
```

### Módulos nativos faltantes (rollup, lightningcss, tailwindcss)
- Ya están resueltos: `@rollup/rollup-win32-x64-msvc`, `lightningcss-win32-x64-msvc`, `@tailwindcss/oxide-win32-x64-msvc`
- Si vuelve a ocurrir, ejecuta: `pnpm install`

---

## ✅ Checklist de Ejecución

- [x] Node.js + pnpm instalados
- [x] PostgreSQL corriendo con base `bd_mimitos_artes_graficas`
- [x] `.env` configurado con DATABASE_URL, PORT, JWT_SECRET
- [x] Dependencias instaladas (`pnpm install`)
- [x] Módulos nativos Windows instalados
- [x] Migraciones ejecutadas (`pnpm run push`)
- [x] Terminal 1: Frontend iniciado en 5173
- [x] Terminal 2: API iniciado en 5000
- [x] Login funciona en http://localhost:5173

---

¡Proyecto completamente funcional! 🎉
