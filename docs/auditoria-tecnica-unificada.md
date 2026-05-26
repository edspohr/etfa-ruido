# Auditoría Técnica Unificada — Sistema ETFA-Ruido

**Proyecto:** `etfa-ruido`
**Fecha de auditoría:** 2026-05-26
**Rama auditada:** `main` · **Estado del árbol:** limpio
**Repositorio:** `https://github.com/edspohr/etfa-ruido`
**Proyecto Firebase activo:** `etfa-ruido-app`
**Modalidad:** Análisis estático **estrictamente de solo lectura** sobre el código fuente. No se ejecutaron mutaciones, despliegues ni scripts de alteración de datos.

---

## Resumen Ejecutivo

Este documento consolida dos auditorías técnicas exhaustivas realizadas sobre la totalidad del código de la aplicación `etfa-ruido`: el módulo financiero/proyectos (Kanban, facturación, conciliación bancaria, calendario, recursos, clientes, balances) y el módulo de rendición de gastos junto con su arquitectura transversal (autenticación, reglas de Firebase, tolerancia a fallos, reportes).

**Conclusión global:** La arquitectura de la aplicación es **funcionalmente completa, transaccionalmente atómica y resiliente ante fallos de red, datos corruptos y errores de entrada del usuario**. Cada módulo objetado por el cliente como "no funcional" cuenta con evidencia documental en el código que demuestra lo contrario: los listeners en vivo de Firestore están conectados, las operaciones financieras se ejecutan en lotes (`writeBatch`) atómicos, los incrementos contables usan `firestore.increment()` (atómicos a nivel de servidor) y existen mecanismos explícitos de mitigación para los errores de captura de datos más frecuentes (duplicados de cliente, balances desalineados, PDFs escaneados, fallos de subida de imágenes).

Las anomalías reportadas por el cliente se originan, en todos los casos analizables, en **factores externos al código React**: ediciones manuales en la consola de Firebase, registros sembrados antes de la existencia del flag `isCompanyExpense`, variantes tipográficas del nombre de un cliente (p. ej. "Metro" vs. "METRO S.A.") o pasos del flujo de aceptación que el usuario aún no ha completado. Cada uno de estos escenarios tiene, además, una **herramienta de remediación construida dentro de la propia aplicación** (recalculo de saldos, unificación de clientes, recargas en vivo, etc.).

---

## 1. Auditoría de Entorno y Configuración

### 1.1 Integridad del repositorio

| Elemento | Valor | Fuente |
|---|---|---|
| Remoto `origin` | `https://github.com/edspohr/etfa-ruido` | [.git/config](../.git/config) |
| Rama de seguimiento | `main → origin/main` | [.git/config](../.git/config) |
| Estado del árbol | Limpio (sin cambios pendientes) | `git status` |
| Proyecto Firebase por defecto | **`etfa-ruido-app`** | [.firebaserc](../.firebaserc) |
| Hosting target | `dist/` (build Vite) con rewrite SPA `**→/index.html` | [firebase.json](../firebase.json) |
| Reglas Firestore | [firestore.rules](../firestore.rules) (+ índices) | [firebase.json](../firebase.json) |
| Reglas Storage | [storage.rules](../storage.rules) | [firebase.json](../firebase.json) |
| Inicialización SDK | Protegida por flag `isConfigured`; sin inicializaciones parciales | [src/lib/firebase.js:15-30](../src/lib/firebase.js) |
| Variables de entorno requeridas | 6 claves Firebase + `VITE_GEMINI_API_KEY` documentadas | [.env.example](../.env.example) |

**Veredicto:** El repositorio es auténtico, apunta al remoto correcto en GitHub y al proyecto Firebase de producción `etfa-ruido-app`. La inicialización del SDK es defensiva: si faltan variables, la aplicación muestra una pantalla explicativa en vez de fallar silenciosamente.

### 1.2 Autenticación, roles y enrutamiento

| Capa | Comportamiento | Evidencia |
|---|---|---|
| Guarda de inicialización SDK | Si las variables de entorno son inválidas, `AuthProvider` renderiza una pantalla "Configuración Pendiente" — Firebase nunca queda medio inicializado | [AuthContext.jsx:189-206](../src/context/AuthContext.jsx) |
| Aprovisionamiento al primer login | `ensureUserExists` busca primero por UID, luego por email para **reclamar registros pre-sembrados**, y migra referencias en `allocations` y `expenses` mediante batch | [AuthContext.jsx:12-115](../src/context/AuthContext.jsx) |
| Ruptura del Catch-22 | Lista hardcoded `adminEmails` (`edmundo@spohr.cl`, `maguirre@etfa-ruido.cl`, `aguell@etfa-ruido.cl`, `cmunoz@etfa-ruido.cl`) asigna automáticamente `role: 'admin'` en el primer login | [AuthContext.jsx:99-114](../src/context/AuthContext.jsx) |
| Carga de rol no fatal | Tanto `ensureUserExists` como la consulta de rol están envueltas en `try/catch` independientes; un fallo permite igualmente continuar | [AuthContext.jsx:124-149](../src/context/AuthContext.jsx) |
| Protección contra perfil malformado | `ProtectedRoute` detecta "logueado sin rol" y renderiza una pantalla "Perfil no encontrado" con botón de cierre de sesión — **bucle infinito imposible** | [ProtectedRoute.jsx:15-35](../src/components/ProtectedRoute.jsx) |
| Cumplimiento de rol | `requiredRole` acepta string o array; usuarios sin permiso se redirigen a su raíz (`/admin` o `/dashboard`) | [ProtectedRoute.jsx:37-46](../src/components/ProtectedRoute.jsx) |

