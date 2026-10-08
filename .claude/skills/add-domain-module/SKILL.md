---
name: add-domain-module
description: Scaffold or extend a NestJS domain module in apps/api the ArenaCore way: controller, service, zod schemas in packages/shared, tenant/role guards, audit, outbox and tests. Use when adding a new API module or endpoint.
---

# Adding a domain module

Layout for module `<name>`:

```
packages/shared/src/<name>.ts            zod input schemas + output types (export from index.ts)
apps/api/src/modules/<name>/
  <name>.module.ts
  <name>.controller.ts                   thin: parse → service → map
  <name>.service.ts                      business logic, transactions
  <name>.service.spec.ts                 unit tests (pure logic)
apps/api/test/<name>.e2e-spec.ts         HTTP-level tests against real Postgres
```

## Checklist

1. **Schemas first.** Define the input schema in `@arenacore/shared` and apply it with `@Body(new ZodValidationPipe(schema))`.
2. **Auth.**
   - Routes require authentication by default. Mark public routes with `@Public()`.
   - Organization-scoped routes live under `/orgs/:orgId/...` and use `@Roles('OWNER','ADMIN',…)`, which `TenantGuard` enforces.
   - Tournament-scoped referee permissions go through `AccessService.assertTournamentRole`.
3. **Tenant filter.** Every Prisma query on tenant data includes `organizationId: ctx.orgId`.
4. **Transactions.** Wrap each mutation in `this.prisma.$transaction(async (tx) => { ... })`. Pass `tx` to:
   - `audit.record(tx, {...})` for admin actions
   - `outbox.emit(tx, 'EventName', payload)` for domain events
5. **State machines.**
   - Use `assertTransition(machine, from, to)` from `@arenacore/shared`. Never set status strings ad hoc.
   - Update with `where: { id, version }` and `version: { increment: 1 }`. When nothing is updated, throw `ConflictException`.
6. **Idempotency.** Endpoints that create records must use the `@Idempotent('<scope>')` decorator.
7. **Register the module** in `app.module.ts`.
8. **Tests.** Cover the happy path, an authorization failure (wrong role or wrong organization), an invalid state transition, and duplicate submission.
