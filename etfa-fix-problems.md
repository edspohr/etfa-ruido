# ETFA Ruido — Resumen de Problemas y Verificaciones Pendientes

## Contexto

App React 19 + Vite + Firebase (Firestore/Auth/Storage) para gestión operativa y financiera de ETFA Ruido (ingeniería acústica chilena). Toda la UI es en español. El repo está en `~/Documents/etfa-ruido`.

---

## PROBLEMA CRÍTICO: Build de Vite cuelga indefinidamente

El `npm run build` (Vite 7.3.1) se cuelga durante la fase de transformación, específicamente al procesar los miles de iconos de `lucide-react`. En un MacBook Air con recursos limitados, el build nunca termina (>15 min sin avanzar).

**Causas probables:**
- `lucide-react` importa todos los iconos aunque solo se usen ~30. Tree-shaking no es suficiente en el bundle step.
- Sin configuración de chunking en `vite.config.js`, Vite intenta procesar todo en un solo paso.

**Verificaciones necesarias:**
- Revisar `vite.config.js` y optimizar: agregar `build.rollupOptions.output.manualChunks` para separar vendor libs pesadas (lucide-react, firebase, recharts, pdfjs-dist, xlsx, framer-motion, @hello-pangea/dnd).
- Considerar `optimizeDeps.include` para pre-bundlear lucide-react en dev y build.
- Verificar que el build completa en menos de 2 minutos después de la optimización.
- NO cambiar dependencias, solo configuración de Vite.

---

## PROBLEMA 1: Recurrencia no visible como columna separada en UserDashboard

**Archivo:** `src/pages/UserDashboard.jsx`

Un cambio anterior eliminó la columna "Recurrencia" de la tabla "Mi Resumen por Proyecto" y la fusionó dentro de `formatProjectLabel()`. El cliente necesita que la recurrencia sea una columna separada Y visible, además de aparecer en el nombre del proyecto.

**Estado actual:** El código en git YA tiene el fix (columna restaurada), pero necesita verificación de que:
- La tabla tiene columnas: Proyecto | Recurrencia | Total Viáticos | Total Rendido | Saldo | Estado | (expand arrow)
- Los colSpan del empty state y de la fila expandida son correctos para 7 columnas
- `formatProjectLabel(row)` se usa para el nombre del proyecto
- `row.recurrence || '-'` se muestra en la columna Recurrencia separada
- La lógica de filtrado de gastos usa `if (e.status === 'rejected') return;` (NO `if (e.status !== 'approved') return;`). Los gastos pendientes DEBEN contar en los totales.

---

## PROBLEMA 2: AdminProjects tiene imports falsos y código muerto

**Archivo:** `src/pages/AdminProjects.jsx`

Un agente anterior introdujo:
- Import de `createNotification` desde `../utils/notifications` (archivo que puede existir pero no se necesita aquí)
- Import de `migrateProjectCodes` desde `../utils/migrateProjectCodes` (archivo que puede existir pero no se necesita aquí)
- Constante `CODE_REGEX` que fuerza un formato `PXXXR` no deseado
- Función `handleMigrate` que llama a `migrateProjectCodes`
- Botón "Migrar códigos al formato unificado (PXXXR)" en el UI
- Placeholder del campo código cambiado a "P + 3 dígitos + recurrencia"
- `.toUpperCase()` forzado en los campos code y recurrence

**Verificaciones necesarias:**
- Eliminar imports de `notifications` y `migrateProjectCodes`
- Eliminar `CODE_REGEX`
- Eliminar función `handleMigrate` y su botón en el UI
- Campo Código: label "Código *", placeholder "Ej: ETF-001", sin `.toUpperCase()` forzado
- Campo Recurrencia: debe ser un campo SEPARADO del código, placeholder "Ej: A, B, C", sin `.toUpperCase()` forzado
- La función `handleSaveProject` NO debe validar contra CODE_REGEX
- La función `handleSaveProject` debe guardar contacto como objeto nested `contacto: { nombre, telefono, email, cargo }` y recursos como `recursos: { ingenieros, vehiculo, equipamiento }` (para compatibilidad con AdminProjectDetails.jsx que los lee así)
- Los archivos `src/utils/notifications.js` y `src/utils/migrateProjectCodes.js` pueden eliminarse si existen, ya que no son usados por nada más en la app

---

## PROBLEMA 3: Archivos huérfanos potenciales

El agente anterior creó archivos que no estaban en el plan:
- `src/pages/AdminClients.jsx` — puede quedarse si está funcional (es parte de Fase 2), pero verificar que no tiene imports rotos
- `src/pages/Notifications.jsx` — NO estaba planeado, verificar si está ruteado en App.jsx y si tiene imports válidos. Si no se usa, eliminar.
- `src/utils/migrateProjectCodes.js` — eliminar si existe
- `src/utils/notifications.js` — eliminar si existe

**Verificación:** Buscar en `src/App.jsx` si hay rutas apuntando a `Notifications` o `AdminClients` que no deberían estar. Las únicas rutas nuevas válidas serían `/admin/clients` apuntando a `AdminClients`.

---

## VERIFICACIÓN FINAL OBLIGATORIA

Después de aplicar todos los fixes:

1. `npm run lint` debe pasar sin errores
2. `npm run build` debe completar exitosamente (máximo 2 minutos con la optimización de Vite)
3. NO debe haber imports que apunten a archivos inexistentes
4. Buscar en todo el proyecto: `grep -r "migrateProjectCodes\|createNotification\|CODE_REGEX\|handleMigrate" src/` — debe devolver 0 resultados
5. Toda la UI debe seguir en español
6. No se deben agregar ni cambiar dependencias en package.json
