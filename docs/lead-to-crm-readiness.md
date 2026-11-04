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

Manual CRM scheduling now requires an explicit end time, links the selected lead/customer/property, and assigns the current operator. Lead choices display customer names, and property choices are restricted to that customer.

## Notifications

Internal alerts and valid-email customer acknowledgements have separate durable jobs. `crm-intake-notifications` is service-authenticated and default-off (`INTAKE_NOTIFICATIONS_ENABLED` must explicitly be true). It requires a verified sender, internal recipient and Resend credential. No real worker or scheduler was enabled.

Claims freeze the exact body and provider idempotency key. Concurrent claims are busy, definitive provider rejections are failed, and unknown/time-out outcomes remain uncertain. Stale sending claims and operations beyond the provider retry window require manual review; they are never blindly resent. Database finalizer failure propagates. `sent` means provider acceptance, not recipient delivery. Owner intake status shows each notification state. A production scheduler, provider acceptance/retention behavior and a runbook for uncertain notification outcomes must be verified before activation. No notification success is promised by a website confirmation.

## Booking

The database store and server engine are prepared, isolated and disabled. The approved draft retains America/Chicago and Monday–Saturday 08:30–18:00; Sunday is closed. Calendars, operator bindings, durations, buffers, notice/horizon and customer URL bindings stay unset. Service-only reservations serialize operator capacity across divisions and check existing CRM appointments. Confirmed bookings create/update CRM appointments; confirmed cancellations cancel them. Manual appointment writers and booking operations share a statement-before-row capacity lock and require READ COMMITTED once booking is introduced. Existing workflows are not capacity-gated while booking is disabled and no booking records exist. Unknown appointment end times conservatively block later slots until staff supplies an end time. Uncertain rescheduling blocks both old and proposed slots. Browser roles cannot invoke the store.

The Google adapter supports FreeBusy, deterministic event IDs, create, cancel and patch with provider notifications suppressed. Tests use injected HTTP only. Availability/access failure closes booking. Overlapping rescheduling needs staff calendar review because FreeBusy cannot safely distinguish the existing appointment from another overlapping event. Uncertain provider operations retain reservations and need reconciliation; there is no automatic claim that absence proves rejection. Hosted verification of confirmation/reminder dispatch, external-calendar race behavior, OAuth/access, cancellation/rescheduling and authenticated staff management remains a release gate; the default-off source implementations below are covered by synthetic tests. There is no public booking endpoint and no real booking activation.

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

## Continued readiness work (November 4, 2026)

The access model is invitation-only employee authorization. Evidence: login uses
`shouldCreateUser: false`, there is no signup UI, the Auth trigger creates only a
profile, and CRM authority comes from active database memberships, never editable
Auth metadata. The historical owner is intentionally a full CRM administrator;
ordinary operational reads/writes and the new service operations remain scoped to
division. The repository does not configure hosted Auth signup, so its enabled
state cannot be attributed to a particular change without hosted audit access.
The login copy now describes the access requirement without falsely promising that
the hosted signup API is disabled. **Owner decision:** approve disabling public
signup after confirming that the shared Supabase project has no other approved
self-service consumers. No live Auth setting or access policy was changed.

New additive source migrations `20261104050000` through `20261104080000`:

- Reject mismatched lead/contact/customer/property associations, including trusted
  writes across divisions. Existing rows are not rewritten. Provider-bound
  appointments cannot be reassociated independently of their booking.
- Reconcile uncertain calendar operations only from positive, claim-bound provider
  evidence. Absence never releases uncertain creation/move capacity. Cancellation
  can be settled after verified writable-calendar absence. Reconciliation reuses
  the atomic CRM appointment finalizer; it never repeats provider creation.
- Provide a read-only scheduling status RPC without calendar IDs or claim tokens.
  The CRM offers staff booking, rescheduling, cancellation and evidence checks only
  when database booking is enabled; manual appointments remain available. Manual
  start/end entry and display explicitly use Central Time, independent of browser
  timezone. DST gaps and ambiguous folds are rejected.
- Add a separate, default-off operational outbox for assignment notifications,
  appointment updates, reminders and project-completion updates. Capture and
  delivery are independent disabled database gates. Reminder lead time stays null
  until approved; no default was invented. Rescheduling invalidates pending old
  reminders. Claims check current appointment/assignment state. Failed sends need
  exact-division owner recovery; uncertain outcomes cannot be blindly retried.
- Verify raw signed Resend/Svix callbacks before recording delivered/bounced
  evidence. Replayed callbacks are idempotent; callbacks arriving before HTTP
  acceptance are retained. Bounce evidence cannot regress to delivered. Intake
  acknowledgements share these receipts while retaining `sent = provider accepted`.
- Invitation assignments use a service-only, exact-owner RPC and cannot demote an
  existing owner or create owner access. Existing-account lookup paginates instead
  of treating the first 1,000 users as the complete directory.

Manual tasks now receive the creating operator as owner and can be progressed or
completed in the task list. Manual appointment status can also be maintained; a
provider-bound cancellation still requires the verified calendar workflow.

### Default-off runtime bindings

The website's `/commercial/api/staff/booking` is mounted but returns disabled
before any network work unless `BOOKING_ENABLED=true` and runtime preflight passes.
It verifies Auth sessions server-side and derives the actor independently of JSON;
`crm_booking_staff_context` checks exact active scheduling membership and record
ownership. Cross-origin access is limited to the exact HTTPS
`BOOKING_STAFF_ORIGIN`. The runtime needs existing server Supabase bindings,
`BOOKING_POLICY_JSON`, `BOOKING_PROVIDER_VERIFIED`, and server-only
`GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, and
`GOOGLE_CALENDAR_REFRESH_TOKEN`. OAuth refresh is bounded and transport-injected in
tests. No credentials are stored in booking policy or exposed to Vite.

`OPERATIONAL_NOTIFICATIONS_ENABLED` separately gates the existing service-authenticated
worker. `NOTIFICATION_RECEIPTS_ENABLED` and `RESEND_WEBHOOK_SECRET` gate the new
`crm-notification-receipts` function. A future deployment of that webhook must let
signed provider requests reach the handler without requiring a Supabase user JWT;
its raw-body signature check is mandatory. No function or scheduler was deployed,
no callback endpoint was registered, and all provider calls used test transports.

### Updated hosted observations and remaining gates

A fresh public GET-only inspection on November 4 confirmed signup enabled and
email autoconfirm disabled. Anonymous limit-zero requests for leads, customers,
properties, files and legacy intake were denied (401/42501). The financial
transactions endpoint returned 404/PGRST205: it may be absent or unexposed; this is
not evidence that financial migrations are installed. Bucket metadata remains
unverifiable anonymously. No customer rows were requested.

`python3 scripts/inspect-public-readiness.py` repeats these bounded observations
using only the existing local public binding. `scripts/production-readiness.sql`
is a read-only administrative inventory of migrations, policies including their
expressions, grants/default grants, private schemas, disabled gates, bucket
metadata and aggregate association/capacity anomalies. It was not run against
production because no administrative database binding is available.

See [production operations](production-operations.md) for the cutover, rollback,
monitoring and backup verification requirements. Source tests do not establish
hosted backup/PITR, restore success, provider OAuth authority, live configuration,
external-calendar race controls, notification sender approval, approved reminder
intervals, or deployment status. Those remain release gates; booking and real
notification delivery must remain off until approved.
