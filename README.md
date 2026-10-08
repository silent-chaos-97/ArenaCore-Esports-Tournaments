# ArenaCore

Multi-tenant esports tournament & league operations platform.

## Layout

| Path               | Purpose                                                  |
| ------------------ | -------------------------------------------------------- |
| `apps/api`         | NestJS modular monolith (REST `/api/v1`) + async workers |
| `apps/web`         | Next.js Organizer Console and Player/Public Portal       |
| `packages/shared`  | Shared zod schemas, enums and state machines             |
| `packages/bracket` | Pure TypeScript bracket engine                           |

## Getting started

```bash
pnpm install
docker compose up -d
pnpm db:migrate && pnpm db:seed
pnpm dev
```
