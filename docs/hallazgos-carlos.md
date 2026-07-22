# Hallazgos reunión Carlos — 3 de julio

Documento de validación para Carlos y Vero. Cada hallazgo describe qué cambió,
cómo probarlo y qué debe pasar (o no pasar).

> Fecha de entrega: 22 de julio de 2026
> Fuente: reunión Carlos / Edmundo del 3 de julio

Marca cada punto con ✅ cuando lo hayas verificado. Si algo no funciona como
esperabas, anotalo al final en "Observaciones".

---

## 1. Saldos por proyecto: filtro real de 60 días

**Qué cambió**
- En la ficha de cada profesional (Admin → Usuarios → nombre), la tabla
  "Resumen por Proyecto" ahora oculta **todo proyecto cuyo último movimiento
  sea mayor a 60 días**, sin importar el saldo (cero o no).
- Los proyectos recientes (últimos 60 días) siempre se muestran, incluso los
  que tienen saldo cero — así ves los cierres del mes en curso.
- Al pie de la tabla aparece un botón
  **"Mostrar registros anteriores a 60 días (N)"**. El número entre paréntesis
  coincide exactamente con la cantidad de filas que se revelan al activarlo.
- El criterio de "60 días" se calcula sobre la fecha del último movimiento
  (rendición o viático), no sobre la fecha de inicio del proyecto.

**Cómo probarlo**
1. Ir a **Admin → Usuarios → [alguien con historial largo]**.
2. Bajar hasta "Resumen por Proyecto". Deberías ver:
   - Proyectos con actividad reciente (últimos 60 días): siempre visibles
     (incluye los de saldo cero).
   - Proyectos viejos (con o sin saldo): ocultos por defecto.
3. Click en **"Mostrar registros anteriores a 60 días (N)"** al pie de la tabla.
4. Aparecen exactamente N proyectos adicionales — incluidos los antiguos con
   saldo cero, que ahora sí se pueden auditar. El botón cambia a **"Ocultar
   registros antiguos"** para volver al estado inicial.

**Estado esperado**
- ✅ El caso Valencia (desde enero, saldo cero) queda oculto por defecto pero
  aparece al activar el toggle — auditable.
- ✅ Un proyecto de junio con saldo 0 sigue visible siempre.

---

## 2. Vincular gastos: selección automática

**Qué cambió**
- En "Historial de Facturación → click en una factura → Vincular Gastos",
  todos los gastos aprobados del proyecto de esa factura vienen
  **preseleccionados** (checkboxes marcados).
- Se agregaron dos accesos rápidos arriba del listado:
  - **Todos**: marca todos los gastos.
  - **Ninguno**: los desmarca.
- Siempre podés desmarcar manualmente los que no correspondan.

**Cómo probarlo**
1. Ir a **Admin → Historial de Facturación**.
2. Click en una factura que tenga gastos aprobados en su proyecto.
3. Click en **"Vincular Gastos"**.
4. Verificar que todos los checkboxes aparecen marcados.
5. Desmarcar 1–2 gastos → el contador del botón "Confirmar Vinculación (N)" baja.
6. Click en **"Ninguno"** → todos se desmarcan, el botón queda deshabilitado.
7. Click en **"Todos"** → todos se marcan de nuevo.

**Estado esperado**
- ✅ Ya no necesitás hacer clic en cada checkbox uno por uno.

---

## 3. Conciliación bancaria: glosa completa y campos visibles

**Qué cambió**
- En la vista de conciliación (**Admin → Conciliación**), la columna
  "Descripción" ahora muestra la **glosa completa** del movimiento en varias
  líneas (ya no se corta con "…").
- Debajo de cada glosa, cuando se detecta un RUT en el texto, aparece un
  pequeño chip **"RUT: XX.XXX.XXX-X"**.
- En el panel de sugerencias de cada movimiento, cada factura muestra:
  cliente, RUT, código de proyecto, nombre del proyecto, recurrencia
  (mensual/etc.), monto y fecha de emisión.

**Cómo probarlo**
1. Ir a **Admin → Conciliación**.
2. Verificar que las glosas de los movimientos se leen completas (ninguna
   cortada con "…").
3. Para movimientos cuya glosa contenga un RUT (ej. "TRANSF DE 76.xxx.xxx-x"),
   verificar que aparece el chip **"RUT: …"** debajo.
4. Click en el ícono ⚡ de un movimiento con sugerencias → cada factura muestra
   todos los campos indicados.

**Estado esperado**
- ✅ Podés hacer el match visual sin necesidad de abrir la factura ni volver
  a la vista bancaria.

---

