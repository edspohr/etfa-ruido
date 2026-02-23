# Sistema de Gestión Financiera y Operativa - ETFA Ruido

Este repositorio contiene la aplicación core para la administración, gestión de proyectos, facturación, y operaciones técnicas de terreno de ETFA Ruido.

## 🚀 Arquitectura y Módulos del Sistema

La plataforma está diseñada con una interfaz **Premium (Glassmorphism, gradientes avanzados)** centrada en la productividad y la claridad visual. Se divide en los siguientes módulos principales:

### 1. Rendición de Gastos (`/admin/expenses` | `/dashboard`)

Gestión completa de fondos, viáticos y rendiciones de cuentas.

- **Administradores**: Asignan saldo a los Profesionales (o a "Caja Chica"), aprueban/rechazan comprobantes, y auditan balances.
- **Profesionales**: Rinden sus gastos subiendo boletas fotográficas (con lectura OCR mediante IA) e indicando a qué proyecto corresponde.

### 2. Informes Terreno (`/admin/reports` | `/dashboard`)

Registro y revisión de las mediciones de ruido acústico en faenas.

- **Profesionales**: Reportan sus hallazgos en terreno (fecha, equipos utilizados, Leq evaluado).
- **Administradores**: Revisan los informes entrantes. Al "Aprobar", el proyecto asociado avanza automáticamente en el embudo de Facturación.

### 3. Facturación (Tablero Kanban) (`/admin/invoicing`)

Interfaz visual Kanban para gestionar el ciclo de vida de cobro:

1. **Por Facturar** (`pending`): En espera de mediciones o hitos técnicos.
2. **Informe Emitido** (`report_issued`): Listo para pre-facturar. Se llegó a este punto mediante aprobación de la medición en terreno.
3. **Facturado** (`invoiced`): Pre-factura emitida y procesada.
4. **Pagado** (`paid`): Conciliada con ingresos bancarios.

### 4. Bitácora de Proyectos (Auditoría)

Registro cronológico e inmutable anidado a cada proyecto.

- **Administradores**: Visibilidad total (`Ver Bitácora`) sobre cambios de estado en Kanban, asignaciones de saldo, rendiciones enviadas, y comentarios.
- **Profesionales**: Tienen visibilidad selectiva para dejar y leer comentarios/consultas sobre sus proyectos asignados directly en su Dashboard.

### 5. Analítica _(Próximamente)_

Módulo reservado para paneles financieros y métricas de rendimiento por proyecto.

---

## 🏗 Arquitectura de Base de Datos (Firestore)

Utilizamos Firebase Firestore (NoSQL). Estructura clave:

- **`projects/{projectId}`**: Modelos de proyectos (cliente, recurrencia, etc.).
  - **Subcolección `logs`**: Historial de la Bitácora (`type`, `content`, `userName`, `timestamp`).
- **`expenses/{expenseId}`**: Rendiciones de dinero con respaldo AI.
- **`users/{userId}`**: Perfiles de Profesionales/Administradores y su saldo ('cuenta corriente').
- **`allocations/{allocationId}`**: Historial de inyecciones de saldo a profesionales (asignaciones).
- **`invoices/{invoiceId}`**: Facturas procesadas y pendientes de conciliación.

---

## 💻 Stack Tecnológico

- **Frontend**: React.js + Vite
- **Estilos**: TailwindCSS (con utilidades avanzadas de Backdrop Blur y Gradientes).
- **Backend Enrutado / DB**: Firebase (Firestore, Auth, Hosting).
- **Librerías Destacadas**:
  - `@hello-pangea/dnd`: Drag & Drop fluído para el Kanban.
  - `pdfjs-dist`: Lectura local de facturas PDF en el navegador.
  - `lucide-react`: Iconografía estilizada de la interfaz.

---

## 🛠 Scripts y Mantenimiento

### Migración de Datos (`scripts/migrate_projects.js`)

Script en Node.js para actualizar la base de datos de manera programática:

- Genera códigos secuenciales (`PRJ-XXX`) para proyectos antiguos.
- Útil al agregar nuevas propiedades (`status`, `billingStatus`) a toda una colección.
- _Requiere cuenta de servicio (Service Account) con credenciales de Firebase Admin._
