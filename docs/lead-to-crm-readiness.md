# Lead-to-CRM implementation and release gates

Source work only; no production deployment, customer-data mutation, migration application, calendar activation or real notification occurred.

## Transaction and retry contract

Both existing website servers call `crm_receive_website_lead` with their fixed division, a stable UUID from the public form and the original inquiry payload. Only the server-side service credential can execute the RPC. Browsers receive no service credential. Database functions live behind explicit execution grants; private receipt, attempt, notification and booking tables have RLS and no browser or service-role table grants.

The first call saves an immutable payload and fingerprint. A locked `(division, submission key)` receipt serializes retries. The CRM customer/contact/property/lead, follow-up task, source mirror, audit event and notification queue commit together. An inner failure rolls back the whole graph while retaining a failed receipt and append-only attempt. Changed details under the same key are rejected. Successful retries return the original lead without resetting its stage, assignee or notes. A lost HTTP response after commit is safe to retry.

Forms save the UUID, payload digest and initial attribution before sending; they do not store contact details in browser storage. Network failures retain the form and its reference. Changed form details receive a new key. Browser storage restrictions limit persistence to the current page, and clearing browser storage loses that local reference; an already saved receipt is still recoverable by an authorized owner. Independently created keys are independently submitted inquiries, not a probabilistic duplicate detector.

Matching requires one exact division-scoped customer identity with consistent name/company, email and normalized phone. Ambiguous or insufficient identities create separate customers. Properties match only for that customer and a complete exact address including postal code. An incomplete address remains in the original payload/lead notes; no city or property is fabricated.

An owner can inspect failed receipts and retry their saved payload from Leads → Website intake. Receipts paginate with failures first. Only an active owner of the exact division can inspect/retry them. Legacy historical imports remain separate; this migration never backfills the old website records.

One active salesperson is assigned when available; otherwise one active division owner receives the lead and follow-up. Multiple candidates are not guessed. The existing assignment UI supports later staffing changes.

## Incoming photographs and documents

Intake receipts retain bounded original photo bytes privately (up to 25 MB for the request, 15 MB per supported file, 10 files). The public form caps raw photograph selection at 18 MB to allow base64 overhead. MIME signatures and sizes are checked inside the transaction. Lead/source lists contain metadata, not binary content. Transient file-picker IDs/times are excluded from retry identity, so reselecting identical files does not generate a new inquiry. Authorized lead readers can download an attachment through exact-division RPC checks; anonymous/cross-division readers cannot. Original attachment bytes are covered by the immutable receipt and per-file SHA-256. These incoming files use private receipt storage, not the existing Storage bucket; existing CRM Storage workflows remain unchanged. Production database retention, encrypted backups and size limits must be verified before cutover.

## Notifications

Internal alerts and valid-email customer acknowledgements have separate durable jobs. `crm-intake-notifications` is service-authenticated and default-off (`INTAKE_NOTIFICATIONS_ENABLED` must explicitly be true). It requires a verified sender, internal recipient and Resend credential. No real worker or scheduler was enabled.

Claims freeze the exact body and provider idempotency key. Concurrent claims are busy, definitive provider rejections are failed, and unknown/time-out outcomes remain uncertain. Stale sending claims and operations beyond the provider retry window require manual review; they are never blindly resent. Database finalizer failure propagates. `sent` means provider acceptance, not recipient delivery. Owner intake status shows each notification state. A production scheduler, provider acceptance/retention behavior and a runbook for uncertain notification outcomes must be verified before activation. No notification success is promised by a website confirmation.

## Booking

The database store and server engine are prepared, isolated and disabled. The approved draft retains America/Chicago and Monday–Saturday 08:30–18:00; Sunday is closed. Calendars, operator bindings, durations, buffers, notice/horizon and customer URL bindings stay unset. Service-only reservations serialize operator capacity across divisions. Uncertain rescheduling blocks both old and proposed slots. Browser roles cannot invoke the store.

The Google adapter supports FreeBusy, deterministic event IDs, create, cancel and patch with provider notifications suppressed. Tests use injected HTTP only. Availability/access failure closes booking. Overlapping rescheduling needs staff calendar review because FreeBusy cannot safely distinguish the existing appointment from another overlapping event. Uncertain provider operations retain reservations and need reconciliation; there is no automatic claim that absence proves rejection. Confirmation/reminder dispatch, external-calendar race behavior, OAuth/access, hosted cancellation/rescheduling and authenticated staff management remain release gates. There is no public booking endpoint and no real booking activation.

## Production observations (read-only, November 4, 2026)

The environment exposes only public browser configuration and no production administrative database, server-service, notification or calendar credential binding. Hosted Cloud Run environment variables, secrets, live migrations, grants, RLS/default grants, Storage policy catalog, backups/PITR, monitoring and serving revisions cannot be established from repository state.

Public Supabase settings responded 200: email is enabled, public sign-up is **not disabled**, email autoconfirm is false. Anonymous limit-zero requests to CRM leads and website source returned 401/42501. Private bucket metadata returned `NoSuchBucket` anonymously; this does **not** establish whether the private bucket is missing or hidden by authorization. No customer rows were requested.

Use `scripts/production-readiness.sql` later with approved administrative read-only access for the actual migration/catalog/policy/bucket inventory. Reconcile migration history before applying anything; the historical baseline is a disposable test fixture, not a production reset script.

## Release order and approval boundaries

1. Validate exact source commits and hosted catalog/bucket prerequisites in a disposable or staging environment.
2. Confirm encrypted server-side service binding and restrictive website/source policies. Consider a dedicated least-privilege gateway identity as a subsequent hardening step; the present server credential already exists in the original server contract and is never a Vite value.
3. Apply reviewed additive migrations in order during an approved cutover; never reset or seed production, and never run automatic legacy imports.
4. Deploy compatible website and CRM builds only after approval. With missing migrations or credentials, new website code fails visibly instead of claiming delivery.
5. Verify hosted TRD and CRD receipt-to-lead delivery with approved controlled data, notification sender/account behavior, monitoring, alert routing, retention and backup restore policy.
6. Separately approve notification scheduling and booking activation after their missing dependencies and failover procedures are verified.

Local/synthetic tests establish implementation behavior, not hosted readiness or production approval. Exact local/remote results and commit IDs belong in the final run report.