## 4. Detección automática de RUT en la glosa bancaria

**Qué cambió**
- Al subir una cartola nueva, la app detecta y guarda automáticamente el RUT
  del cliente presente en la glosa del banco (cuando existe).
- Para las cartolas subidas **antes** de este cambio, el RUT se calcula al
  vuelo cada vez que abrís la vista (no requiere volver a subir la cartola).

**Cómo probarlo**
1. Subir una cartola nueva.
2. Buscar un movimiento cuya glosa contenga un RUT.
3. El chip **"RUT: XX.XXX.XXX-X"** aparece bajo la descripción.
4. Repetir con un movimiento cargado hace tiempo (antes del cambio):
   también debería mostrar el chip si la glosa tiene RUT.

**Estado esperado**
- ✅ Glosas sin RUT no muestran el chip (no aparece "RUT: null").

---

## 5. Nueva lógica de conciliación (más estricta)

**Qué cambió**
- Se eliminó el sistema de "puntuación por similitud" que sugería facturas
  con montos aproximados.
- Reglas nuevas:
  - **Monto no coincide exactamente** (tolerancia de $1 por redondeo) → **no
    se sugiere nada**.
  - **Monto exacto + RUT coincide + nombre del cliente aparece en la glosa** →
    match automático **verde**, pero se deja **en "Conciliaciones Listas"**
    para que revises y hagas click en **"Confirmar"**. Nada se escribe en la
    base de datos sin tu confirmación explícita.
  - **Monto exacto + RUT o nombre coinciden pero no ambos** → **bandera
    amarilla**, requiere confirmación manual.
  - **Monto exacto sin coincidencias adicionales** → **bandera amarilla**.
- El caso "Casa Santa Sofía" (donde el cliente registrado se llama distinto
  al proyecto): ahora si el RUT y el monto coinciden pero el nombre no,
  levanta la bandera amarilla en vez de sugerir con puntuación 65 mezclada
  con otras opciones irrelevantes.

**Cómo probarlo**
1. Ir a **Admin → Conciliación**.
2. Verificar los siguientes escenarios:
   - Cargar cartola con un movimiento cuyo monto exacto matchea una factura
     Y la glosa contiene el RUT y nombre del cliente → aparece staged en
     **"Conciliaciones Listas"** (ícono ✅ verde). **Sigue pendiente** hasta
     que hagas click en **"Confirmar"**.
   - Movimiento con monto exacto pero RUT o nombre distintos → aparece
     ícono ⚡ amarillo con la factura como sugerencia, requiere confirmar.
   - Movimiento con monto que NO coincide exacto con ninguna factura → NO
     aparece ninguna sugerencia (sin ícono ⚡).

**Estado esperado**
- ✅ Ya no aparecen sugerencias con montos aproximados o similares.
- ✅ Confirmar el caso Casa Santa Sofía: amarilla, no verde silenciosa.
- ✅ Ninguna conciliación queda escrita en la base sin haber pasado por
  "Confirmar".

---

## 6. Consolidación de proyectos duplicados (el bug de los $5.569)

**Qué cambió**
- Diagnóstico honesto del bug: el proyecto que aparecía dos veces con saldo
  $5.569 **no se debía a reasignaciones dobles**, sino a que existían
  **dos documentos de proyecto distintos** en Firestore con el mismo nombre,
  creados en iteraciones anteriores. Como el resumen agrupa por `projectId`,
  cada documento se contaba por separado.
- Ahora hay una **utilidad de consolidación** para administradores:
  **Admin → Proyectos → botón "Detectar proyectos duplicados"** (arriba del
  listado). Detecta grupos de proyectos que comparten nombre normalizado
  (mayúsculas, tildes y espacios) y/o código, dentro de la misma recurrencia.
- Para cada grupo elegís el proyecto **canónico** (el que se conserva) y hacés
  click en **Consolidar**. La app pide confirmación y luego:
  - Reasigna al canónico las referencias en `allocations`, `expenses`,
    `invoices`, `tasks`, `calendar_events` e `reports` (escritura por lotes,
    máximo 400 por commit).
  - Registra un log en la bitácora del proyecto canónico y en `audit_logs`.
  - Elimina el/los documentos duplicados solo después de que todas las
    reasignaciones hayan commiteado.
- Además se mantienen (sin cambios):
  - **Guard anti-doble envío** en "Reasignar Recursos": si intentás la misma
    reasignación (mismo origen, destino y monto) dentro de un minuto, aparece
    el mensaje **"Ya existe una reasignación idéntica reciente..."**.
  - **Dedup en la vista**: allocations duplicadas dentro del mismo minuto se
    consolidan visualmente en "Resumen por Proyecto".

