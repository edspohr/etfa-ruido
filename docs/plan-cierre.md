# Runbook — Migración al proyecto GCP del cliente (28-Ago-2026, noche)

Orden ejecutivo. Cada bloque termina en **STOP** donde Edmundo verifica salida
concreta antes de avanzar. Nada corre sin STOP resuelto.

Identidad única esperada: **`edmundo@spohr.cl`** en `firebase-tools`, `gcloud` y
`gsutil`. Las tres tienen credenciales separadas; se verifican por separado.

Proyectos:
- `viejo` → `etfa-ruido-app` (muere esta noche)
- `cliente` → `<NUEVO_PROJECT_ID>` (aún placeholder; se resuelve tras la reunión 10:00)

Regla dura: ningún comando destructivo sin `--project <alias>` explícito o
bucket totalmente cualificado. **Cualquier comando que aún contenga el literal
`<NUEVO_PROJECT_ID>` se aborta y se pide el ID real antes de correr**.

---

## Paso 0 — Verificación de identidad (obligatorio, cada CLI)

```bash
firebase login:list
gcloud auth list
```

Salida esperada — copiar/pegar visual sin pensar:

```
firebase login:list  →  ✔ Logged in as edmundo@spohr.cl
gcloud auth list      →  * edmundo@spohr.cl   (el asterisco al inicio de la línea)
```

Cualquier otra cosa (otra cuenta activa, dos cuentas sin asterisco claro,
`(no credentialed accounts)`) → **STOP** y arreglo yo, Claude no ejecuta ni
`firebase login`, `firebase logout`, `gcloud auth login`, ni switches manuales.

Opcional pero recomendado si tocamos ADC (client libraries):
`gcloud auth application-default login` — sólo yo lo corro, con
`edmundo@spohr.cl` en el chooser.

**STOP 0** — verifico las dos salidas antes de tocar cualquier proyecto.

---

## Paso 1 — Crear el proyecto en la organización GCP del cliente

Todo esto se hace en la consola GCP del cliente, con IAM Organization Admin
recibido en la reunión de las 10:00.

1. **Nuevo proyecto Firebase** en la organización del cliente, con su billing
   activo. Anotar `PROJECT_ID` y reemplazarlo en `.firebaserc → cliente`.
2. **Firestore Database → Create database → región `southamerica-west1`.**
   Obligatorio: el `firestore:import` desde `etfa-ruido-app` (que está en esa
   región) sólo funciona si origen y destino coinciden.
3. **Authentication → Sign-in method →**
   - Habilitar **Email/Password**.
   - "Allow users to sign up" **OFF** (decisión F2-A: alta manual por admin).
   - Google **NO** habilitar (loginWithGoogle ya se removió del código).
4. **Authentication → Settings → Authorized domains**: agregar el dominio del
   cliente y `<NUEVO_PROJECT_ID>.web.app` + `<NUEVO_PROJECT_ID>.firebaseapp.com`.
5. **APIs & Services**: habilitar **Generative Language API** en el nuevo
   proyecto.
6. **APIs & Services → Credentials → Create credentials → API key**. Restringir:
   - Application restrictions → HTTP referrers → dominio productivo del cliente
     y `<NUEVO_PROJECT_ID>.web.app`.
   - API restrictions → Generative Language API únicamente.
