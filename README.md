# Sistema de Gestión Financiera y Operativa - ETFA Ruido

Este repositorio contiene la aplicación core para la administración, gestión de proyectos, facturación, y operaciones técnicas de terreno de ETFA Ruido.

## 🚀 Arquitectura y Módulos del Sistema

La plataforma está diseñada con una interfaz **Premium (Glassmorphism, gradientes avanzados)** centrada en la productividad y la claridad visual. Se divide en los siguientes módulos principales:

### 1. Gestión de Rendiciones

Gestión completa de fondos, viáticos y rendiciones de cuentas.

- **Administradores**: Asignan saldo a los Profesionales (o a "Caja Chica"), aprueban/rechazan comprobantes, y auditan balances de cuentas corrientes.
- **Profesionales**: Rinden sus gastos subiendo boletas fotográficas e indicando a qué proyecto corresponde.

### 2. Informes Terreno

Registro y revisión de las mediciones de ruido acústico en faenas.

- **Profesionales**: Reportan sus hallazgos en terreno, equipos utilizados y mediciones.
- **Administradores**: Revisan los informes entrantes de los profesionales.

### 3. Módulo Financiero

Interfaz visual Kanban y herramientas para gestionar el ciclo de vida de cobro:

- **Tablero Kanban**: Visualización del estado de los proyectos (Por Facturar, Informe Emitido, Facturado, Pagado).
- **Registro de Factura**: Herramienta para emitir y registrar facturas.
- **Conciliación**: Sincronización de facturas con ingresos de pagos bancarios.
- **Análisis de Datos**: Paneles financieros, métricas de rendimiento por proyecto y KPIs interactivos.

### 4. Mi Espacio (Dashboard)

Área personal para cada usuario donde pueden ver el resumen de sus actividades:

- **Profesionales**: Tienen visibilidad selectiva para revisar su saldo, rendiciones enviadas, subir nuevas mediciones y gestionar su trabajo en terreno directamente.

---

## 💻 Stack Tecnológico y Arquitectura

- **Frontend**: React.js 18+ con Vite
- **Estilos**: TailwindCSS 3 (con utilidades avanzadas de UI).
- **Backend / Base de Datos**: Firebase (Auth, Firestore, Storage).
- **Estructura Firestore**:
  - `projects/{id}`: Proyectos, clientes, recurrencias.
  - `users/{id}`: Roles y saldos de cuentas corrientes.
  - `expenses/{id}`: Rendiciones de gastos.
  - `allocations/{id}`: Inyecciones de saldo a profesionales.
  - `invoices/{id}`: Facturas procesadas.
  - `reports/{id}`: Informes de terreno.

## 🔒 Consideraciones de Seguridad

**Nota importante sobre Firestore Rules**: Las reglas de seguridad actuales (`firestore.rules`) están optimizadas para una migración ágil y permiten a cualquier usuario autenticado leer/escribir colecciones fundamentales. **Antes de escalar a producción masiva**, se recomienda encarecidamente ajustar estas reglas para asegurar que cada profesional solo pueda leer/escribir sus propios documentos y gastos, dejando el acceso global exclusivamente para roles de Administrador.

---

## 🌐 Recomendación de Hosting: Producción

Actualmente la plataforma está configurada a nivel código para poder desplegarse tanto en **Vercel** (`vercel.json`) como en **Firebase Hosting** (`firebase.json`).

| Criterio                        | Firebase Hosting                                                 | Vercel                                      |
| ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| **Integración Firebase SDK**    | Nativa (misma consola, auth automático, sin bloqueos de dominio) | Requiere configuración manual de variables  |
| **Flujo de despliegue (CI/CD)** | `firebase deploy` manual o vía GitHub Actions                    | Integración Git push con auto-deploy nativo |
| **Costo (10-15 usuarios)**      | Gratis (Spark Plan)                                              | Gratis (Hobby Plan)                         |
| **Dominio personalizado**       | Sí, gratis                                                       | Sí, gratis                                  |
| **Gestión de Infraestructura**  | Todo centralizado en el ecosistema Google Cloud                  | Consolas separadas y fragmentadas           |

> **🔥 RECOMENDACIÓN OFICIAL: Firebase Hosting**  
> Para el caso de uso actual de ETFA Ruido (10-15 usuarios internos, stack 100% serverless acoplado con Firebase Auth + Firestore + Storage), **mantener todo el frontend y backend en el ecosistema Firebase es la mejor decisión técnica**. Simplifica drásticamente la gestión, reduce puntos de falla, previene problemas de CORS e iframes con la autenticación (comunes cuando el front está en otro dominio), y consolida tanto la facturación como las métricas en un solo lugar. Vercel agrega una capa de complejidad de plataforma completamente innecesaria para una SPA (Single Page Application) construida con Vite + Firebase.