**Cómo probarlo**
1. Ir a **Admin → Proyectos**.
2. Click en **"Detectar proyectos duplicados"** (arriba a la derecha del
   listado).
3. Deberías ver el grupo con el proyecto de los $5.569 duplicado. Elegí
   el canónico (el que quede) y click en **Consolidar** → confirmá.
4. Volver a **Admin → Usuarios → [usuario] → Resumen por Proyecto**. El
   proyecto aparece **una sola vez con saldo 0** (o el saldo real, sin doble
   conteo).
5. Probar el guard anti-doble-envío: en el mismo usuario, abrir
   **Reasignar Recursos**, hacer una reasignación e intentar repetirla igual
   dentro de un minuto → aparece la advertencia.

**Estado esperado**
- ✅ El proyecto de los $5.569 aparece una sola vez, con el saldo neto correcto.
- ✅ Nuevos duplicados quedan bloqueados por el guard anti-doble-envío.

---

## 7. Reset de Facturación ampliado (y gating de super admin)

**Qué cambió**
- El botón **"Reset Facturación"** (Historial de Facturación, arriba a la
  derecha) ahora borra:
  - Todas las facturas
  - Todos los movimientos bancarios
  - Todas las cartolas subidas
  - Los gastos vinculados vuelven a estado "Pendiente de facturar"
- La confirmación sigue requiriendo escribir **`BORRAR TODO`** en mayúsculas.
- El modal de confirmación ahora lista explícitamente los 4 elementos que se
  van a borrar.
- **Nuevo gating por rol**: el botón **solo aparece para cuentas marcadas
  como "Super administrador"** (campo `isSuperAdmin: true` en el documento del
  usuario). Cualquier otro admin no lo ve, y aunque intentara invocar la
  acción, el cliente y las reglas de Firestore (`allow delete` en `invoices`,
  `bank_movements` y `bank_statements`) la rechazan.
- **Cómo habilitar el super admin** para la cuenta de Carlos:
  1. Iniciar sesión con una cuenta que ya sea super admin (o editar el
     documento del usuario en Firestore directamente para la primera vez).
  2. Ir a **Admin → Usuarios → Carlos**.
  3. En la tarjeta "Información", marcar el checkbox rojo
     **"Super administrador (puede resetear facturación)"**.
  4. Carlos debe cerrar y volver a iniciar sesión para que aparezca el botón
     "Reset Facturación".

**Cómo probarlo (¡solo cuando estén listos para arrancar limpio!)**
1. Ir a **Admin → Historial de Facturación**.
2. Click en **"Reset Facturación"** (arriba a la derecha).
3. Verificar que el modal muestra la lista de los 4 elementos que se borran.
4. Escribir **`BORRAR TODO`** y confirmar.
5. Ir a **Admin → Conciliación** → no debe haber movimientos ni cartolas.
6. Ir a **Historial de Facturación** → no debe haber facturas.
7. Ir a rendiciones aprobadas → los gastos que estaban facturados aparecen
   nuevamente como "Pendiente de facturar".

**Estado esperado**
- ✅ Ambiente completamente en cero para que Vero empiece a usarlo en
  producción.

---

## Preguntas frecuentes

**¿Se perdió algo de mi trabajo?**
No. Los cambios 1–6 no borran datos. Solo el punto 7 (Reset Facturación) es
destructivo, y solo si lo activás vos con la frase de confirmación.

**¿Qué es reversible?**
- 1, 2, 3: son puramente visuales/UX, no afectan datos.
- 4: agrega un dato (el RUT detectado) sin sobreescribir nada.
- 5: cambia cómo se sugieren matches pero no afecta las conciliaciones ya
  hechas.
- 6: previene duplicados nuevos. No modifica los históricos.
- 7: irreversible una vez ejecutado.

**Próximos pasos coordinados**
1. Validá los puntos 1–6 con datos actuales.
2. Coordinar con Vero una revisión conjunta.
3. Cuando Vero valide, ejecutar el punto 7 (Reset Facturación) para empezar
   limpio con datos productivos.

---

## Observaciones (para completar durante la validación)

| # | Hallazgo | Estado | Comentario |
|---|---|---|---|
| 1 | Saldos > filtro 60 días | ☐ | |
| 2 | Vincular gastos automático | ☐ | |
| 3 | Conciliación: campos visibles | ☐ | |
| 4 | Detección de RUT | ☐ | |
| 5 | Nueva lógica de matching | ☐ | |
| 6 | Consolidación de duplicados | ☐ | |
| 7 | Reset ampliado | ☐ | |