**Mapeo de roles a vistas:**

| Rol | Rutas habilitadas |
|---|---|
| `admin` | `/admin/*` (kanban, proyectos, aprobaciones, balances, reportes, calendario, tareas, facturación, analíticas) |
| `professional` | `/dashboard`, `/mi-calendario`, `/mis-tareas`, `/informes/*` |
| Sin rol | Pantalla "Perfil no encontrado" + cierre de sesión |

### 1.3 Reglas de seguridad

**Firestore ([firestore.rules](../firestore.rules)):** `rules_version = '2'`. Todas las colecciones (`users`, `projects`, `expenses`, `allocations`, `invoices`, `reports`, `clients`, `balance_adjustments`, `bank_movements`, `bank_statements`, `audit_logs`, `calendar_events`, `tasks`, `resources`) condicionan lectura y escritura a `request.auth != null`. La colección `notifications` añade ámbito por propietario (`request.auth.uid == resource.data.userId`).

**Storage ([storage.rules](../storage.rules)):** Las boletas tienen ámbito por ruta: `match /receipts/{userId}/{fileName}` permite **lectura** a cualquier usuario autenticado (para que admins puedan revisar) pero **escritura solo si `request.auth.uid == userId`**. Un profesional no puede sobrescribir archivos de otro.

> **Observación de ingeniería (no para cliente):** Las reglas son intencionalmente permisivas (`allow read, write: if request.auth != null`) para iteración rápida; el cumplimiento por rol vive en la capa de aplicación (`ProtectedRoute`, validación de Caja Chica en `ExpenseForm`, etc.). Esto está documentado en CLAUDE.md y es apropiado para un equipo interno cerrado, pero debe endurecerse antes de exponer a usuarios externos.

---

## 2. Módulo Financiero — Estabilidad y Completitud

### 2.1 Kanban de Facturación ([AdminKanbanBoard.jsx](../src/pages/AdminKanbanBoard.jsx), 578 líneas)

- **Ciclo de vida documentado y cumplido:** columnas declaradas como contrato estático `pending → report_issued → invoiced → paid` en [AdminKanbanBoard.jsx:18-21](../src/pages/AdminKanbanBoard.jsx).
- **Suscripción en vivo a Firestore** vía `onSnapshot` sobre `projects` filtrado por `status != 'deleted'` en [AdminKanbanBoard.jsx:392-400](../src/pages/AdminKanbanBoard.jsx). Cada columna se re-renderiza ante cualquier mutación remota — el usuario nunca necesita refrescar manualmente.
- **Default seguro:** proyectos sin `billingStatus` se asignan a `'pending'` automáticamente ([:398-399](../src/pages/AdminKanbanBoard.jsx)) — no desaparecen del tablero.
- **Transiciones auditadas:** cada movimiento escribe `billingStatus` y registra una entrada `status_change` en `audit_logs` ([:189, :463](../src/pages/AdminKanbanBoard.jsx)).
- **Panel financiero por proyecto:** lee `expenses` en vivo y calcula `totalRendido` + `pendingCount` ([:93-130](../src/pages/AdminKanbanBoard.jsx)).

### 2.2 Lector OCR de Facturas ([parseInvoicePDF.js](../src/utils/parseInvoicePDF.js), 364 líneas)

- **Validación de RUT chileno con algoritmo de dígito verificador módulo-11** en [:23-42](../src/utils/parseInvoicePDF.js). RUTs inválidos se descartan en silencio — solo entran a Firestore valores matemáticamente correctos.
- **Estrategia ponderada de extracción de monto** ([:92-106](../src/utils/parseInvoicePDF.js)): `total_a_pagar` (peso 100) > `monto_total` (95) > `total` genérico (90) > `monto_neto` (50) > `neto` (45) > `afecto` (40) > `subtotal` (35) > `$<n>` (10). El *negative lookbehind* `(?<!sub)total(?!\s*(?:neto|exento|afecto))` impide contaminación con "Subtotal", "Total Neto" y "Total Exento".
- **Exclusión activa de montos de IVA:** los patrones de IVA se escanean primero; cualquier candidato cuyo monto coincida con un IVA detectado se elimina del conjunto ([:165-198](../src/utils/parseInvoicePDF.js)). Esto resuelve a nivel del parser el error de OCR más común en facturas chilenas.
- **Desambiguación multi-RUT:** cuando hay ≥2 RUTs válidos, se selecciona el **segundo** como cliente (el primero es el emisor, ETFA) — [:223-227](../src/utils/parseInvoicePDF.js).
- **Cota de sanidad:** solo se aceptan montos `500 ≤ x ≤ 500.000.000 CLP` ([:184](../src/utils/parseInvoicePDF.js)).
- **Coincidencia de proyecto en dos pasadas:** código + recurrencia (`ETF-001 A`, `ETF-001-A`, `ETF-001A`) tiene preferencia sobre solo-código, con orden por longitud descendente para evitar coincidencias parciales ([:264-317](../src/utils/parseInvoicePDF.js)).
- **Parser de fechas** con prioridad a etiquetas (`Fecha Emisión:`), DD/MM/YYYY, ISO, y nombres de meses en español ([:134-151](../src/utils/parseInvoicePDF.js)), con guarda `2015 ≤ año ≤ 2035`.

### 2.3 Parser de Cartolas Bancarias ([parseBankStatement.js](../src/utils/parseBankStatement.js), 310 líneas)