7. Copiar la key (empieza con `AIza…`) — es el nuevo `VITE_GEMINI_API_KEY`.
8. **Registrar Web App** en Firebase Console para obtener el config bundle
   (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`,
   `appId`).

**STOP 1** — sustituir `<NUEVO_PROJECT_ID>` en `.firebaserc` con el ID real;
mostrar `firebase projects:list --project cliente` (ahora sí resuelve) para
confirmar.

---

## Paso 2 — Sustituir `<NUEVO_PROJECT_ID>` y verificar `gsutil` bucket

Determinar sufijo del bucket del cliente (Google cambió el default a
`.firebasestorage.app` en 2024; el viejo `etfa-ruido-app.appspot.com` sigue
`.appspot.com`).

```bash
gsutil ls -p <NUEVO_PROJECT_ID>
```

Registrar bucket real: `gs://<NUEVO_PROJECT_ID>.firebasestorage.app` (probable)
o `gs://<NUEVO_PROJECT_ID>.appspot.com` (menos probable). Ese valor va al
`.env → VITE_FIREBASE_STORAGE_BUCKET`.

**STOP 2** — confirmar sufijo del bucket antes de cualquier `rsync` o `cors`.

---

## Paso 3 — Export desde el proyecto viejo (Firestore + Storage + Auth)

Datos:

```bash
# Firestore
gcloud firestore export gs://etfa-ruido-app.appspot.com/dump-2026-08-28 \
  --project=etfa-ruido-app

# Storage (repetir por cada carpeta con datos)
gsutil -m rsync -r gs://etfa-ruido-app.appspot.com/receipts \
  gs://<NUEVO_PROJECT_ID>.<sufijo>/receipts
gsutil -m rsync -r gs://etfa-ruido-app.appspot.com/report-attachments \
  gs://<NUEVO_PROJECT_ID>.<sufijo>/report-attachments

# Firebase Auth
firebase auth:export users.json --project viejo
```

**Direcciones a verificar en voz alta antes de cada `rsync`:** source
`etfa-ruido-app.appspot.com` → destination `<NUEVO_PROJECT_ID>.<sufijo>`. Un
rsync invertido contra el viejo es irrecuperable una vez el proyecto muere.

**STOP 3** — mostrar `gcloud firestore operations list --project=etfa-ruido-app`
con la operación de export en `SUCCESSFUL`, y `wc -l users.json` (debe reportar
≈11 usuarios).

---

## Paso 4 — Import al proyecto del cliente

Firestore YA debe estar creado en `southamerica-west1` (Paso 1.2).

```bash
gcloud firestore import gs://etfa-ruido-app.appspot.com/dump-2026-08-28/<timestamp> \
  --project=<NUEVO_PROJECT_ID>

firebase auth:import users.json --project cliente \
  --hash-algo=SCRYPT --hash-key=<key-original> \
  --salt-separator=<sep> --rounds=<n> --mem-cost=<m>
```

Los parámetros de `hash-algo` etc. salen del bloque `hashConfig` del `users.json`
exportado. **No editar `users.json` a mano.**

**STOP 4** — abrir Firestore Console del cliente y verificar que existen las
colecciones `users`, `projects`, `expenses`, `invoices`, `allocations`,
`clients`, `reports`, `bank_movements`, `bank_statements`, `audit_logs`,
`calendar_events`, `tasks`, `resources`, `notifications` con conteo razonable.
Verificar en Auth que aparecen las ~11 cuentas.

---

## Paso 5 — Deploy de rules + indexes + storage:rules

Antes del comando: `firebase use cliente` y reafirmar en voz alta el objetivo.

```bash
firebase use cliente
firebase deploy --only firestore:rules,firestore:indexes,storage:rules \
  --project cliente
```

**STOP 5** — mostrar salida del deploy con las tres cosas en verde. Verificar
en la consola Firebase del cliente:
- Firestore → Rules: primer bloque `users/{userId}` con `create if uid==userId
  && role=='professional'`.
- Firestore → Indexes: 11 índices en total (incluye `expenses(status, date)`).

---

## Paso 6 — CORS del bucket

```bash
gsutil cors set cors.json gs://<NUEVO_PROJECT_ID>.<sufijo>
gsutil cors get gs://<NUEVO_PROJECT_ID>.<sufijo>
```

El `cors.json` está en la raíz del repo (`CORS_FIX.md` documenta el contenido).

**STOP 6** — `gsutil cors get` debe imprimir el JSON que acabamos de setear.

---

## Paso 7 — Build de producción con las envs del cliente

Escribir `.env` con los valores del Paso 1.8 y la Gemini key del Paso 1.7.
`VITE_FIREBASE_STORAGE_BUCKET` es el valor del Paso 2 (verificado con `gsutil ls`).

```bash
npm run build
```

Si el build cuelga en `lucide-react` (regresión conocida en Vite 5+), **STOP**
y avisar a Edmundo — hay un chunking especial en `vite.config.js`.

Post-build, verificaciones anti-fuga en el bundle:

```bash
grep -L users-seeder dist/assets/*.js || echo "OK sin seeder"
grep -l AIzaSyCIJSXL_hWsmrYpJc8vrvbAXCAhmOcl3Qk dist/assets/*.js && \
  echo "❌ KEY VIEJA PRESENTE — abortar" || echo "OK key vieja no está"
grep -l Dominio\ no\ autorizado dist/assets/*.js && echo "OK allowlist presente"
```

**STOP 7** — las tres verificaciones deben ser positivas antes de deploy hosting.

---

## Paso 8 — Deploy hosting

```bash
firebase deploy --only hosting --project cliente
```

Bare `firebase deploy` sin `--only` **prohibido**, en cualquier proyecto,
tonight y siempre.

**STOP 8** — abrir la URL del hosting del cliente y verificar que carga.

---

## Paso 9 — Smoke tests en el hosting nuevo

1. **Login como profesional** (ej. `mmartinez@etfa-ruido.cl` — cuenta real de
   la colección `users`) con la contraseña del usuario. Debe entrar y ver el
   Dashboard con Nº Proyecto y Recurrencia (F1).
2. **Subir una boleta con imagen** desde `/dashboard/new-expense`. Si la Gemini
   key funciona, autocompleta los campos; si no, toast amarillo "No se pudo
   autocompletar con IA…" (E1). En ambos casos el gasto se guarda y aparece en
   la tabla.
3. **Login como admin** (`edmundo@spohr.cl` u otro admin real). Aprobar un
   gasto pendiente en `/admin/approvals`.
4. **Abrir el tab Historial** en `/admin/approvals`. Debe cargar sin el error
   "The query requires an index" (E3).
5. **Abrir `/admin/invoicing/history`**. Correr el botón de "Reset Facturación"
   con `BORRAR TODO` en una **DB de prueba, NO en la del cliente** — sólo si
   Edmundo lo decide. Si se corre y hay huérfanos, el toast final los reporta
   ("N referencias huérfanas ignoradas") (E2). En producción del cliente, saltar
   este paso.

**STOP 9** — cada test verde antes de continuar.

---

## Paso 10 — Corte de mi exposición

1. **Quitar `edmundo@spohr.cl`** del allowlist en `AuthContext.jsx:100` y del
   array `adminEmails` en `AuthContext.jsx:110`. Rebuild + redeploy `--only
   hosting --project cliente`.
2. **`firebase projects:delete etfa-ruido-app`** (o deshabilitar billing en la
   GCP Console). Corta Firestore/Storage/Hosting a mi cuenta.
3. **Consola GCP del cliente → IAM → revocar mi rol Organization Administrator**.
   Verificar que `edmundo@spohr.cl` no aparece en ninguna política a nivel de
   organización ni de proyecto.
4. Si hay dominio custom, reapuntar CNAME al hosting nuevo antes de apagar el
   viejo.

**STOP 10** — verificar en incógnito que `edmundo@spohr.cl` (my Google) NO
puede loguearse en la nueva app (rechaza por allowlist).

---

## Anexo A — Memo de decisión E2 (reset facturación)

Corro el reset **DESPUÉS de import al proyecto cliente**, no antes:
1. El export de Firestore es un snapshot atómico — un reset previo no simplifica
   nada y arriesga estado inconsistente si algo falla.
2. Con el fix tolerante a huérfanos ya en el código, un solo `Reset Facturación`
   post-import limpia también las referencias colgantes viejas (como
   `94O52Rznm1P6yDgLrEic`).
3. Reversibilidad: si algo sale mal post-reset, el proyecto viejo aún tiene la
   data original hasta el corte final del Paso 10.

**Recomendado**: NO correr el reset en producción del cliente durante la
migración salvo que Edmundo tenga confirmación explícita del cliente de que
quiere borrar el histórico de facturación. Sólo se justifica correrlo si el
cliente pide arrancar limpio. Si no lo pide, dejarlo para uso ad-hoc por el
propio cliente.

---

## Anexo B — Guía de alta/baja de usuarios (F2-A, para handover)

**Objetivo**: dar de alta y de baja usuarios sin abrir sign-up público.

### Alta de usuario nuevo

1. **Firebase Console → Authentication → Users → Add user**. Poner email y
   contraseña temporal (ej. `Cambia-esto-2026`).
2. Copiar el `User UID` recién creado (columna a la derecha).
3. **Firestore → colección `users` → Add document**. Document ID = el UID del
   paso 2. Campos:
   - `uid` (string): el mismo UID.
   - `email` (string): el email del usuario.
   - `displayName` (string): nombre visible.
   - `role` (string): `professional` o `admin`.
   - `balance` (number): `0`.
   - `forcePasswordChange` (boolean): `true`. Al primer login el usuario
     recibe el modal que le obliga a poner su contraseña personal.
4. Avisar al usuario su email y la contraseña temporal.

### Baja de usuario

**Nunca borrar** ni el registro de Auth ni el doc de Firestore — se pierde el
historial de gastos ligados a ese UID.

En su lugar:
1. **Firebase Console → Authentication → Users**. Fila del usuario → menú `⋮`
   → "Disable account". Bloquea el login sin borrar nada.
2. (Opcional) En Firestore `users/{uid}`, añadir `active: false` para
   filtrarlo de dropdowns internos.

### Reset de contraseña

Auto-servicio: el usuario usa el link "Crea o resetea tu contraseña" en la
pantalla de login (llama a `sendPasswordResetEmail`). El email de reset llega
a su casilla.

Manual: **Firebase Console → Authentication → Users → fila del usuario →
`⋮` → "Reset password"**. Genera el link de reset para copiar/enviar.

---

## Riesgos aceptados post-migración

- **Reglas de Firestore permisivas para colecciones distintas de `users`**.
  Con la allowlist en `ensureUserExists` y el hardening de `users/{userId}`, el
  vector destructivo público (auto-promoción a admin) está cerrado. `expenses`,
  `projects`, `invoices`, `clients`, `bank_movements`, `bank_statements`, etc.
  siguen `if request.auth != null` para read/write. Eso es aceptable para uso
  interno con la allowlist de dominio; si en algún momento se abre la app a
  externos, se endurece por colección.
- **Gemini key inline en el bundle**, restringida por HTTP referrer al dominio
  del cliente. Si alguien scrapea la key desde el navegador y la usa en un
  request sin referrer válido, Google lo rechaza. Escenario aceptado.
- **Docs legacy `user_edmundo` y `user_caja_chica`** en Firestore. Con
  sign-up OFF y allowlist, el flujo de claim-by-email queda inactivo para
  emails no permitidos — el vector se neutraliza sin borrar datos. Se
  recomienda al cliente limpiar `email` de esos docs con `deleteField()`
  cuando dé de baja las cuentas Auth correspondientes.
- **Contraseña común `gastos2026`** en cuentas que aún no rotaron. Filtrar en
  `users` por `forcePasswordChange:false` desde la Firestore Console y forzar
  el flag a `true` para los que no rotaron. `ForcePasswordChange.jsx` los
  bloquea al siguiente login.
- **Recibos huérfanos en Storage** (archivos sin `imageUrl` en la colección
  `expenses`) heredados del proyecto viejo. Bajo volumen; el cliente lo puede
  limpiar ad-hoc contando desde `expenses` y borrando lo no referenciado.
- **`edmundo@spohr.cl` como admin**. Se elimina del allowlist y de
  `adminEmails` en el Paso 10, junto con la revocación de IAM en la GCP del
  cliente.

---

## Trabajo futuro (fuera de scope esta noche)

- Endurecer regla de `expenses/{expenseId}` (create sólo dueño; update/delete
  con bypass admin). Requiere test en emulador del writeBatch de aprobación.
- Endurecer regla de `report-attachments` en `storage.rules`.
- Proxy backend / Cloud Function para Gemini en vez de key inline.
- Sistema de baja de usuarios in-app (F2-B) si el cliente lo pide más
  adelante — incluye limpieza atómica de `user_edmundo` y `user_caja_chica`.
- Sentry / logging server-side.
- Tests automatizados de rules en emulator suite.
