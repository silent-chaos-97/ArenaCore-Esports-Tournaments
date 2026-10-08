---
name: arenacore-dev
description: Run, migrate, seed, test and commit in the ArenaCore monorepo. Use when starting local infrastructure, applying Prisma migrations, running tests, or finishing a build step with a commit.
---

# ArenaCore dev loop

## Infrastructure

1. `docker info >/dev/null 2>&1`. If the daemon is down, ask the user to start Docker Desktop. Do not try to work around a missing database.
2. `docker compose up -d`, then wait for the Postgres healthcheck with `docker compose ps`.
3. Copy `.env.example` to `.env` (and `apps/api/.env`) if they are missing.

## Database

- To change the schema, edit `apps/api/prisma/schema.prisma`, then run `pnpm --filter @arenacore/api exec prisma migrate dev --name <change>`.
- To start from a clean database: `pnpm --filter @arenacore/api exec prisma migrate reset --force`, then `pnpm db:seed`.
- Regenerate the client after any schema edit: `pnpm --filter @arenacore/api exec prisma generate`.

## Verify before committing

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Integration tests need the compose Postgres and Redis running.

## Commit

- One commit per completed step. Use a conventional subject, and a body that lists what the step adds.
- The author comes from the local git config (ExCoder999). Do **not** append `Co-Authored-By: Claude` or any AI attribution.
- Run `git log -1 --format='%an <%ae>%n%b'` to confirm.
