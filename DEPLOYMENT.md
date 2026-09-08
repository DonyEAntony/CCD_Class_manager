# Dashboard and payment-history release

## Verified

- Payment snapshot migration and restart idempotency in the designated test database.
- Imported payments followed by separate manual check and credit-card installments.
- Shared payment deduplication, cents, retry handling, transaction rollback and concurrent payments.
- Parent history and balances, individual receipts, staff attendance persistence and assignment restrictions through the full app.
- Two-child family balances and payment buttons across unpaid, shared-import partial payment, and fully paid states; no false admin confirmation queue.
- Simultaneous migration startup leaves ledger totals unchanged.

## Before release

1. Save a restorable database backup and the currently deployed application version.
2. Deploy all tracked changes and new source files together, including the `dashboard-*.js`, `payment-*.js` modules and new EJS partials. Do not deploy `test-results`, local `.env`, test credentials or sample data.
3. Use the production host's existing database configuration. The development `.env` currently points to the test database; it must not replace production configuration.
4. Pause payment entry/imports and stop the old app instances during the first migration so they cannot overwrite snapshots while opening entries are being copied.

## First startup

Start the updated app normally. Its database initialization creates the two payment-history tables, copies current saved payment snapshots once, and changes compatibility amount columns to accept cents. A database-scoped lock serializes migration startup. The `payment_ledger_migrated` setting records completion.

Review startup output before reopening payment entry. A failed migration stops startup and rolls back the history-copy transaction; the additive tables or amount-column changes may already exist and are safe to retry after investigating the failure.

## Verify after startup

- Check an existing imported payment on a parent dashboard and its corresponding student details.
- Confirm staff see assigned sessions and that their calendars open.
- Check payment history totals and receipts. Use a test account for any test writes; do not invent a real parish payment.
- Confirm the production reminder worker and email settings match the intended production settings. The test launcher deliberately disables them.

## Limits and recovery

Opening history entries preserve only the payments still present in the old snapshot fields. Earlier overwritten payments cannot be reconstructed automatically. Family balances are calculated by registration year from saved charges and unique payments. Only missing or conflicting fee/payment data requires office confirmation; multiple children alone does not.

If deployment fails before new payments are entered, stop the app and restore the saved application/database backup as appropriate. Once new history entries have been recorded, preserve and export those entries before any rollback; the old application does not understand the ledger and must not resume payment entry without a recovery plan. Do not delete ledger tables or reset the migration marker to retry a release.
