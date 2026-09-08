# Dashboard and payment-history release

## Correct an existing payment amount

Deploy `payment-correction.js`, `payment-maintenance.js`, the updated void service,
schema, app, attention helper, and `admin-payment-correction.ejs` together.
Startup creates `tuition_payment_corrections` on already-migrated databases.
Admins can correct amounts from Payment amounts to confirm or student payment history.
The change records old/new amounts, actor, time, and reason, and refreshes linked
snapshots in one transaction. Voided entries cannot be corrected; stale edits are
rejected. A repeated identical correction adds no audit entry or payment.
If a separate manual payment was already entered for the same transaction, review
and void that duplicate; correcting the original does not remove other payments.

Verified through the admin form in the designated test database: correcting a NULL
amount preserves the payment ID, records the audit, and removes its amount warning.

## Registration review update

Deploy `public/registration-steps.js`, both registration templates (including the
new `registration-family-review.ejs`), and `app.js` together. Wizard saves now keep
children incomplete until the explicit family submission. Existing registrations
are not migrated. The family review context uses the current authenticated session.
Keep the session active to resume that same family review; saved children remain
available on the dashboard if the session expires.

Verified with two synthetic children in the designated test database: draft saves,
save-and-return to the previous child, family review, and final status transition.
Browser checks cover step validation, retained field/file values, and review edits.

## Persistent payment review

Deploy `payment-exceptions.js` and `views/admin-payment-review.ejs` with the updated
app, schema, import page, and dashboard partial. Startup adds the exceptions table.
Applying an import saves accepted skipped, unmatched, duplicate, and invalid-amount
rows for later review. Upload previews alone do not save anything. Older discarded
rows cannot be recovered without uploading their source export again.
Matching and resolution are transactional, and matching uses the ledger's unique
entry key to prevent a second payment. Closing with a note does not change balances.

## Payment corrections update

Deploy `payment-void.js` with the updated payment modules, app, and admin template.
Startup creates the additive `tuition_payment_voids` audit table even on databases
whose opening ledger migration is complete. Stop older app instances before enabling
voids: older versions do not exclude voided entries from balances.
Admins can void a payment with a required reason, then record a replacement using
Record payment. A shared payment is voided for every linked child. This is an
accounting correction only; it does not refund a check or card transaction.
The original entry and void actor/time/reason remain visible in admin history.

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
