# Server-authoritative document delivery

Base: Operations PR #24, `df04a3e3fa3ac0acdf4713f55a46a896154f271c` (PR #21 -> #22 -> #24). Preserve these branches and the website/Operations portal drafts. No pricing, staff-assignment, H1/H2/H3/H4, Stripe or website persistence changes are included.

## Authorization and state

The Edge Function verifies the bearer with `auth.getUser()`, uses the caller JWT for document/file reads, validates parent objects (or exactly one compatibility-array parent), and passes that verified actor to service-only database operations. The database independently checks exact active division/resource roles, customer/property sharing and optional parent graphs. Client identity headers are unused. No UUID proves authority.

`20261103010000_server_authoritative_delivery.sql` revokes table AND historical column outcome writes. Private operations store immutable provider request bytes, a durable UUID/key, provider credential fingerprint, lease/claim and audit trail. Public functions are SECURITY DEFINER, empty search path, qualified static SQL, service_role-only execution. They are narrow APIs, but their owner is the migration owner; review owner privileges before applying. The service-role key stays inside the function environment; no customer portal reads use it. Missing server configuration fails closed.

Duplicate requests for the same document version/recipient share an operation. A 90-second claim and consistent document->operation lock order serialize attempts. Changed versions/recipients cannot bypass an unresolved operation. New proposal operations require draft/ready_to_send. Accepted/declined/concurrently edited proposals are not overwritten: acceptance uses a version/status compare-and-set. Direct client INSERT/UPDATE to sent is rejected. Other proposal transitions remain outside this scope.

Provider acceptance is `accepted`, not recipient delivery. Pre-existing outcome entries are labelled `legacy_unverified`; this migration does not attest to their truth. Persistence errors return failure, never success. A stale claim cannot record a result.

## Verified Resend contract and recovery

Reviewed 2026-11-03:

- https://resend.com/docs/dashboard/emails/idempotency-keys
- https://resend.com/blog/engineering-idempotency-keys
- https://resend.com/docs/api-reference/emails/retrieve-email

Resend documents POST /emails idempotency with identical key/payload for 24 hours, repeated original responses, conflicting-payload 409, and in-progress 409. Its documentation does not establish an account/key-rotation namespace guarantee here. We use globally unique operation keys, bind operations to a fingerprint of the same configured API credential, and refuse replay after context changes. Retry cutoff is 23 hours from the first attempt, conservatively inside retention. No exactly-once or unlimited-retention claim is made.

Timeouts, malformed successes, conflicts, rate limits and 5xx become uncertain. The same bytes/key can be retried within the bounded contract. Definitive validation/auth rejections are terminal failed operations. A changed payload/new key is never an automatic recovery action.

Expired/context-changed operations require the exact division owner to inspect provider logs without resending. Delivery history exposes the operation UUID and an owner-only "Verify existing provider message" action. It performs GET /emails/:id, verifies the operation tag plus frozen recipient/from/subject/html, records the provider event separately and audits the evidence reference. It does not infer delivery from HTTP acceptance. If an email ID/evidence cannot be established, keep the operation unresolved; do not create another send. Retrieval permission and provider log availability are deployment prerequisites, not verified production facts.

## Cutover and rollback

After the reviewed dependency migrations, coordinate a short send pause, deploy compatible function/UI and apply this additive migration as one release procedure. Never run migrations at app startup. No production action was performed here. Verify service-key/retrieval readiness separately without exposing values. Do not roll back to client outcome grants: disable sends or roll forward a compatible function. Preserve operations/audits for recovery; payload retention requires an approved operational policy.

Coordinate with `security/private-file-attachment-integrity` for attachment policy behavior. There is no cross-migration call dependency. Shared App/Inspections/CI edits need a normal integration review; neither PR replaces the other.

## Validation and limits

- `npm run build`: TypeScript and Vite pass; existing bundle warning.
- `node --experimental-strip-types supabase/functions/crm-send-document/delivery.test.mjs`: 8 pass.
- `deno test --allow-env --node-modules-dir=none supabase/functions/crm-send-document/handler.test.ts`: 8 pass with synthetic transport and no network permission.
- `deno check --node-modules-dir=none supabase/functions/crm-send-document/index.ts`: passes.
- `python3 scripts/test-security.py`: PostgreSQL 17 baseline + ordered migrations, schema-drift rollback, actual-role SQL authorization (all nine roles / three document types), conditional proposal transition, 8-session concurrency, direct PostgREST JWT/mutation/schema checks and both existing financial/price-book suites pass.

The source snapshot requires only function terminators and PK/UNIQUE ordering normalization for an empty database. Auth/Storage infrastructure is a declared synthetic fixture. The unavailable platform `rls_auto_enable()` implementation is not emulated/applied. PostgREST exposes public only in this fixture; this does not verify deployed exposure/default grants. Provider behavior is mocked to its documented contract. No live provider, hosted Supabase, customer data or secrets were used. H1/H2/H3/H4, production catalog/configuration, end-to-end hosted Storage and independent security review remain release gates.

Remote CI run 41648263041 passed build, baseline/SQL/PostgREST suites and Edge Function typechecks, then failed because Node 22 lacks the unprefixed --test-isolation flag. The test invocation was corrected to direct Node execution with type stripping; no application/security behavior changed. Subsequent CI results are recorded in the PR.

Local fixture reruns exhausted Docker disk because anonymous PostgreSQL volumes survived container removal. Three volumes were removed only after tracing their events to this harness; unrelated volumes/drafts were retained. The harness now uses bounded tmpfs PGDATA and removes its own volumes. Fresh SQL/PostgREST reruns passed. Linked Roofr/photo relationships and required bytes also fail closed before sending; these paths are covered by the Edge tests.