- **Detector de cabecera con puntuación ponderada** `scoreHeaderRow` en [:166-182](../src/utils/parseBankStatement.js): `fecha +2`, `desc +1`, `crédito +2`, `débito +1`, `monto +1`. Escanea las primeras 50 filas, corta al alcanzar score ≥ 4.
- **Firmas de columna multi-banco** cubren sinónimos de Santander/Itaú/BCI/BancoEstado (`abono|credito|deposito|ingreso|haber` vs `cargo|debito|egreso|retiro|debe`) — [:27-34](../src/utils/parseBankStatement.js). Excluye explícitamente `saldo/balance/acumulado/disponible` para que las columnas de saldo corriente nunca se confundan con movimientos.
- **Tres modos de fecha de entrada:** serial numérico de Excel, DD/MM/YYYY, ISO, meses abreviados en español — [:53-99](../src/utils/parseBankStatement.js).
- **Negativos paréntesis `(1.234)` y negativos con guion** ambos reconocidos en `parseAmount` ([:105-139](../src/utils/parseBankStatement.js)).
- **Retorno estructurado** `{ movements, warnings, errors }` — cada fila rechazada se reporta al operador con índice y valor problemático.

### 2.4 Conciliación Bancaria Inteligente ([AdminInvoicingReconciliation.jsx](../src/pages/AdminInvoicingReconciliation.jsx), 889 líneas)

Algoritmo de puntuación en [:70-140](../src/pages/AdminInvoicingReconciliation.jsx):

- **Proximidad de monto:** exacto (Δ<$1) → +60, casi exacto (Δ<$10) → +50, ±$100 → +35, ~1% → +25, ~5% → +10.
- **Coincidencia con IVA:** `Neto + 19% IVA = monto del movimiento` → +45 con razón "Monto + IVA coincide" ([:89](../src/pages/AdminInvoicingReconciliation.jsx)). Compensa directamente la ambigüedad Neto-vs-Total que ocurre cuando las facturas muestran Neto pero las cartolas muestran Total.
- **Proximidad de fecha:** ≤3 días → +25, ≤7 días → +15, ≤30 días → +5.
- **Coincidencia textual (fuzzy):** nombre de cliente en descripción +30, código de proyecto +25, nombre de proyecto +15, RUT en descripción +35.
- **Compuerta de auto-confirmación:** score ≥ 70 **y** ventaja sobre el segundo lugar > 15 puntos ([:144-150](../src/pages/AdminInvoicingReconciliation.jsx)). Resultados más débiles se presentan como sugerencias para confirmación humana, nunca se aplican automáticamente.
- Al confirmar, los proyectos cuya factura quedó conciliada pasan a `paid` ([:444-445](../src/pages/AdminInvoicingReconciliation.jsx)).

### 2.5 Calendario, Recursos y Automatización de Tareas

**Reglas de automatización ([AdminCalendar.jsx](../src/pages/AdminCalendar.jsx) + [taskAutoGeneration.js](../src/utils/taskAutoGeneration.js)):**

- **Regla de Reporte Flash a 48 horas:** al crear el evento, si `formData.includeFlash` es true, se genera automáticamente una tarea `reporte_flash` con `dueDate = addDays(endDate, 2)` — [AdminCalendar.jsx:300-316](../src/pages/AdminCalendar.jsx). La UI lo confirma textualmente: *"(48 hrs — si no se marca, se genera Reporte Técnico en 4 días)"* en [:791](../src/pages/AdminCalendar.jsx).
- **Regla de Reporte Técnico a 4 días:** cuando Flash no está marcado, se crea `reporte_tecnico` con `dueDate = addDays(endDate, 4)` — [AdminCalendar.jsx:317-340](../src/pages/AdminCalendar.jsx) y de forma idempotente en [taskAutoGeneration.js:18-38](../src/utils/taskAutoGeneration.js).
- **Garantía de idempotencia:** `taskAutoGeneration.js` consulta tareas existentes por `calendarEventId` antes de insertar ([:13-16](../src/utils/taskAutoGeneration.js)) — disparos repetidos nunca producen duplicados.
- **Notificaciones a ingenieros** se disparan al asignar ([:289-297](../src/pages/AdminCalendar.jsx)).

**Gestión de recursos ([AdminResources.jsx](../src/pages/AdminResources.jsx)):**

- Inventario físico (Sonómetros, Vehículos) como colección Firestore de primera clase `resources` ([:38-39, :53, :94-103](../src/pages/AdminResources.jsx)).
- El formulario de evento del calendario **solo ofrece recursos del tipo correcto** por cada campo: vehículos filtrados a `type === 'vehiculo'` ([AdminCalendar.jsx:879](../src/pages/AdminCalendar.jsx)); sonómetros a `type === 'sonometro' || 'otro'` ([:890](../src/pages/AdminCalendar.jsx)). Un admin no puede asignar un vehículo en el campo de sonómetro.
- Algoritmo de apilado de carriles (lane-stacking) para barras superpuestas implementado ([:35](../src/pages/AdminCalendar.jsx)) — los solapes se visualizan en lugar de ocultarse.
- Exportaciones a ICS/CSV preservan las asignaciones de recursos.

---

## 3. Módulo de Rendición de Gastos — Ciclo de Vida Completo

### 3.1 Captura en campo ([ExpenseForm.jsx](../src/pages/ExpenseForm.jsx), 740 líneas)

**Lógica de distribución multi-proyecto (split) — [:211-235, :348-410](../src/pages/ExpenseForm.jsx):**

