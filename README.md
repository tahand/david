# Clinic Appointments

Online appointment booking for a doctors' clinic. See [SPEC.md](SPEC.md) for requirements and [CLAUDE.md](CLAUDE.md) for conventions.

## Getting started

Requirements: Node 20 LTS or newer, Docker (for local Postgres).

```sh
npm install
cp .env.example .env    # then fill SESSION_SECRET and DATA_ENCRYPTION_KEY
npm run db:up
npm run dev:api         # http://127.0.0.1:4000/api/health
npm run dev:web         # http://localhost:5173
```

Run `npm run check` to lint, type-check and test everything.
