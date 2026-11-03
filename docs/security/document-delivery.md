# Server-authoritative document delivery

Base: Operations PR #24, `df04a3e3fa3ac0acdf4713f55a46a896154f271c` (PR #21 -> #22 -> #24). Preserve these branches and the website/Operations portal drafts. No pricing, staff-assignment, H1/H2/H3/H4, Stripe or website persistence changes are included.

## Authorization and state

The Edge Function verifies the bearer with `auth.getUser()`, uses the caller JWT for document/file reads, validates parent objects (or exactly one compatibility-array parent), and passes that verified actor to service-only database operations. The database independently checks exact active division/resource roles, customer/property sharing and optional parent graphs. Client identity headers are unused. No UUID proves authority.

`20261103010000_server_authoritative_delivery.sql` revokes table AND historical column outcome writes. Private operations store immutable provider request bytes, a durable UUID/key, provider credential fingerprint, lease/claim and audit trail. Public functions are SECURITY DEFINER, empty search path, qualified static SQL, service_role-only execution. They are narrow APIs, but their owner is the migration owner; review owner privileges before applying. The service-role key stays inside the function environment; no customer portal reads use it. Missing server configuration fails closed.

Duplicate requests for the same database-derived content/recipient context share an operation. A 90-second claim and consistent document->operation lock order serialize attempts. Changed versions/recipients cannot bypass an unresolved operation. New proposal operations require draft/ready_to_send. Accepted/declined/concurrently edited proposals are not overwritten: acceptance uses a version/status compare-and-set. Direct client INSERT/UPDATE to sent is rejected. Other proposal transitions remain outside this scope.

Provider acceptance is `accepted`, not recipient delivery. Pre-existing outcome entries are labelled `legacy_unverified`; this migration does not attest to their truth. Persistence errors return failure, never success. NULL, missing, expired and superseded claims cannot record a result; terminal outcomes cannot be rewritten by the finalizer.

## Verified Resend contract and recovery

Reviewed 2026-11-03:

- https://resend.com/docs/dashboard/emails/idempotency-keys
- https://resend.com/blog/engineering-idempotency-keys
- https://resend.com/docs/api-reference/emails/retrieve-email

Resend documents POST /emails idempotency with identical key/payload for 24 hours, repeated original responses, conflicting-payload 409, and in-progress 409. Its documentation does not establish an account/key-rotation namespace guarantee here. We use globally unique operation keys, bind operations to a fingerprint of the same configured API credential, sender and renderer revision, and refuse replay after context changes. Retry cutoff is 23 hours from the first attempt, conservatively inside retention. No exactly-once or unlimited-retention claim is made.

Timeouts, malformed successes, conflicts, rate limits and 5xx become uncertain. The same bytes/key can be retried within the bounded contract. Definitive validation/auth rejections are terminal failed operations. A changed payload/new key is never an automatic recovery action.

Expired/context-changed operations require the exact division owner to inspect provider logs without resending. Delivery history exposes the operation UUID and an owner-only "Verify existing provider message" action. It performs GET /emails/:id, verifies the operation tag plus frozen recipient/from/subject/html, records the provider event separately and audits the evidence reference. It does not infer delivery from HTTP acceptance. If an email ID/evidence cannot be established, keep the operation unresolved; do not create another send. Retrieval permission and provider log availability are deployment prerequisites, not verified production facts.

## Cutover and rollback

After the reviewed dependency migrations, coordinate a short send pause, deploy compatible function/UI and apply this additive migration as one release procedure. Never run migrations at app startup. No production action was performed here. Verify service-key/retrieval readiness separately without exposing values. Do not roll back to client outcome grants: disable sends or roll forward a compatible function. Preserve operations/audits for recovery; payload retention requires an approved operational policy.

Coordinate with `security/private-file-attachment-integrity` for attachment policy behavior. There is no cross-migration call dependency. Shared App/Inspections/CI edits need a normal integration review; neither PR replaces the other.

## Validation and limits

- `npm run build`: TypeScript and Vite pass; existing bundle warning.
- `node --experimental-strip-types supabase/functions/crm-send-document/delivery.test.mjs`: 9 pass.
- `deno test --allow-env --node-modules-dir=none supabase/functions/crm-send-document/handler.test.ts`: 15 pass with synthetic transport and no network permission.
- `deno check --node-modules-dir=none supabase/functions/crm-send-document/index.ts`: passes.
- `python3 scripts/test-security.py`: PostgreSQL 17 baseline + ordered migrations, schema-drift rollback, actual-role SQL authorization (all nine roles / three document types), conditional proposal transition, 8-session concurrency, direct PostgREST JWT/mutation/schema checks and both existing financial/price-book suites pass.

The source snapshot requires only function terminators and PK/UNIQUE ordering normalization for an empty database. Auth/Storage infrastructure is a declared synthetic fixture. The unavailable platform `rls_auto_enable()` implementation is not emulated/applied. PostgREST exposes public only in this fixture; this does not verify deployed exposure/default grants. Provider behavior is mocked to its documented contract. No live provider, hosted Supabase, customer data or secrets were used. H1/H2/H3/H4, production catalog/configuration, end-to-end hosted Storage and independent security review remain release gates.

Remote CI run 41648263041 passed build, baseline/SQL/PostgREST suites and Edge Function typechecks, then failed because Node 22 lacks the unprefixed --test-isolation flag. The test invocation was corrected to direct Node execution with type stripping; no application/security behavior changed. Subsequent CI results are recorded in the PR.