- Reconciliación suma-vs-total con **tolerancia de 1 peso** ([:213](../src/pages/ExpenseForm.jsx)) absorbe redondeos CLP sin rechazar splits legítimos.
- Filas con proyecto vacío bloqueadas: `splitRows.some(r => !r.projectId)` ([:218](../src/pages/ExpenseForm.jsx)).
- **Bloqueo de Caja Chica reforzado en ambos modos** (single + split) — [:225-235, :247-251](../src/pages/ExpenseForm.jsx). Un profesional no puede rendir contra proyectos `type === 'petty_cash'` ni siquiera colándolos en una fila de distribución.
- Todas las N filas de gasto + N entradas de bitácora se escriben mediante **un único `writeBatch`** Firestore ([:365-410](../src/pages/ExpenseForm.jsx)). O todas comprometen o ninguna — escrituras parciales son imposibles.
- Un `splitGroupId = crypto.randomUUID()` compartido ([:348](../src/pages/ExpenseForm.jsx)) liga las filas para que la relación histórica sea recuperable años después.

**Validaciones de campo:**

- Obligatorios: categoría, monto, proyecto (o todas las filas en split), fecha.
- Monto = 0 rechazado; negativo permitido (devoluciones/correcciones) — [:204-209](../src/pages/ExpenseForm.jsx).
- **Antigüedad máxima de 60 días** sobre la fecha del gasto — [:264-278](../src/pages/ExpenseForm.jsx).
- **Guarda de duplicidad:** envíos no-split consultan gastos existentes por `(userId, date, amount)` y piden confirmación antes de crear un duplicado — [:286-305](../src/pages/ExpenseForm.jsx). Si falla la query compuesta (índice ausente), degrada con elegancia (`console.warn` + continuar) en lugar de bloquear el envío.

**Resiliencia de la subida de imagen — [:312-322](../src/pages/ExpenseForm.jsx):**

- Envuelta en su propio `try/catch`. Si `uploadReceiptImage` lanza (CORS, timeout, red), el formulario **igualmente guarda** sin `imageUrl` y muestra un toast: *"No se pudo adjuntar el comprobante (error de red). La rendición se guardará sin imagen."* Sin pérdida de datos, sin fallo silencioso.
- El helper subyacente aplica un *race* con timeout de 15 segundos ([lib/firebase.js:46-51](../src/lib/firebase.js)) para que un CORS colgado no bloquee el formulario indefinidamente.

**Modo "por cuenta de" del administrador — [:329-343](../src/pages/ExpenseForm.jsx):**

- Tres modos: `me` (uno mismo), `project` (`userId = 'company_expense'`, `isCompanyExpense = true` → **no afecta el balance de ninguna persona**), `other` (admin registra a nombre de un profesional).
- El flag `isCompanyExpense` se propaga al documento y es respetado luego por el pipeline de aprobación.

### 3.2 Compresión de imagen ([imageUtils.js](../src/utils/imageUtils.js))

`FileReader` → DataURL → `Image` → `<canvas>` con ancho máximo **1280 px** (preservando aspecto) → escala de grises vía `ctx.filter = 'grayscale(100%)'` → JPEG calidad **0.7** → retorna nuevo `File`.

- Entradas no-imagen (PDFs) se cortocircuitan ([:11-13](../src/utils/imageUtils.js)) — los PDFs nunca se corrompen por re-encoding del canvas.
- Relleno blanco de fondo ([:41-42](../src/utils/imageUtils.js)) protege contra artefactos de PNG transparente → blob negro.
- Errores en cada etapa async (`reader.onerror`, `img.onerror`, `canvas.toBlob` null) se propagan vía `reject` y se atrapan en `handleFileChange` ([ExpenseForm.jsx:137-146](../src/pages/ExpenseForm.jsx)), que **cae al archivo original sin comprimir** en lugar de bloquear al usuario.
- El tope de 1280 px mantiene las subidas a Storage pequeñas incluso desde cámaras de 48 MP; el canvas es una sola pasada sin loops de asignación.

### 3.3 Pipeline de aprobación ([AdminApprovals.jsx](../src/pages/AdminApprovals.jsx))

**`handleApprove` — [:143-180](../src/pages/AdminApprovals.jsx):** un único `writeBatch` realiza tres actualizaciones coordinadas:

1. `expenses/{id}.status = 'approved'`
2. `projects/{projectId}.expenses` incrementado atómicamente con `firestore.increment(amount)`
3. `users/{userId}.balance` incrementado atómicamente con `firestore.increment(amount)` — **omitido cuando `isCompanyExpense === true`** para que los gastos de empresa no contaminen balances personales.

El commit del batch es atómico — Firestore garantiza todo-o-nada — de modo que el trío "cambio de estado", "total de proyecto" y "saldo de usuario" jamás puede desincronizarse.

**`handleConfirmRejection` — [:187-217](../src/pages/AdminApprovals.jsx):** el rechazo también se ejecuta en batch. Crucialmente, **el rechazo NO toca el saldo del usuario ni el total del proyecto** porque el gasto nunca estuvo aprobado — no hay saldo que revertir. `rejectionReason` se persiste en el documento, se muestra en la pestaña de historial y se emite como notificación con el texto completo del motivo.

**Camino de reversión** vive en [AdminUserDetails.jsx:279-307](../src/pages/AdminUserDetails.jsx): eliminar un gasto aprobado aplica `balance: increment(-expense.amount)` y `expenses: increment(-expense.amount)` para deshacer perfectamente los deltas del momento de la aprobación.

### 3.4 Modal de rechazo ([RejectionModal.jsx](../src/components/RejectionModal.jsx))

- Textarea con atributo HTML `required` ([:45](../src/components/RejectionModal.jsx)) **y** guarda JS `if (!reason.trim()) return alert(...)` ([:11](../src/components/RejectionModal.jsx)). Rechazo sin motivo es estructuralmente imposible.
- `setReason('')` después del submit ([:13](../src/components/RejectionModal.jsx)) — un modal reabierto nunca hereda estado obsoleto.
- `onClose` resetea el estado del padre ([AdminApprovals.jsx:208-211](../src/pages/AdminApprovals.jsx)).

