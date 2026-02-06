# Sistema de Gestión Financiera - ETFA Ruido

Este repositorio contiene la aplicación de administración para la gestión de proyectos, facturación y rendición de gastos.

## 🏗 Arquitectura de Base de Datos (Firestore)

La aplicación utiliza Firebase Firestore como base de datos NoSQL. Las colecciones principales son:

### 1. `projects` (Proyectos)

Almacena la información de los casos o proyectos activos.

- **Campos Clave**:
  - `name`: Nombre del proyecto.
  - `client`: Cliente asociado.
  - `code`: Código único del proyecto (ej: `PRJ-001`). _Generado vía migración._
  - `recurrence`: Frecuencia de facturación (ej: `Único`, `Mensual`).
  - `billingStatus`: Estado en el flujo Kanban (`pending`, `report_issued`, `invoiced`, `paid`).
  - `lastBillingUpdate`: Timestamp del último cambio de estado.

### 2. `expenses` (Gastos)

Rendiciones de gastos asociadas a proyectos o costos internos.

- **Relación**: Vinculado a `projects` mediante `projectId`.

### 3. `invoices` (Facturas)

Facturas emitidas o recibidas.

- **Uso**: Procesadas mediante el módulo de carga masiva.

---

## 🚀 Módulos del Sistema

### 1. Tablero Kanban de Facturación (`/admin`)

Interfaz visual para gestionar el ciclo de vida de cobro de los proyectos.

- **Flujo**:
  1.  **Por Facturar** (`pending`): Proyectos activos pendientes de gestión. Muestra alerta roja si llevan >7 días sin movimiento.
  2.  **Informe Emitido** (`report_issued`): Se ha generado el informe técnico para el cliente.
  3.  **Facturado** (`invoiced`): La factura ha sido emitida.
  4.  **Pagado** (`paid`): El cliente ha pagado la factura.
- **Funcionalidades**:
  - **Drag & Drop**: Arrastrar tarjetas para cambiar el estado.
  - **Detalle Modal**: Resumen financiero en tiempo real (Total Rendido vs Gastos Pendientes), enlace al detalle del proyecto y acciones rápidas.

### 2. Carga Masiva de Facturas

Herramienta para procesar múltiples facturas PDF simultáneamente.

- **Tecnología**: Usa `pdfjs-dist` para leer texto de PDFs en el navegador.
- **Lógica**: Busca patrones "Código de Proyecto" (ej: `PRJ-\d+`) dentro del PDF para asociar automáticamente la factura al proyecto correspondiente.

### 3. Conciliación Bancaria

Módulo para cruzar movimientos bancarios (Cartola Santander) con gastos y facturas registradas.

---

## 🛠 Scripts y Mantenimiento

### Migración de Datos (`scripts/migrate_projects.js`)

Script de Node.js diseñado para actualizar proyectos legacy.

- **Función**:
  - Genera códigos secuenciales (`PRJ-XXX`) para proyectos antiguos que no tenían.
  - Asigna recurrencia por defecto (`Único`).
  - Inicializa `billingStatus` en `pending`.
- **Ejecución**: Requiere credenciales de `firebase-admin` (Service Account).

## 💻 Stack Tecnológico

- **Frontend**: React + Vite + TailwindCSS.
- **Backend/DB**: Firebase (Firestore, Hosting, Auth).
- **Librerías Clave**: `@hello-pangea/dnd` (Kanban), `pdfjs-dist` (PDF Parsing), `lucide-react` / `react-icons` (Iconografía).
