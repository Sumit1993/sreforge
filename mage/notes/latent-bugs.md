---
type: gotcha
tags: [todo-app/issues]
created: "2026-05-25"
updated: "2026-06-01"
last_reviewed: "2026-06-01"
status: active
provenance:
  repo: todo-app-monorepo
  work: docs-hub-migration
---

# Latent bugs (maintainer reference)

> This file documents bugs deliberately present in the seeded `prismalens-labs/todo-api` code that surface when end users do specific things in the UI. Never expose to the agent. Lives only in the private harness.

## Bug A — input length unbounded on POST /todos

### Where

`prismalens-labs/todo-api/src/todos/`:

- `dto/create-todo.dto.ts` — `@IsString()` only on `todo`, **no `@MaxLength(...)` decorator**
- `todos.controller.ts:27` — controller uses `@Body('todo') todo: string` to extract individual fields, **bypassing DTO binding entirely** (so even if `@MaxLength` were added, it wouldn't fire with the current controller pattern)

### Trigger (UI action)

User pastes very large content (>50KB) into the todo input field on the create form and submits.

### What happens

1. Browser POSTs `{"todo": "<5MB string>", "userId": 42}` to `POST /todos`
2. Express body parser accepts the payload (no limit configured in `main.ts`)
3. NestJS ValidationPipe runs but has nothing to validate against (DTO is bypassed)
4. `TodosController.addTodo` passes the string straight to `TodosService.addTodo`
5. Service `withRetry`-wraps `repository.create({ todo: <huge>, userId })`
6. Prisma serializes the huge string and INSERTs into Postgres
7. Network + DB + JSON re-serialize for response = seconds of latency per request

### Symptom

p99 latency on POST `/todos` rises. Sustained → `TodoApiPostTodosLatencyHigh` alert fires (route-filtered).

### Expected fix shape

Two-layer:

1. Add `@MaxLength(1000)` to `dto/create-todo.dto.ts:6`
2. Refactor `todos.controller.ts:27` to bind the DTO:
   ```ts
   @Post()
   async addTodo(@Body() dto: CreateTodoDto) {
     return this.todosService.addTodo(dto.todo, dto.userId);
   }
   ```
3. Optionally add `@db.VarChar(1000)` to `Todo.todo` in `prisma/schema.prisma` for defense in depth.

A partial fix (just adding `@MaxLength` without fixing the controller) would not actually solve the symptom — the ValidationPipe never sees the DTO. A good agent identifies both layers.

### Eval-only validation criteria

- `expected_files_touched`: `src/todos/dto/create-todo.dto.ts`, `src/todos/todos.controller.ts`
- `expected_diff_contains`: `MaxLength` decorator import + decorator on the `todo` field, AND `@Body()` (no string argument) on the controller method

---

## Bug B — no ParseIntPipe on DELETE /todos/:id (amplified by retry-all)

### Where

`prismalens-labs/todo-api/src/todos/`:

- `todos.controller.ts:43-48` — `@Delete(':id') async deleteTodo(@Param('id') id: number)` — type annotation says `number` but NestJS doesn't auto-convert without a pipe
- `apps/api/src/main.ts:160` — `app.useGlobalPipes(new ValidationPipe({ transform: false }))` — `transform: false` explicitly disables auto-coercion
- `todos.service.ts:101-131` — `withRetry` retries ALL errors including validation errors (amplifier)

### Trigger (UI action)

User navigates the UI to `/todos/abc` (typo, browser autocomplete glitch, or via API directly). The UI's delete-by-id mechanism may also misbehave if a non-integer reaches it.

### What happens

1. `DELETE /todos/abc` → controller receives `id = "abc"` (string, not number — `transform: false`)
2. Service calls `repository.delete("abc")`
3. Repository: `prisma.todo.delete({ where: { id: Number("abc") } })` — `Number("abc")` is `NaN`
4. Prisma raises `PrismaClientValidationError`
5. `withRetry` catches it and retries 3× (100ms, 150ms, 225ms backoff)
6. After ~475ms, 500 finally returns

Aggregate effect under load: each bad DELETE costs ~475ms of DB churn. Even modest rates (10/s of bad DELETEs) saturate the DB connection pool.

### Symptom

- `TodoApiDeleteErrorRateHigh` fires within ~3 minutes (5xx rate exceeds 5%)
- `TodoApiLatencyP99High` fires within ~6 minutes (cumulative retry latency pushes p99 above 2s)

### Expected fix shape

Two-layer (matching Bug A's pattern):

1. Add `ParseIntPipe` to the route parameter:
   ```ts
   @Delete(':id')
   async deleteTodo(@Param('id', ParseIntPipe) id: number) { ... }
   ```
   (Apply to `@Patch(':id')` too for consistency.)

2. Fix `withRetry` in `todos.service.ts` to skip non-transient errors:
   ```ts
   const isRetryable = (err: Error): boolean => {
     if (err.name === 'PrismaClientValidationError') return false;
     if (err.name === 'PrismaClientKnownRequestError') {
       // P2025 = record not found, P2002 = unique constraint, etc. — non-transient
       return !['P2025', 'P2002', 'P2003'].includes((err as any).code);
     }
     return true;
   };
   ```

A partial fix (just `ParseIntPipe`) fixes the symptom but leaves the retry-amplifier live for any future controller-level error. A good agent identifies both.

### Eval-only validation criteria

- `expected_files_touched`: `src/todos/todos.controller.ts`, optionally `src/todos/todos.service.ts`
- `expected_diff_contains`: `ParseIntPipe` import + `ParseIntPipe` decorator on the DELETE route. Bonus: `isRetryable` filter or equivalent in `withRetry`.

---

## Pre-existing bugs that survive into the seeded code

Three additional latent bugs already commented in `apps/api/src/todos/todos.service.ts` as `BUG #3`, `BUG #4`, `BUG #5`. These comments are STRIPPED by `tools/lib/extract.ts` during Phase 3 extraction. The bugs themselves remain in the seeded code.

| Bug | Brief |
|---|---|
| #3 (closure-captured cache) | `startCacheCleanup` snapshots `this.requestCache`; `recreateCacheIfNeeded` reassigns it. Cleanup interval drains the old Map → memory leak. Only triggers if cache size > 1000 (singleton `'todos:all'` key never reaches this in current code; latent). |
| #4 (timeout mismatch) | Service `withTimeout` wraps at 3s; HttpModule timeout is 5s. The wrapping fires first. Confusing failure-mode but not load-bearing. |
| #5 (retry-all) | `withRetry` retries all errors including validation. This is the amplifier in Bug B; also affects any other validation-error path. |

These could become first-class scenarios in v2+ if needed.