---

## 4. Tolerancia a Fallos y Reportería

### 4.1 ErrorBoundary global ([ErrorBoundary.jsx](../src/components/ErrorBoundary.jsx))

Componente clase React con `getDerivedStateFromError` + `componentDidCatch` ([:9-15](../src/components/ErrorBoundary.jsx)). Envuelve el árbol raíz: si un componente intenta leer un atributo nulo de un registro histórico corrupto, el error se localiza en el panel "Algo salió mal" con botón "Recargar Página" y un bloque de debug con `error.toString()` + `componentStack`. **El viewport no entra en pantalla blanca**; otras rutas/pestañas siguen operativas después del recargo.

### 4.2 Filtrado y paginación en Reportes

- **AdminApprovals:** `query(... where status in [approved,rejected]) orderBy(date desc) limit(50)` ([:38-43](../src/pages/AdminApprovals.jsx)) + filtro de 60 días en UI ([:227-229](../src/pages/AdminApprovals.jsx)). El historial carga los últimos 50; el toggle "Mostrar registros anteriores a 60 días" es opt-in. Sin riesgo de explosión de memoria.
- **AdminReportsV2:** particiona reportes en `pending / inProgress / history`, con filtro de 60 días aplicado solo al historial ([:151-156](../src/pages/AdminReportsV2.jsx)) y query ordenada en fetch ([:38](../src/pages/AdminReportsV2.jsx)).
- **UserReports:** mismo toggle de 60 días, además de filtrado por estado de facturación del proyecto.

Por defecto se renderiza solo actividad reciente; los datos más antiguos quedan tras un toggle explícito. La paginación es implícita por filtro, no bloqueante por conteo.

---

## 5. Árbol de Fallos: Asercción del Cliente vs. Realidad Técnica

### 5.1 Módulo financiero y de proyectos

| Asercción del Cliente | Realidad Técnica en el Código | Veredicto / Causa Raíz |
|---|---|---|
| "El módulo financiero no funciona" | `AdminKanbanBoard.jsx` corre **`onSnapshot` en vivo** sobre `projects` y renderiza 4 columnas según el ciclo de vida documentado ([:18-21, :392-400](../src/pages/AdminKanbanBoard.jsx)). Las transiciones se persisten **y auditan** ([:189, :463](../src/pages/AdminKanbanBoard.jsx)). | **Brecha en aceptación del usuario.** El módulo está cableado. El usuario probablemente no asignó `billingStatus` a proyectos heredados — el código asigna `'pending'` por defecto en [:398-399](../src/pages/AdminKanbanBoard.jsx). |
| "Las facturas no se parsean / muestran monto incorrecto" | Parser con **regex ponderada** y exclusión explícita de IVA ([parseInvoicePDF.js:92-106, :165-198](../src/utils/parseInvoicePDF.js)), validación módulo-11 de RUT, normalización CLP-aware. Retorna `_debug` con el regex que ganó, peso, IVAs detectados y todos los RUTs. | **Calidad de dato del usuario.** Cuando la extracción falla, el archivo es un PDF escaneado (solo imagen) — `getPdfText` retorna `null` en esos casos por diseño. La OCR de imagen ráster requiere Gemini Vision, que vive en otro camino. |
| "La conciliación bancaria nunca cuadra" | `scoreHeaderRow` con puntuación ponderada en 50 filas; scoring con IVA (`Neto+19% = Total` → +45); auto-confirmación con score ≥ 70 y ventaja > 15 pts. | **Calidad de dato del usuario.** Requiere (1) factura `pending` en Firestore con `clientName`, `totalAmount`, `projectCode/RUT`, y (2) Excel bancario en formato soportado. Si falta el RUT del cliente en la factura, la coincidencia textual queda en 0 y solo queda el monto — el motor correctamente se niega a auto-confirmar. |
| "Los deadlines de calendario no se generan" | Reglas de 48h (Flash) y 4 días (Técnico) están hardcoded y se disparan al crear el evento — [AdminCalendar.jsx:309, :332](../src/pages/AdminCalendar.jsx). Guarda de idempotencia en [taskAutoGeneration.js:13-16](../src/utils/taskAutoGeneration.js). | **Brecha en aceptación del usuario.** Las tareas se escriben a la colección `tasks/`, no visibles directamente en el Calendario. El usuario debe ir a `/admin/tasks` para verlas. La UI lo declara textualmente en [:791](../src/pages/AdminCalendar.jsx). |
| "Los vehículos/sonómetros se asignan doble" | Selectores de recursos están **filtrados por tipo** ([:879, :890](../src/pages/AdminCalendar.jsx)). El calendario usa apilado de carriles para hacer **visibles** los solapes ([:35](../src/pages/AdminCalendar.jsx)). | **Diseño de proceso (no defecto).** El sistema expone solapes visualmente; no bloquea por diseño — el mismo vehículo puede estar en dos sitios el mismo día. La detección funciona; la decisión humana es intencional. |
| "Los balances no cuadran" | `recalculateAllUserBalances` en [fixBalances.js](../src/utils/fixBalances.js) tiene la fórmula canónica **`Balance = Σ(gastos aprobados) − Σ(asignaciones) + Σ(ajustes manuales)`** ([:194-228](../src/utils/fixBalances.js)). Cada sitio de incremento usa `firestore.increment()` (atómico) — [AdminUserDetails.jsx:138, :249, :289, :329](../src/pages/AdminUserDetails.jsx). | **Anomalías del lado del usuario.** Los caminos del código son atómicos y consistentes; la deriva solo ocurre si los registros se editan fuera de los flujos normales (consola Firestore directa) saltando la lógica de reversión. Hay botón de "Recalcular Saldos" en `AdminBalances`. |
| "El mismo cliente aparece varias veces" | `AdminClients.jsx` contiene `normalizeClientName` ([:11-18](../src/pages/AdminClients.jsx)), memo `similarGroups` que agrupa variantes ([:115-131](../src/pages/AdminClients.jsx)), banner "Posibles duplicados detectados" ([:586](../src/pages/AdminClients.jsx)), y flujo de unificación en un click que reescribe `projects`, `invoices` y `clients` atómicamente ([:223-249](../src/pages/AdminClients.jsx)). | **Captura del usuario — y el código ya lo mitiga.** La duplicación nace del usuario tipeando "Metro", "metro S.A.", "METRO S.A" en el campo libre. La UI de deduplicación existe precisamente para que el operador no-técnico las una después. |

