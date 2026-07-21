# Reference Fix

**Root cause:** A schema-cleanup deploy dropped `ix_books_owner_lower_title`. The default `GET /v1/books` title-sort reverted to full seq-scan + top-N sort of the whole library on every request, saturating CPU.

**The fix:** A roll-forward migration re-creating the index.

**Acceptable fix families:**
1. A roll-forward migration re-creating `ix_books_owner_lower_title` (canonical).
2. A roll-forward migration creating any functionally equivalent index that makes the planner serve `WHERE owner_id=? ORDER BY lower(title) LIMIT 25` from an index (e.g. adds more columns but still leads with `owner_id, lower(title)`).
3. Reverting the drop **via a new migration** (alembic `downgrade` semantics rolled into a forward file).

**NOT acceptable / will fail closed:**
- Deleting the drop-migration file. **WARNING:** If a fix deletes the drop-migration file while the DB is still at the drop revision, alembic can't locate the current revision. `flask db upgrade` errors out, `entrypoint.sh` hits `FATAL`, the container never starts, and there is no redeploy. `ci_green`/`alert_cleared` will never be satisfied and the run fails.
- A `patch`-profile diff that doesn't restore the index.
- Anything that only clears the alert by stopping load.
