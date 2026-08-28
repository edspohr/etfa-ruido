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
- Firestore → Rules: primer bloque `users/{userId}` con `allow create: if false;`.
- Firestore → Indexes: 11 índices en total (incluye `expenses(status, date)`).
- Rules Playground / simulator: correr los cuatro casos:
  - admin escribe `isSuperAdmin:true` sobre otro user → ALLOW.
  - admin `increment` sobre `balance` de otro user → ALLOW.
  - professional actualiza su propio doc con `forcePasswordChange` u otros
    campos de perfil (no toca `role`/`isSuperAdmin`) → ALLOW.
  - token autenticado sin doc en `users/` intenta `create` sobre `users/{uid}`
    con cualquier payload (incluido `role:admin`) → DENY.

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

0. **Probe de perímetro (el test real, antes de mirar la UI)**. Con la API key
   web del nuevo proyecto (la de `VITE_FIREBASE_API_KEY`, NO la de Gemini),
   golpear el endpoint de Identity Toolkit sin cuenta:

   ```bash
   curl -sS "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<NUEVO_FIREBASE_API_KEY>" \
     -H 'Content-Type: application/json' \
     -d '{"email":"probe-$(date +%s)@invalido.tld","password":"probe-1234","returnSecureToken":true}'
   ```

   Debe devolver `"message": "ADMIN_ONLY_OPERATION"` con HTTP 400. Ese es el
   perímetro real (toggle sign-up OFF), no la UI. Si responde con
   `idToken`, el sign-up quedó habilitado — **STOP** y volver al Paso 1.3.

1. **Login como profesional** (ej. una cuenta real de la colección `users`).
   Debe entrar y ver el Dashboard con "Nº Proyecto" y "Recurrencia" (F1).
2. **Subir una boleta con imagen** desde `/dashboard/new-expense`. Si la Gemini
   key funciona, autocompleta los campos; si no, toast amarillo "No se pudo
   autocompletar con IA…" (E1). En ambos casos el gasto se guarda y aparece en
   la tabla.
3. **Login como admin** (cuenta admin real). Aprobar un gasto pendiente en
   `/admin/approvals`.
4. **Abrir el tab Historial** en `/admin/approvals`. Debe cargar sin el error
   "The query requires an index" (E3).
5. **`/admin/invoicing/history` — NO tocar el Reset Facturación esta noche.**
   El memo Anexo A lo cubre.

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

**El reset NUNCA se corre durante la noche de migración, aunque sobre tiempo.**
Post-import lo primero es comparar paridad entre proyecto viejo y nuevo (mismo
conteo de invoices, expenses, movs bancarios, cartolas). Un reset en el medio
destruye esa comparación.

Se corre sólo:
- A pedido explícito del cliente.
- En el proyecto nuevo.
- Con el proyecto viejo todavía vivo como backup, o sea antes del Paso 10.
- Idealmente el fin de semana siguiente, con el cliente mirando la pantalla.

El toast final ("N referencias huérfanas ignoradas") es la prueba visible al
cliente de que el bug de sus "duplicados que no se dejaban borrar" quedó
cerrado.

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

- **Perímetro es un solo checkbox de consola**. El sign-up en el proyecto
  nuevo queda OFF; eso más `allow create: if false` en `users/{userId}` cierra
  el vector destructivo público. La allowlist client-side en
  `ensureUserExists` es defensa en profundidad, no perímetro — un token
  válido nunca ejecuta el JS de la app. Si el cliente re-habilita sign-up en
  el futuro, `create:false` sigue bloqueando el claim-by-email.
- **Reglas permisivas en `expenses`/`projects`/`invoices`/`clients`/
  `bank_movements`/`bank_statements` etc.**: cualquier token autenticado lee
  y escribe. Con el perímetro cerrado esto sólo afecta a los ~11 usuarios
  legítimos entre sí (no hay atacantes externos). Se acepta hasta el package
  de endurecimiento de fin de año.
- **Admin puede auto-otorgarse `isSuperAdmin: true`** vía el bypass admin del
  `update` en `users/{userId}` — la regla no restringe qué campos puede
  cambiar un admin sobre otros docs (ni sobre el suyo). El único gate que
  desbloquea eso es `isSuperAdmin` para `delete` en `invoices`,
  `bank_movements`, `bank_statements`. Bajo el modelo de confianza actual
  (todos los admin son personal interno) es aceptable.
- **Gemini key inline en el bundle**, restringida por HTTP referrer al dominio
  del cliente. Si alguien scrapea la key y la usa sin referrer válido, Google
  lo rechaza. Escenario aceptado.
- **Docs legacy `user_edmundo` y `user_caja_chica`** en Firestore. Con
  sign-up OFF, `create:false` y allowlist, el flujo de claim-by-email queda
  neutralizado sin borrar datos. Se recomienda al cliente limpiar `email` de
  esos docs con `deleteField()` cuando dé de baja las cuentas Auth
  correspondientes.
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

- **Package de endurecimiento interior (fin de año)**: regla granular por
  colección (`expenses/{expenseId}`, `projects/*`, `invoices/*`,
  `bank_movements/*`, etc.), create sólo dueño con bypass admin, tests en
  emulator suite del `writeBatch` de aprobación y del reset.
- **Reemplazar la allowlist client-side por eliminación completa del
  auto-provisioning en `ensureUserExists`**. Con `create:false` ya
  desplegado, la rama "New User" quedó inerte pero sigue viva en el código;
  removerla junto con la rama de claim-by-email deja `ensureUserExists`
  siendo una simple lectura idempotente. (Desviación registrada: el commit
  `fcf3046` puso allowlist en lugar de remover el auto-provisioning como
  originalmente se instruyó; con toggle OFF + `create:false` la desviación
  es inerte.)
- **Patrón `batch.update` frágil en `AdminInvoicingHistory.jsx:113-124`**
  (invoice-unlink). Mismo bug que el reset: `update` sobre docs que pueden
  no existir. **NO tocar esta noche.** Refactorizar con la misma técnica del
  reset tolerante (`getDoc` en paralelo + filtrado).
- Endurecer regla de `report-attachments` en `storage.rules`.
- Proxy backend / Cloud Function para Gemini en vez de key inline.
- Sistema de baja de usuarios in-app (F2-B) si el cliente lo pide más
  adelante — incluye limpieza atómica de `user_edmundo` y `user_caja_chica`.
- Sentry / logging server-side.
