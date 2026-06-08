# Reference fix — latency-retry-storm

This is the canonical reference solution. The harness uses it as a **non-blocking
diff hint** and scenario authors use it as the source of truth for the fault.
The oracle grades **behavior, not diff-match** — any change that produces the
acceptance behavior below passes, regardless of how closely it matches this diff.

## Root cause

Two defects compound into a retry storm:

1. **Missing input validation on the route params.** In
   `apps/api/src/todos/todos.controller.ts`, the `:id` param on the `PATCH` and
   `DELETE` routes is typed `number` but bound with a bare `@Param('id')`. NestJS
   does not coerce or validate it, so a non-integer id such as `abc` arrives as
   the string `"abc"`. Downstream `Number("abc")` is `NaN`, which Prisma rejects
   as an invalid argument (`PrismaClientValidationError`).

2. **Indiscriminate retry of non-transient errors.** In
   `apps/api/src/todos/todos.service.ts`, `withRetry()` retries **every** error,
   including the Prisma validation error above. A validation error is
   deterministic — it will fail identically on every attempt — but the wrapper
   still runs the operation 3 times with exponential backoff (~250ms of `sleep`).

Together, a single `DELETE /api/todos/abc` spends ~270ms on the server before
returning HTTP 500. Under sustained malformed-DELETE load this amplification
drives p99 to ~0.49s and fires `TodoApiLatencyP99High` (p99 > 0.3s for 30s).

The fix is to **reject malformed input at the edge** (fast 4xx, no DB call, no
retry) and to **never retry non-transient errors**.

## Fix 1 — validate the route param (`todos.controller.ts`)

Add `ParseIntPipe` and apply it to the `:id` param on `PATCH` and `DELETE`. A
non-integer id now short-circuits to HTTP 400 in ~5ms, before any service or DB
work.

```diff
 import {
   Controller,
   Get,
   Post,
   Patch,
   Delete,
   Param,
   Body,
+  ParseIntPipe,
 } from '@nestjs/common';
```

```diff
   @Patch(':id')
   async toggleTodoStatus(
-    @Param('id') id: number,
+    @Param('id', ParseIntPipe) id: number,
     @Body('completed') completed: boolean,
   ) {
```

```diff
   @Delete(':id')
-  async deleteTodo(@Param('id') id: number) {
+  async deleteTodo(@Param('id', ParseIntPipe) id: number) {
```

## Fix 2 — skip non-transient errors in `withRetry` (`todos.service.ts`)

Add an `isRetryable(error)` guard. Non-transient errors (Prisma validation
errors and the deterministic Prisma error codes `P2025`, `P2002`, `P2003`) are
rethrown immediately instead of being retried.

```diff
+import { Prisma } from '@prisma/client';
```

```diff
+  // Non-transient errors fail identically on every attempt — never retry them.
+  private isRetryable(error: unknown): boolean {
+    if (error instanceof Prisma.PrismaClientValidationError) {
+      return false;
+    }
+    if (error instanceof Prisma.PrismaClientKnownRequestError) {
+      // P2025 not found, P2002 unique violation, P2003 FK violation — deterministic.
+      if (['P2025', 'P2002', 'P2003'].includes(error.code)) {
+        return false;
+      }
+    }
+    return true;
+  }
+
   private async withRetry<T>(
     operation: () => Promise<T>,
     operationName: string,
   ): Promise<T> {
     let lastError!: Error;

     for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
       try {
         return await operation();
       } catch (error) {
         lastError = error as Error;
+
+        // Do not amplify non-transient failures with retries + backoff.
+        if (!this.isRetryable(error)) {
+          throw error;
+        }

         if (attempt < this.MAX_RETRIES - 1) {
```

With Fix 1 in place the malformed id never reaches Prisma, so Fix 2 is the
defense-in-depth layer: even a non-transient error raised on a *valid* path
(e.g. a `P2025` on a missing row) no longer incurs the retry/backoff penalty.

## Acceptable fix families

The oracle is behavioral. A submission passes if the **deployed** service
exhibits all of the following under still-active storm load:

- **Fast 4xx on malformed input.** `DELETE /api/todos/abc` (and the equivalent
  `PATCH`) returns a 4xx in roughly single-digit milliseconds — no DB round
  trip, no retry/backoff. Achievable via `ParseIntPipe`, a global/`ValidationPipe`
  with a typed DTO, a custom pipe, or equivalent edge validation.
- **No retry amplification of non-transient errors.** Deterministic errors
  (Prisma validation errors, `P2025`/`P2002`/`P2003`, etc.) are not retried.
  Achievable via an `isRetryable` guard, an allowlist of transient errors, or
  removing retries from paths that cannot benefit.
- **p99 returns below threshold under active load.** With the storm still
  running, p99 falls and stays below 0.3s, so `TodoApiLatencyP99High` clears.
- **Error rate clears.** The malformed requests now return a fast, expected 4xx
  rather than a slow 5xx, so any 5xx error-rate alert also clears.

Both root-cause fixes are not strictly required individually — what is graded is
the resulting behavior. A fix that makes malformed DELETEs fast-fail *and* stops
non-transient retry amplification will satisfy every signal. The oracle never
checks for textual similarity to this reference.