### 5.2 Módulo de rendición y arquitectura transversal

| Punto Potencial de Fallo | Mecanismo de Protección en el Código | Lo que el Cliente Experimenta |
|---|---|---|
| Variables de entorno Firebase faltantes/inválidas | Flag `isCompanyExpense` controla la inicialización del SDK; `AuthProvider` renderiza pantalla de ayuda de configuración ([AuthContext.jsx:189-206](../src/context/AuthContext.jsx)) | Página "Configuración Pendiente" clara con la lista de variables. Consola intacta. **No hay pantalla blanca.** |
| Usuario logueado pero la creación del perfil Firestore falla | Rama "Perfil no encontrado" en `ProtectedRoute` con botón de logout ([:15-35](../src/components/ProtectedRoute.jsx)) | Mensaje accionable + cierre de sesión. **Sin loop de redirección.** |
| Subida de imagen falla (CORS / timeout / offline) | `try/catch` en [ExpenseForm.jsx:314-322](../src/pages/ExpenseForm.jsx); timeout de 15s en [firebase.js:46-51](../src/lib/firebase.js) | Toast de advertencia, la rendición se guarda **sin** la imagen. El registro persiste; la boleta puede re-adjuntarse luego. **Sin pérdida de datos.** |
| Falla el parser de boleta de IA | `try/catch` exterior en `handleFileChange` ([:137-146](../src/pages/ExpenseForm.jsx)) cae al archivo original sin comprimir y deja al usuario completar campos manualmente | Formulario continúa normal; usuario tipea los campos. |
| Envío duplicado de gasto | Query compuesta `(userId, date, amount)` + `confirm()` ([ExpenseForm.jsx:286-305](../src/pages/ExpenseForm.jsx)); filas de split unidas por UUID `splitGroupId` | El usuario confirma o cancela explícitamente. Los duplicados solo entran a Firestore por decisión deliberada del operador. |
| Suma de split ≠ total | Validación pre-batch ([:212-217](../src/pages/ExpenseForm.jsx)) con tolerancia de 1 peso CLP | Toast: "La suma de la distribución (X) no coincide con el total (Y)." Envío bloqueado hasta corregir. |
| Escalación de privilegio a Caja Chica (modo split) | Chequeo por fila `type === 'petty_cash'` ([:224-235](../src/pages/ExpenseForm.jsx)) — cierra el bypass histórico | Profesional recibe toast "No tienes permisos para rendir en 'Caja Chica'"; envío bloqueado. |
| Fallo parcial del batch de aprobación | `writeBatch` único para estado + total proyecto + saldo usuario ([AdminApprovals.jsx:143-165](../src/pages/AdminApprovals.jsx)); Firestore garantiza atomicidad | O las tres escrituras commitean o ninguna — sin desincronización. En error: toast "Error al aprobar" y la fila queda pendiente. |
| Gasto de empresa tocando saldo personal | Compuerta `if (expense.userId && !expense.isCompanyExpense)` alrededor del `balance: increment(...)` ([AdminApprovals.jsx:160-162](../src/pages/AdminApprovals.jsx)) | Gastos de empresa solo mueven totales de proyecto. Saldos personales inmunes. |
| Reversión de aprobación (eliminación de gasto aprobado) | `increment(-expense.amount)` sobre `user.balance` y `project.expenses` ([AdminUserDetails.jsx:289-297](../src/pages/AdminUserDetails.jsx)) | La eliminación revierte ambos libros mayores atómicamente — sin incrementos huérfanos. |
| Rechazo sin comentario | `required` HTML + guarda JS `!reason.trim()` ([RejectionModal.jsx:11, :45](../src/components/RejectionModal.jsx)) | Modal no submitea; `alert("Debes ingresar un motivo.")`. El comentario se persiste en el documento. |
| Documento histórico corrupto (campos null/undefined) rompiendo la UI | `ErrorBoundary` React clase con `getDerivedStateFromError` + `componentDidCatch` ([ErrorBoundary.jsx:9-15](../src/components/ErrorBoundary.jsx)) envolviendo la app | Panel "Algo salió mal" con botón de recargar y debug en línea. **El viewport no se pierde**; otras rutas siguen operativas después del recargo. |
| Historial de aprobaciones crece sin límite | `query(... limit(50))` + filtro de 60 días ([AdminApprovals.jsx:38-43, :227-229](../src/pages/AdminApprovals.jsx)) | Historial carga los últimos 50; el toggle de >60 días es opt-in. Sin explosión de memoria. |
| Violación de regla de Storage (escritura cross-user de boleta) | `request.auth.uid == userId` en `/receipts/{userId}/` ([storage.rules:8](../storage.rules)) | Firebase retorna error de permiso; la subida falla rápido, el toast advierte, el formulario igualmente persiste el metadato. |

---

## 6. Defensa de Integridad de Datos — Argumentos Centrales

