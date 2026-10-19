# 🚀 Inicio Rápido con 1 Clic — Sistema POS Ventas

Para iniciar todo el sistema localmente sin tener que abrir consolas ni escribir comandos manualmente, tienes a disposición los siguientes ejecutables:

---

### 1️⃣ Desde el Escritorio de Windows (Recomendado)

En tu Escritorio ya tienes creado el acceso directo:

- **`Iniciar POS Ventas`** (con el ícono del sistema)

> Simplemente dale **doble clic** y el sistema hará todo por ti.

---

### 2️⃣ Desde la Carpeta del Proyecto

En la raíz de este proyecto tienes los siguientes archivos:

1. **`iniciar-sistema.bat`**
   - Verifica que el servicio de PostgreSQL esté activo.
   - Libera los puertos 5000 y 5173 para evitar conflictos.
   - Carga todas las variables de entorno necesarias.
   - Inicia el servidor Backend (Express en http://localhost:5000/api).
   - Inicia el frontend (React + Vite en http://localhost:5173).
   - Abre automáticamente tu navegador en **http://localhost:5173**.
   - Te muestra un menú en consola con opciones:
     - Presionar **`D`** para detener los servidores y cerrar todo.
     - Presionar **`R`** para reabrir/recargar el navegador.
     - Presionar **`X`** para salir de la ventana y dejar los servidores corriendo.

2. **`detener-sistema.bat`**
   - Cierra inmediatamente los procesos en los puertos 5000 y 5173 de forma limpia.

3. **`crear-acceso-directo.bat`**
   - Si en algún momento borras el acceso directo del Escritorio, al ejecutar este archivo se vuelve a generar automáticamente con su ícono personalizado.

---

### 🔑 Usuarios Demo Disponibles

- **Administrador:** `admin@demo.com` / `admin123`
- **Vendedor:** `vendedor@demo.com` / `vendedor123`
- **Inventario:** `inventario@demo.com` / `inventario123`

### 🎨 Reservas para sublimación

El administrador puede crear usuarios con el rol **Diseñador** desde el módulo Usuarios. El administrador y el diseñador pueden registrar reservas con detalles por producto, adelanto opcional, fecha estimada y notas; el diseñador actualiza cada producto por las etapas **Reserva**, **En producción** y **Listo para entrega**. Cuando todos los productos están listos, se abre la reserva desde **Nueva Venta** para consultar sus especificaciones y cobrar el saldo al entregarla. El adelanto se descuenta del saldo y no se agrega a la caja desde el módulo de reservas.

Si ya tienes una base de datos y actualizaste el sistema, aplica los cambios del esquema con `pnpm db:push` desde la raíz del proyecto.