Local fixture reruns exhausted Docker disk because anonymous PostgreSQL volumes survived container removal. Three volumes were removed only after tracing their events to this harness; unrelated volumes/drafts were retained. The harness now uses bounded tmpfs PGDATA and removes its own volumes. Fresh SQL/PostgREST reruns passed. Linked Roofr/photo relationships and required bytes also fail closed before sending; these paths are covered by the Edge tests.


## Corrective review follow-up (2026-11-03)

The independent review reproduced two defects at `62fdaf5a6250adba6f94b915f461c4e8a19ea506`: NULL compared equal to an already-cleared claim and allowed accepted -> failed; the sent-proposal shortcut returned old acceptance even after content/recipient edits. Neither is excused by service-only execution. The historical migration remains byte-for-byte unchanged. `20261103030000_bind_delivery_context_and_terminal_claims.sql` replaces the affected functions transactionally.

The finalizer explicitly rejects NULL, missing, expired and superseded claims and locks/checks nonterminal outcome state. SQL tests also reintroduce a matching claim into a terminal synthetic row to prove that claim matching alone cannot rewrite it. Valid claimed failure, uncertainty and acceptance still persist. Proposal compare-and-set retains lifecycle/version checks and additionally requires the content fingerprint, preserving concurrent declined/content changes even without a timestamp trigger.

A private SHA-256 context uses canonical JSONB: document content and relationship IDs, recipient customer ID/name/trimmed email, rendered property address, proposal template, inspection items/photo relationships and file/Storage metadata (excluding last-access timestamps), linked Roofr metadata, and renderer revision `crm-pdf-v2`. It excludes root `status`/`updated_at` so the delivery's own sent transition remains valid when a timestamp trigger is present. Root updated_at is still checked against the renderer's read version at reservation. Proposal transitions additionally compare current content fingerprint against the operation binding; they do not depend solely on a timestamp column that the checked-in proposal migrations do not maintain. Content restoration to exactly the same canonical context intentionally identifies the same logical operation; regenerating a PDF (with variable creation timestamps) never changes its frozen first provider payload.

The new **service-only** `crm_document_delivery_context` independently authorizes the verified actor before the caller-JWT document reads/rendering. Reservation repeats authorization/relationship checks and recomputes the context. The internal `_crm_context` envelope is required and removed before freezing/sending the provider JSON; it is not a caller-asserted identity. Empty search paths, explicit grants and the private-schema boundary are retained. No new browser grant or broad customer access was added.

Matched accepted operations return acceptance only for the same current logical context and an eligible lifecycle state. Changed sent content/recipient/property/template context is rejected, never reported as the prior acceptance. An unresolved different context blocks any new operation. Expiry or changed provider credentials/sender/renderer returns review without a key/body. Retry uses exactly the same operation key and immutable bytes, within the verified bounded provider contract. No exactly-once guarantee is asserted.

Historical operations have NULL context because current records cannot prove old PDF content. The migration never backfills invented attestations. They remain readable/reconcilable by the exact active division owner, using the original credential-only fingerprint for provider GET verification; automatic reuse/resending for that document is blocked. Their safe disposition requires audited manual review/roll-forward, not direct row rebinding or a blind new send. Ordinary new bound operations use the credential/sender/renderer fingerprint. Keep this limitation visible in cutover planning if any pre-correction operations exist.

### Regression evidence and review boundaries

`security_delivery_defect_reproductions.sql` runs both exact defects against the historical migration, then rolls back all synthetic fixtures before the corrective migration. `security_delivery_recovery.sql` runs against the corrected functions and covers unchanged acceptance/status-trigger behavior (an explicit proposal fixture calls the real baseline trigger function; the checked-in proposal migrations do not install that trigger); independent content/email/property/template changes; NULL, expired and superseded claims; terminal immutability; retries at 22h59m and review at 23h+1s / 24h; changed credentials and unresolved document context; pre-render races; membership removal after preflight; wrong-division/unlinked/removed owners; valid owner recovery and conflicting provider IDs; accepted versus sent/delivered events; and unbound historical operations. SQL uses actual service-only entry points with role switches and synthetic catalog setup, not mocked decisions.

The baseline role matrix still covers all nine staff roles and all three document types. Direct PostgREST JWT tests cover table/column mutations, private schemas and denial of all four trusted RPCs for anonymous, owner, unlinked and other-division callers with forged headers. Eight competing database sessions prove one send claim/key. Transport tests use no real provider, and Edge tests have no network permission. Retrieval failure/mismatch/context drift cannot write recovery success; persistence failure cannot report success. The financial and price-book suites execute unchanged against separate disposable databases.

The final source/diff review checks original authorization, server-only outcomes, immutable provider bytes/keys, bounded retries, owner evidence, guarded proposal transitions and accepted-versus-delivered semantics separately from test pass counts. Passing tests are evidence for independent review, **not Workstream A approval**.

For any later authorized release, pause sends, apply ordered migrations through the corrective follow-up, deploy the matching Edge Function, then perform authorized environment checks before resuming. Either mismatched function/migration order fails closed; do not operate the historical defective state as an extended rollout phase. No production action was performed. Secure rollback disables sending or rolls forward; it must not restore browser outcome writes or the old finalizer/shortcut.

Hosted prerequisites remain unverified: actual catalog owners/grants/exposed schemas, configured service credential and provider retrieval scope, real Resend retention/tag/GET behavior, and hosted Storage metadata/byte consistency. Metadata binding is not an independent content hash of remote object bytes; immutable Storage enforcement and end-to-end attachment behavior require Workstream B's separate review. Existing signed URLs retain their TTL. H1/H2 and other previously documented release blockers remain outside this corrective scope. Workstream B, pricing/salesperson code, website drafts, PR targets and draft states are preserved.
