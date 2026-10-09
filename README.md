# ArenaCore

ArenaCore is a multi-tenant platform for running esports tournaments. Organizers create and run competitions from one console. Captains register teams, check in, report scores and raise disputes. Spectators follow brackets live.

This repository holds the MVP: single and double elimination, from tournament creation to a crowned champion.

## Architecture

```
apps/web  (Next.js)  ──HTTP/SSE──▶  apps/api  (NestJS modular monolith)  ──▶ PostgreSQL
                                        │  writes state + outbox rows in one transaction
                                        ▼
                                  outbox_events ──▶ worker (relay, BullMQ, scheduler) ──▶ email / Discord
                                        │                     │
                                        └──── Redis pub/sub ◀─┘──▶ SSE to browsers, cache invalidation
packages/bracket  pure bracket engine (seeding, SE/DE, results, standings) — property tested
packages/shared   zod schemas, enums and state machines shared by API and web
```

| Concern           | How it is handled                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant isolation  | Every org-scoped query filters on `organizationId`. `TenantGuard` and `AccessService` check RBAC plus tournament-scoped referee grants. Foreign resources return 404.                                 |
| MFA               | TOTP secrets sealed with AES-256-GCM. Owners and admins need an MFA session when `MFA_ENFORCED=true`, which is the production default.                                                                |
| Bracket integrity | Engine state lives on the stage row. A winner and its advancement are written in one transaction under match and stage row locks. Downstream matches freeze while a feeder match is disputed.         |
| Idempotency       | An `Idempotency-Key` header replays the stored response. Results are unique on `(match, source, externalRef)`. Repeat reports are no-ops.                                                             |
| Events            | Transactional outbox, relayed with `FOR UPDATE SKIP LOCKED` to BullMQ (job id = event id). Notifications are deduplicated per user and event.                                                         |
| Real-time         | The worker publishes to Redis. Each API instance fans out to SSE clients and invalidates versioned Redis caches.                                                                                      |
| Audit             | Every administrative mutation calls `AuditService.record` inside its transaction, capturing actor, before/after values, reason and request id.                                                        |
| Evidence          | Uploads go through presigned S3 URLs with an allowed MIME list, size cap and magic-byte check. Downloads are presigned and authorized.                                                                |
| Observability     | pino logs with request ids. Prometheus metrics on `/metrics` (API) and `:9464/metrics` (worker): latency, outbox backlog, relay lag, queue depth, cache hit rate, webhook outcomes, delivery results. |

## Getting started

Requirements: Node 22+, pnpm 12+ and Docker.

```bash
cp .env.example .env
pnpm install
docker compose up -d                  # postgres, redis, s3mock (S3), mailpit
pnpm --filter "./packages/*" build
pnpm db:migrate && pnpm db:seed       # schema + game catalog
pnpm dev                              # API :4000, web :3000
pnpm dev:worker                       # outbox relay, notifications, scheduler (needed for live updates)
pnpm --filter @arenacore/api seed:demo  # optional: realistic demo data through the HTTP API
```

The demo script prints logins. Organizer: `owner@arenacore.local` / `arenacore-demo`. Emails arrive in Mailpit at <http://localhost:8025>.

Local `.env` sets `MFA_ENFORCED=false` so you can try the console without an authenticator app. Never deploy with that setting.

## Testing

```bash
pnpm test        # bracket property tests, shared unit tests, 89 API integration tests (needs compose)
pnpm e2e         # Playwright: full tournament through the UI (starts API, worker and web)
k6 run -e SLUG=<tournament-slug> loadtest/tournament-start.js   # tournament-start load profile
```

CI (`.github/workflows/ci.yml`) runs lint, format check, typecheck, tests and build against service containers, then the Playwright simulation.

### MVP acceptance criteria

| #   | Criterion                                              | Verified by                                                                                       |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 1   | Organizer creates and publishes a tournament           | `tournaments.e2e-spec.ts`, Playwright wizard flow                                                 |
| 2   | Players form teams and register                        | `teams.e2e-spec.ts`, `registrations.e2e-spec.ts`, Playwright UI registration                      |
| 3   | Organizer approves registrations                       | `registrations.e2e-spec.ts` (including capacity races), Playwright                                |
| 4   | Approved teams check in                                | `competition.e2e-spec.ts`                                                                         |
| 5   | Platform seeds teams                                   | `competition.e2e-spec.ts`, `bracket.spec.ts`                                                      |
| 6   | Platform generates a valid bracket                     | `bracket.spec.ts` (fast-check invariants), `competition.e2e-spec.ts`                              |
| 7   | Teams report match results                             | `matches.e2e-spec.ts`, Playwright match room                                                      |
| 8   | Confirmation advances the correct participant          | `matches.e2e-spec.ts`, `concurrency.e2e-spec.ts`                                                  |
| 9   | Conflicting results create disputes                    | `matches.e2e-spec.ts`, `disputes.e2e-spec.ts`, Playwright                                         |
| 10  | Referees resolve disputes                              | `disputes.e2e-spec.ts`, Playwright referee workspace                                              |
| 11  | Administrative changes are audit logged                | `organizations.e2e-spec.ts`, `disputes.e2e-spec.ts`, Playwright audit page                        |
| 12  | Players receive match notifications                    | `notifications.e2e-spec.ts` (in-app and email via Mailpit), `realtime.e2e-spec.ts`                |
| 13  | Public viewers see current brackets and results        | `public.e2e-spec.ts`, `realtime.e2e-spec.ts`, Playwright champion check                           |
| 14  | Duplicate API/webhook requests don't duplicate results | `matches.e2e-spec.ts` (parallel webhooks), `concurrency.e2e-spec.ts`, `registrations.e2e-spec.ts` |

## Not in the MVP

The spec defers these. The code leaves room for them:

- Round robin and Swiss formats. The engine's plan/state split takes new generators.
- Publisher integrations behind `GameProviderAdapter`. A generic signed webhook is implemented.
- Per-organization Discord and streaming integrations.
- League seasons, global rankings and AI dispute assistance. AI must never decide outcomes.
- Local object storage uses `adobe/s3mock`, because MinIO images are no longer published on Docker Hub. Production should use S3 or a compatible store.
