# Polltodo - Survey & Questionnaire Platform

A full-stack survey and questionnaire management platform built with **React**, **Express**, and **Prisma/PostgreSQL**. Designed for organizations that need structured, recurring assessments tied to objects (applications, systems, etc.) with role-based access control.

## Features

- **Questionnaire authoring** - Create multi-section surveys with various question types (text, boolean, single/multi choice, assignment pickers, and more)
- **Object-based task management** - Assign surveys to objects (e.g. applications) via policies with configurable frequencies (once, monthly, quarterly, yearly, custom)
- **Role-based access control** - Three tiers: ADMIN, EDITOR, VIEWER with fine-grained scoping
- **Object groups & policies** - Group objects together and apply survey policies at the group level
- **Results & analytics** - View submissions, KPI overviews, and export to Excel/PDF
- **LDAP/Active Directory** - Optional authentication via LDAP with role mapping from AD groups
- **Jira integration** - Create Jira issues from survey submissions with configurable templates
- **External data import** - Scheduled imports from MSSQL databases for objects, users, and roles
- **Dark/light theme** - Full theme support with animated UI
- **Bulk import/export** - Import and export objects, users, roles, and policies via Excel

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Tailwind CSS 4, Vite 7, Radix UI |
| Backend | Express, TypeScript, Prisma ORM |
| Database | PostgreSQL |
| Auth | JWT (cookie-based), bcrypt, optional LDAP |
| Deployment | PM2, Windows Server compatible |

## Prerequisites

- **Node.js** >= 20
- **PostgreSQL** >= 14
- **npm** >= 10

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/stuggibuggi/Polltodo.git
cd Polltodo
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your database URL and settings. At minimum, set:

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - A secure random string for signing tokens
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` - Initial admin credentials

### 3. Set up the database

```bash
npx prisma migrate deploy
npm run create-admin
```

### 4. Start development

```bash
# Terminal 1: Backend
npm run dev:server

# Terminal 2: Frontend
npm run dev
```

The frontend runs at `http://localhost:5173` and proxies API calls to the backend at `http://localhost:4000`.

## Production Build

```bash
npm run build:prod
```

This generates:
- `dist/` - Static frontend assets
- `dist-server/` - Compiled backend

### Running in production with PM2

```bash
npx pm2 start ecosystem.config.cjs
```

## Project Structure

```
prisma/              # Database schema and migrations
server/src/          # Express backend (TypeScript)
src/                 # React frontend (TypeScript)
  components/        # Reusable UI components
  lib/               # Utilities, API client, auth, theme
  pages/             # Route pages
  types/             # TypeScript type definitions
scripts/             # Utility scripts
docs/                # Technical and end-user documentation
animation/           # Animation prototypes (standalone)
public/              # Static assets
```

## Environment Variables

See [`.env.example`](.env.example) for all available configuration options including:

- Database connection
- Authentication mode (local, LDAP, or both)
- LDAP configuration
- Jira integration
- External import scheduler
- HTTPS/SSL settings

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start frontend dev server |
| `npm run dev:server` | Start backend dev server |
| `npm run build:prod` | Build both frontend and backend for production |
| `npm run create-admin` | Create or update the admin user |
| `npm run seed` | Seed the database with sample data |
| `npm run cron:tasks` | Generate scheduled survey tasks |
| `npm run check:contrast` | Validate theme color contrast ratios |

## Documentation

Detailed documentation is available in the `docs/` folder:

- **[Technische Dokumentation](docs/Technische-Dokumentation.md)** - Architecture, deployment, API reference
- **[Endbenutzer-Dokumentation](docs/Endbenutzer-Dokumentation.md)** - User guide

## License

This project is licensed under the [MIT License](LICENSE).
