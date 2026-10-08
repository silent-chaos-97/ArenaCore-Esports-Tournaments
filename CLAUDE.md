# ArenaCore — notes for Claude

Multi-tenant esports tournament platform. The requirements spec lives outside the repo, at
`~/Downloads/Esports Tournament & League Management Platform — Project Requirements.md`.
The build plan is MVP-first, one git commit per step.

## Layout

- `apps/api`: NestJS modular monolith with Prisma/PostgreSQL, BullMQ/Redis, and REST under `/api/v1`. `src/worker.ts` is the async worker entrypoint.
- `apps/web`: Next.js App Router with Tailwind. Contains the Organizer Console (`/console`), the Player Portal (`/me`) and the public pages (`/t/[slug]`).
- `packages/shared`: zod schemas, enums and state machines imported by both the API and the web app. This is the single source of truth for DTO shapes.
- `packages/bracket`: a pure bracket engine with no I/O. Every rule change needs a property test.

## Commands

```bash
docker compose up -d                 # postgres:5432 redis:6379 s3mock:9090 mailpit:1025/8025
pnpm install
pnpm db:migrate && pnpm db:seed      # run from the root; proxies to apps/api
pnpm dev                             # api :4000, web :3000
pnpm dev:worker                      # outbox relay, notifications, scheduler
pnpm lint && pnpm typecheck && pnpm test
pnpm e2e                             # Playwright full-tournament simulation
pnpm --filter @arenacore/api seed:demo  # demo data via the HTTP API
```

`packages/shared` and `packages/bracket` compile to `dist/`. Rebuild them (`pnpm --filter "./packages/*" build`) after changing them, or the API and web will see stale types.
After any Prisma schema change, run `prisma generate`. Prisma 7's `migrate dev` does not regenerate the client.

## Non-negotiable rules

- **Tenant isolation:** every tenant-owned query filters on `organizationId`, which comes from the `TenantContext`. Never trust an org id that arrives in a request body.
- **Authorization:** controllers use `@Roles(...)` and resource-scoped checks. For example, a referee assigned to tournament A cannot touch tournament B.
- **Audit:** every administrative mutation calls `AuditService.record` _inside the same transaction_.
- **Idempotency:** POSTs that create results, registrations or check-ins honour the `Idempotency-Key` header. Results are also deduplicated by the unique `(matchId, source, externalRef)` key.
- **Bracket integrity:** a winner update and its advancement happen in one transaction that locks the affected match rows. Bump `Match.version`.
- **Events:** emit domain events by inserting into `OutboxEvent` in the same transaction. Never publish straight to a queue from request code.
- **AI:** no AI may decide competitive outcomes.

## Conventions

- Validate input with zod schemas from `@arenacore/shared` through `ZodValidationPipe`. Do not use class-validator.
- Errors are `application/problem+json` responses. Throw Nest HTTP exceptions or `DomainError`.
- Tests use Vitest. Unit specs sit next to the code as `*.spec.ts`. API integration tests live in `apps/api/test/*.e2e-spec.ts` and run against the compose Postgres, using a database per run.

## Git

- Author: `ExCoder999 <232712432+ExCoder999@users.noreply.github.com>`, set in the local config.
- **Never** add a Claude `Co-Authored-By` trailer or any other AI attribution.
- Make one commit per build step with a conventional message (`feat(api): …`, `chore: …`).
