# SessionForge

> Remote AI Session Management Platform

Manage all your Claude Code (and other AI coding) sessions from anywhere — monitor, start, stop, and get alerts across all your machines, from your phone or browser, in real time.

## Status: Building in public

## Architecture

- **`apps/web/`** — Next.js 14 dashboard + API (TypeScript)
- **`packages/shared-types/`** — Shared TypeScript types
- **`agent/`** — Go agent (open source) that runs on your machines
- **`infra/`** — Docker Compose, GCP, Cloudflare configs

## Local Development

### Prerequisites
- Node.js 20+
- Go 1.22+
- Docker Desktop

### Setup

```bash
# Start local services (Postgres + Redis)
docker compose -f infra/docker-compose.yml up -d

# Install dependencies
npm install

# Set up environment
cp apps/web/.env.example apps/web/.env.local
# Edit apps/web/.env.local with your values

# Run database migrations
npm run db:migrate --workspace=apps/web

# Start development server
npm run dev
```

## Agent (Open Source)

The desktop agent is open source at [github.com/sessionforge/agent](https://github.com/sessionforge/agent).

Install:
```bash
# Linux/Mac
curl -fsSL https://sessionforge.dev/install.sh | sh

# Windows (PowerShell)
irm https://sessionforge.dev/install.ps1 | iex
```

## License

- Platform (this repo): Proprietary
- Agent (`agent/`): MIT License