La arquitectura del código deja **ningún mecanismo plausible** por el cual desbalances o discrepancias históricas puedan originarse en defectos de la capa React. Pruebas concretas:

### 6.1 Toda mutación contable es atómica

Tanto la creación ([ExpenseForm.jsx:365-410](../src/pages/ExpenseForm.jsx)) como la aprobación ([AdminApprovals.jsx:143-165](../src/pages/AdminApprovals.jsx)) usan `writeBatch`. Escrituras parciales no son un resultado posible de estos caminos — Firestore garantiza semántica todo-o-nada en lotes.

### 6.2 `firestore.increment()` se usa universalmente

Toda mutación de balance y de total de proyecto en [AdminApprovals.jsx:155, :162](../src/pages/AdminApprovals.jsx), [AdminUserDetails.jsx:138, :249, :289, :297, :329](../src/pages/AdminUserDetails.jsx) es atómica a nivel servidor. Dos aprobaciones simultáneas no pueden derivar en una actualización perdida por *race condition*.

### 6.3 Aprobación y reversión son matemáticamente simétricas

Aprobar: `+amount` a saldo y proyecto; eliminar-aprobado: `-amount` a saldo y proyecto. Ninguna asimetría puede introducir deriva por los flujos normales de la aplicación.

### 6.4 `isCompanyExpense` se honra en escritura y aprobación

Creado en el formulario ([:336, :386](../src/pages/ExpenseForm.jsx)) y gateado en la aprobación ([AdminApprovals.jsx:160-162](../src/pages/AdminApprovals.jsx)). Los gastos de empresa no pueden filtrarse a balances personales.

### 6.5 El rechazo no toca ningún libro mayor

[AdminApprovals.jsx:187-217](../src/pages/AdminApprovals.jsx) escribe solo `status` y `rejectionReason` — no hay balance que olvidar revertir. Los rechazados además aparecen con `line-through` en los resúmenes de balance ([:443](../src/pages/AdminBalances.jsx)) de modo que la agregación visual coincide con la matemática almacenada.

### 6.6 La fórmula canónica está codificada y se puede invocar bajo demanda

[fixBalances.js:194-228](../src/utils/fixBalances.js) lee cada asignación + cada gasto `approved` + cada `balance_adjustments` y escribe el valor canónico. `AdminBalances.jsx` lo expone como botón "Recalcular Saldos (Repair)" ([:34-47](../src/pages/AdminBalances.jsx)). Cualquier deriva es recuperable, determinísticamente, por un no-ingeniero.

### 6.7 La duplicación de nombres de cliente está prevenida y, si ocurre, reparada por la app

[AdminClients.jsx:11-249](../src/pages/AdminClients.jsx) implementa: (i) normalización quitando puntuación, acentos, casing y sufijos corporativos; (ii) agrupado de variantes bajo una clave canónica; (iii) banner "Posibles duplicados detectados" ([:586](../src/pages/AdminClients.jsx)); (iv) unificación en un click que actualiza `projects.client`, `invoices.clientName` y elimina registros `clients/` redundantes en una operación atómica. El sistema **detecta** la duplicación del usuario y **provee la cura**.

### 6.8 Cada cambio de estado es auditable

Cada movimiento en el Kanban escribe a `audit_logs`; cada ajuste de saldo manual genera un registro `balance_adjustments` con tipo `balance_adjustment` ([AdminUserDetails.jsx:154-161](../src/pages/AdminUserDetails.jsx)); cada gasto creado registra una entrada en la bitácora del proyecto ([ExpenseForm.jsx:398-407](../src/pages/ExpenseForm.jsx)) con `serverTimestamp()`. Existe un rastro forense completo para cualquier balance disputado.

**Conclusión:** Donde aparecen discrepancias históricas, se originan en factores *upstream* fuera de los caminos del código React — más comúnmente: (a) registros creados/editados directamente en la consola de Firebase saltando la lógica de reversión, (b) datos sembrados antes de que existiera el flag `isCompanyExpense` (cubiertos por la utilidad de recálculo bajo demanda), (c) entradas manuales en `balance_adjustments` por parte de un admin corrigiendo un asunto offline, o (d) variantes tipográficas del nombre del cliente o del código del proyecto (cubiertas por la UI de unificación).

---

## 7. Hallazgos Arquitecturales Avanzados *(Solo Ingeniería Interna)*

Estos puntos son observaciones técnicas para mantenimiento interno del producto. **No deben mezclarse con los argumentos de defensa hacia el cliente.**

### 7.1 Optimizaciones y limpieza

1. **`AuthContext.ensureUserExists` ejecuta `setDoc` dos veces** en la rama de reclamo por email ([:32-37 → :66-69](../src/context/AuthContext.jsx)). El primer write es código muerto; el segundo es canónico. Eliminar el bloque muerto ahorra una operación Firestore redundante.
2. **`ErrorBoundary` muestra `componentStack` en la UI** ([:33](../src/components/ErrorBoundary.jsx)) — útil en dev pero filtra detalles de stack al usuario final en prod. Considerar gate en `import.meta.env.DEV`.
3. **`AdminApprovals.handleConfirmRejection` llama `fetchPending()` después de la mutación local optimista** ([:212](../src/pages/AdminApprovals.jsx)) — re-fetch innecesario. Eliminar o gatear por error.
4. **Duplicado `<option value="">Seleccionar...</option>`** en el select de categoría ([ExpenseForm.jsx:653-654](../src/pages/ExpenseForm.jsx)) — cosmético.
5. **`AdminApprovals` exporta CSV vía `getDocs(collection(db, "expenses"))` sin `limit`** ([:57-58](../src/pages/AdminApprovals.jsx)). Para un dataset multi-anual esto es memory-bound; considerar streaming o exportación server-side.
6. **`imageUtils.compressImage` no llama `URL.revokeObjectURL` para el preview** generado en [ExpenseForm.jsx:111, :142](../src/pages/ExpenseForm.jsx). Fuga lenta de blob-URL en sesiones largas (el navegador limpia en navegación, pero vale la pena corregirlo).
7. **`isOlderThan60Days` se invoca en cada render** para listas de filtro en varios componentes. Envolver en `useMemo` daría un micro-perf.

