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
  "Resumen por Proyecto" ahora oculta los proyectos que **ya no tienen
  movimiento hace más de 60 días y además tienen saldo cero**.
- Los proyectos recientes con saldo cero siguen visibles (pueden estar en
  proceso de cierre).
- Al pie de la tabla aparece un botón
  **"Mostrar registros anteriores a 60 días (N)"** que revela el histórico
  completo cuando lo necesites.
- El criterio de "60 días" se calcula sobre la fecha del último movimiento
  (rendición o viático), no sobre la fecha de inicio del proyecto.

**Cómo probarlo**
1. Ir a **Admin → Usuarios → [alguien con historial largo]**.
2. Bajar hasta "Resumen por Proyecto". Deberías ver:
   - Proyectos con actividad reciente (últimos 60 días): siempre visibles.
   - Proyectos viejos con saldo distinto de cero: ocultos por defecto.
   - Proyectos viejos con saldo cero: ocultos por defecto.
3. Click en **"Mostrar registros anteriores a 60 días (N)"** al pie de la tabla.
4. Aparecen todos los proyectos ocultos. El botón cambia a **"Ocultar
   registros antiguos"** para volver al estado inicial.

**Estado esperado**
- ✅ El caso Valencia (desde enero) ya no aparece por defecto.
- ✅ Un proyecto de junio con saldo 0 sigue visible.

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
    match automático **verde**.
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
     Y la glosa contiene el RUT y nombre del cliente → aparece marcado como
     conciliado automático (ícono ✅ verde).
   - Movimiento con monto exacto pero RUT o nombre distintos → aparece
     ícono ⚡ amarillo con la factura como sugerencia, requiere confirmar.
   - Movimiento con monto que NO coincide exacto con ninguna factura → NO
     aparece ninguna sugerencia (sin ícono ⚡).

**Estado esperado**
- ✅ Ya no aparecen sugerencias con montos aproximados o similares.
- ✅ Confirmar el caso Casa Santa Sofía: amarilla, no verde silenciosa.

---

## 6. Prevención de duplicados al reasignar recursos

**Qué cambió**
- Cuando reasignás fondos entre proyectos ("Admin → Usuarios → [nombre] →
  Reasignar Recursos"), la app ahora rechaza intentos duplicados: si intentás
  hacer la misma reasignación (mismo origen, destino y monto) dentro de un
  minuto, aparece una advertencia y no se registra dos veces.
- En la vista "Resumen por Proyecto", allocations duplicados por
  reasignaciones antiguas se consolidan visualmente: el saldo del proyecto se
  muestra sin el doble conteo.
- Nota importante: la base de datos histórica **no se limpia** (no se
  eliminan registros viejos), pero la vista muestra el saldo correcto.

**Cómo probarlo**
1. Ir a **Admin → Usuarios → [usuario] → Reasignar Recursos**.
2. Elegir origen, destino y monto → **Reasignar**.
3. Sin cerrar el modal, intentar hacer exactamente la misma reasignación de
   nuevo → aparece el mensaje **"Ya existe una reasignación idéntica
   reciente..."**.
4. Cerrar el modal y verificar que el saldo del proyecto (los $5.569 del
   proyecto con loop que reportaste) ahora se muestra consolidado.

**Estado esperado**
- ✅ Ya no vas a ver dos veces el mismo proyecto en el resumen por causa de
  reasignaciones dobles.

---

## 7. Reset de Facturación ampliado

**Qué cambió**
- El botón **"Reset Facturación"** (Historial de Facturación, arriba a la
  derecha, solo visible para vos) ahora borra:
  - Todas las facturas
  - Todos los movimientos bancarios
  - Todas las cartolas subidas
  - Los gastos vinculados vuelven a estado "Pendiente de facturar"
- La confirmación sigue requiriendo escribir **`BORRAR TODO`** en mayúsculas.
- El modal de confirmación ahora lista explícitamente los 4 elementos que se
  van a borrar.

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
| 6 | Prevención de duplicados | ☐ | |
| 7 | Reset ampliado | ☐ | |
