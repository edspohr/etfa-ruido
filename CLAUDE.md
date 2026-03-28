# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start local dev server (Vite)
npm run build      # Production build → /dist
npm run lint       # ESLint across all .js/.jsx files
npm run preview    # Preview production build locally
```

There are no automated tests in this project.

## Environment Setup

Copy `.env.example` to `.env` and fill in values. Required variables:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_GEMINI_API_KEY
```

## Architecture

**Stack:** React 19 SPA with Vite, TailwindCSS, Firebase (Auth + Firestore + Storage), Google Gemini AI.

**Deployment:** Firebase Hosting (preferred over Vercel — this is a Firebase-integrated SPA). Config in `firebase.json`.

### Role-Based Access

Two roles: `admin` and `professional`. Role is stored in Firestore `users/{uid}.role`. `ProtectedRoute.jsx` gates routes by role. `AuthContext.jsx` handles auth state, session persistence, and first-login user provisioning from Firestore.

### Routing (`App.jsx`)

- `/login` — public
- `/admin/*` — admin-only routes (kanban, projects, approvals, balances, reports, calendar, tasks, invoicing, analytics)
- `/dashboard`, `/mi-calendario`, `/mis-tareas`, `/informes/*` — professional routes

### Key Modules

1. **Expense Management** — Professionals submit expenses (`ExpenseForm.jsx`); admins approve/reject in `AdminApprovals.jsx`. Budget allocations tracked in Firestore `allocations/` and `expenses/` collections.

2. **Field Reports** — Professionals file acoustic measurement reports linked to calendar events. `AdminReportsV2.jsx` manages these on the admin side.

3. **Financial / Invoicing** — Kanban board (`AdminKanbanBoard.jsx`) tracks project lifecycle: Por Facturar → Informe Emitido → Facturado → Pagado. Invoice generation, history, and bank reconciliation are separate sub-pages under `/admin/invoicing/`.

4. **Calendar & Tasks** — Calendar events (`calendar_events/`) link to tasks (`tasks/`) and field reports. Task auto-generation via Gemini AI in `utils/taskAutoGeneration.js`.

### Firebase Storage

Receipt/image uploads go to `/receipts/{userId}/{filename}`. Upload helper in `lib/firebase.js` with a 15-second timeout and fault-tolerance: form saves without image if upload hits CORS errors.

### AI Integration

`lib/gemini.js` wraps `@google/generative-ai`. Used primarily for PDF invoice parsing (`utils/parseInvoicePDF.js`) and automatic task generation.

### Firestore Collections

| Collection | Purpose |
|---|---|
| `users` | Auth + role + balance |
| `projects` | Project metadata & team |
| `expenses` | Expense submissions |
| `allocations` | Budget allocations per user |
| `invoices` | Invoice records |
| `reports` | Field measurement reports |
| `calendar_events` | Scheduled field work |
| `tasks` | Planner tasks linked to events |
| `clients` | Client directory |
| `bank_movements` | Bank statement entries |
| `balance_adjustments` | Manual balance corrections |
| `audit_logs` | Action audit trail |

Security rules are in `firestore.rules` and `storage.rules`. Currently permissive for authenticated users — tighten before scaling beyond internal team.