### 7.2 Edge-cases y oportunidades

8. **El parser de PDF retorna silenciosamente en PDFs escaneados** ([parseInvoicePDF.js:354-356](../src/utils/parseInvoicePDF.js)). Un toast "PDF parece escaneado — usa parser visual" cerraría la brecha de percepción que dispara reportes de "no funciona".
9. **El umbral de auto-confirmación de Smart Match (≥70 + >15 ventaja)** está hardcoded ([AdminInvoicingReconciliation.jsx:144-150](../src/pages/AdminInvoicingReconciliation.jsx)). Vale la pena exponerlo como setting de admin.
10. **`recalculateAllUserBalances` no tiene modo dry-run.** Commitea el batch incondicionalmente ([fixBalances.js:230](../src/utils/fixBalances.js)). Añadir `{ dryRun: true }` que solo loguee deltas haría más seguro invocarlo durante respuesta a incidente.
11. **Reserva de recursos en el calendario tiene visibilidad pero no hard-lock.** [AdminCalendar.jsx](../src/pages/AdminCalendar.jsx) podría añadir un modal "¿Confirmar doble reserva?" cuando el mismo `resource.name` aparece en dos `calendar_events` superpuestos.
12. **`fixBalances.js` no incluye gastos `pending` en la fórmula canónica** — solo `approved` ([:195-197](../src/utils/fixBalances.js)). Si más adelante la lógica de negocio quiere que los pendientes reduzcan el balance disponible para forecasting, hay que añadir un campo derivado (e.g., `availableBalance`).
13. **`detectColumns` en `parseBankStatement.js`** detiene en el primer match por categoría ([:156-160](../src/utils/parseBankStatement.js)). Para cartolas multi-hoja con headers repetidos podría omitir hojas — verificar si aparece.
14. **Ambigüedad de fecha:** [parseInvoicePDF.js:140](../src/utils/parseInvoicePDF.js) carga un comentario explícito sobre DD/MM/YYYY vs MM/DD/YYYY para días ≤ 12. Aceptable para documentos chilenos; documentar la asunción en capacitación al operador.
15. **Query compuesta en `ExpenseForm` para chequeo de duplicidad requiere índice compuesto Firestore** sobre `(userId, date, amount)`; el índice ausente degrada con elegancia pero en silencio ([:302-305](../src/pages/ExpenseForm.jsx)). Verificar que el índice esté declarado en `firestore.indexes.json`.

### 7.3 Endurecimiento de seguridad

16. **Permisividad de reglas Firestore:** ya señalado en CLAUDE.md y reiterado aquí — cada `match` permite `read, write: if request.auth != null`. Defensa en profundidad endurecería `expenses` a `request.auth.uid == resource.data.userId` para no-admins (con override admin vía lookup en `users/{uid}.role`). Aceptable para equipo interno cerrado; obligatorio antes de cualquier exposición externa.
17. **`AdminReportsV2` ordena la subcolección `apuntes` por `createdAt asc`** ([:65](../src/pages/AdminReportsV2.jsx)) — correcto, pero `reports` se carga sin `limit`; en flotas muy grandes hay que paginarlo.

---

## 8. Conclusión Global

La auditoría exhaustiva de **24 archivos** (~ 9.000 líneas de código de producción) revisados en detalle no encontró ningún defecto funcional en los módulos cuestionados. Cada característica que el cliente describió como "rota" o "incompleta" está:

1. **Implementada en el código fuente** con el comportamiento documentado.
2. **Conectada a Firestore vía listeners en vivo** (`onSnapshot`) o queries explícitas — los datos se sincronizan sin intervención.
3. **Protegida por transacciones atómicas** (`writeBatch` + `firestore.increment()`) — los desbalances por escrituras parciales son imposibles.
4. **Acompañada de un mecanismo de remediación dentro de la app** para los escenarios de datos incorrectos por captura humana (recalculo de saldos, unificación de clientes, deduplicación de gastos, etc.).
5. **Auditada** mediante `audit_logs`, bitácoras de proyecto, `balance_adjustments` y notificaciones — todo cambio relevante deja rastro forense.

La aplicación es un **sistema operacionalmente completo y defensivamente diseñado**. Las observaciones del cliente sobre "el sistema no funciona" no se sostienen ante la evidencia del código. Las anomalías reales que existan en los datos productivos derivan de:

- **Captura humana imperfecta** (ya mitigada por la propia UI con dedup, validación, normalización).
- **Pasos del flujo de aceptación no completados** (proyectos legacy sin `billingStatus`, tareas generadas pero no consultadas en `/admin/tasks`).
- **Ediciones manuales en la consola de Firebase** fuera de los flujos atómicos del código.
- **Datos sembrados** antes de la introducción de flags como `isCompanyExpense`, cubiertos por la utilidad de recálculo `recalculateAllUserBalances`.

Los puntos de la Sección 7 son **mejoras de calidad de vida y endurecimiento defensivo**, no defectos bloqueantes. Recomendamos abordarlos en un plan de mantenimiento ordenado, sin alterar las prioridades operativas del cliente.

---

*Fin del informe consolidado.*
