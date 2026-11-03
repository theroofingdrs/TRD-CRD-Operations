# Server-authoritative document delivery

Draft PR #26 targets Operations PR #24, `reconcile/pricing-engine` at `df04a3e3fa3ac0acdf4713f55a46a896154f271c`, after PR #21 -> #22 -> #24. Preserve that stack and all original worktrees/drafts. No Workstream B, pricing/salesperson, website, H1–H4 or production work is included. **This implementation is not approved or production-ready; another independent adversarial review is required.**

## Root cause and immutable rendering contract

The independent review at `1b7f8060e0afe66df35f1b281c135a392c6673fb` reproduced R1 with the actual Edge renderer and database RPCs: capture property A, change it to B, independently read/render B, restore A, reserve under A's fingerprint, then falsely reuse that acceptance for A. There was one provider POST, not a demonstrated duplicate send. Comparing before/after database fingerprints did not prove the actual rendering inputs. A PDF hash alone would not repair that missing relationship.

`20261103040000_freeze_document_render_snapshot.sql` adds the following contract without editing either historical security migration:

1. **Caller-RLS capture:** `crm_document_render_inputs(type,id)` is STABLE, SECURITY INVOKER, empty search path and authenticated-only execution. One database statement snapshot captures the document, customer identity/name/email, rendered property address, proposal template, inspection items/photos, linked file metadata, Storage object metadata and linked Roofr report. It has no actor override, performs no writes and inherits the caller's existing table/Storage RLS and column grants. Missing required parents fail closed. It grants no additional base-table access.
2. **Authorized freeze:** the Edge verifies its bearer with `auth.getUser()` and passes that verified actor plus the caller-RLS inputs to service-only `crm_freeze_document_render`. The function checks exact active division/resource authority and graph consistency before and after locking the root. It compares the complete caller snapshot against an authoritative database snapshot. A source change or RLS-hidden dependency causes rejection, not an elevated fallback read returned to the caller.
3. **Immutable identity:** `delivery_private.render_snapshots` stores the exact inputs, first capture timestamp, actor, document identity and canonical SHA-256 context. RLS, absent browser/service table grants and a rejecting UPDATE/DELETE trigger protect stored inputs. Equal document/context identities reuse the original stored snapshot. Root lifecycle status/read timestamp are excluded from logical context; their captured values remain auditable. Renderer revision is `crm-pdf-v3`.
4. **Snapshot-only rendering:** the Edge renders exclusively from the saved snapshot, recursively frozen in memory. There are no post-capture database rendering queries. Storage downloads use only captured file pointers and the caller JWT. The prepared date and PDF creation/modification timestamps derive from the saved capture timestamp. Hosted logos and downloaded object bytes are external inputs, not subsequent database reads; their actual resulting bytes are bound by the artifact/request hashes below.
5. **Artifact and request binding:** the Edge hashes the actual rendered PDF bytes. Reservation independently decodes and SHA-256 hashes the primary PDF from the submitted provider payload, validates the supplied snapshot UUID/context/hash and current authorization/source/version, and transactionally creates the outcome and private operation with the same snapshot ID and artifact hash. After adding its server operation tag, it hashes and stores the exact complete provider request string, including additional attachments. Internal reservation fields are stripped before provider submission.
6. **Reuse and retries:** an existing operation must match the same immutable snapshot, actual PDF hash and exact complete frozen provider body before any terminal acceptance reuse. The Edge retrieves the existing frozen body rather than regenerating the PDF or refetching assets. Database request/PDF hashes and snapshot/outcome relationships are checked again at reuse and finalization. No different bytes may be substituted under the same provider idempotency key.
7. **Finalization and recovery:** the finalizer preserves NULL/missing/expired/superseded claim rejection and terminal immutability. It checks rendering evidence before persisting any outcome. Owner reconciliation checks that evidence for new bound operations as well. Acceptance means provider acceptance, never confirmed recipient delivery. The accepted row retains its snapshot ID and PDF hash, and the private operation retains the exact request and its hash.

The cryptographic relationship is: immutable snapshot UUID + canonical context -> actual primary PDF SHA-256 + complete frozen request SHA-256 -> operation UUID/key -> accepted outcome with the same snapshot/PDF identity. Snapshot identity is not derived from an independently rendered current database view. A service credential remains a privileged trust boundary; the ordinary HTTP caller cannot supply snapshot inputs or artifact hashes to the trusted SQL path.

## Source changes and authorization

Before freeze, any difference from the caller-RLS capture rejects the attempt. During rendering, changes cannot change saved inputs. At reservation, current source context/version and membership/graph authority are rechecked; a still-changed source rejects before provider submission. A -> B -> A is safe because the renderer continues to use saved A, never B.

Reservation is the authorization/source validation point for the frozen send. A later source edit cannot retract an in-flight external request: provider acceptance is recorded for the historical saved artifact. The changed current proposal is not marked sent because its status/version/content compare-and-set fails. Later requests cannot reuse that artifact for a different current context. This is not an immediate external-send cancellation guarantee.

The nine-role / three-document-type authorization model is unchanged. Clients cannot create/update delivery outcomes or directly transition proposals to sent. New trusted functions use empty search paths and service-only execution; only the read snapshot RPC is SECURITY INVOKER/authenticated. No caller-controlled identity/role header is trusted. UUID possession confers no write or sharing authority.

## Provider contract and uncertain outcomes

Primary Resend documentation reviewed 2026-11-03:

- https://resend.com/docs/dashboard/emails/idempotency-keys
- https://resend.com/blog/engineering-idempotency-keys
- https://resend.com/docs/api-reference/emails/retrieve-email

The documented identical-key/payload idempotency window is 24 hours; the implementation uses a conservative 23-hour cutoff, globally unique operation keys, a 90-second claim and credential/sender/renderer context binding. Account/key-rotation namespace behavior is not independently established. No unlimited retention or exactly-once guarantee is claimed.

Timeouts, malformed success, conflicts, rate limits and 5xx remain uncertain. Retry within the bounded contract uses the same operation, PDF, full body and key. Expired/credential-changed operations return review without send bytes/key. Changed unresolved source context blocks new operations. Definitive provider validation/auth rejection remains terminal failed.

The exact active division owner may verify an existing provider message with GET only, matching its operation tag and frozen recipient/from/subject/html. Failed retrieval, changed credentials, mismatched evidence or persistence failure cannot report recovery success or trigger a resend. Provider events remain distinct from acceptance status. New operations use `crm-pdf-v3` provider context; GET recovery preserves earlier v2 and credential-only bindings without permitting their automatic replay.

## Migration, legacy evidence and secure rollback

Order: reviewed dependency stack -> `20261103010000_server_authoritative_delivery.sql` -> `20261103030000_bind_delivery_context_and_terminal_claims.sql` -> `20261103040000_freeze_document_render_snapshot.sql`. All are explicit migrations, never startup actions. No migration was applied outside disposable synthetic databases.

The first correction rejected NULL/expired/stale claims and bound logical context. R1 proved that its pre/post check was insufficient; the new migration replaces rendering capture/reservation/evidence handling. Historical migration files and outcomes remain unchanged.

Pre-R1 operations have no provable immutable rendering snapshot/artifact binding. No backfill fabricates one from current mutable records. Automatic replay/reuse is blocked, and the new finalizer cannot attest an old unbound operation. Exact-owner GET reconciliation can retain historical provider evidence, but does not make that artifact valid for today's context. Audited manual disposition/roll-forward is required for any such records; no production records were inspected to establish whether any exist.

For a later separately authorized release: pause sends, drain/reconcile in-flight operations, apply the ordered migrations and deploy the compatible Edge Function before resuming verified sends. Mixed function/migration versions fail closed. Secure rollback disables sends or rolls forward; never restore browser outcome grants, the NULL-claim finalizer or the pre/post rendering shortcut. Preserve snapshots, operations and audits. Their private document retention/disposal policy requires separate operational approval.

## Regression and validation evidence

`render_snapshot.integration.test.ts` uses the actual Edge renderer, actual PostgreSQL RPCs, authenticated source edits and `pdftotext` on the actual submitted PDF. Auth/provider HTTP and optional hosted-logo HTTP are synthetic; renderer and database decisions are not mocked. No network permission is granted. The test harness checks out no branches: it reads the exact historical renderer from Git into a temporary directory and clones a disposable pre-correction database. The same A -> B -> A assertion must fail against `1b7f806...` with `R1_ABA_RENDERED_B`, then pass after correction with PDF A and matching persisted snapshot/PDF/request evidence.

Four real-renderer cases cover A -> B -> A with unchanged acceptance reuse; uncertain acceptance preserving the exact PDF/body/key (two HTTP attempts, one logical operation); still-changed source rejected before submission; and source edit after reservation recording historical acceptance without marking the changed proposal sent. Cached retries do not regenerate PDFs or refetch logos.

`security_delivery_artifacts.sql` additionally rejects forged input snapshots, cross-document snapshot IDs, false PDF hashes, changed actual artifacts during acceptance reuse, post-reservation request tampering and snapshot mutation. Browser/service direct snapshot-table grants and artifact column writes are checked. Existing NULL/stale/expired/superseded claims, terminal outcomes, content/email changes, status-trigger behavior, owner reconciliation/removal, role matrix and expiry tests remain enabled against the corrected RPCs.

Commands/results:

- `npm run build`: TypeScript + Vite pass; existing bundle-size warning.
- `node --experimental-strip-types supabase/functions/crm-send-document/delivery.test.mjs`: 9 pass.
- `deno test --allow-env --node-modules-dir=none supabase/functions/crm-send-document/handler.test.ts`: 16 pass.
- `deno check --node-modules-dir=none supabase/functions/crm-send-document/index.ts`: pass.
- `SECURITY_TEST_DENO=/workspace/work/npm-cache/_npx/05b6ef7b13673c57/node_modules/.bin/deno DENO_DIR=/workspace/work/deno-cache python3 scripts/test-security.py`: pass. Runs historical failures, baseline/ordered migrations, rendering/artifact/recovery SQL, 4 actual-PDF cases, 8-session claim concurrency, direct PostgREST JWT/table/RPC/schema boundaries, unchanged financial/project-pipeline and price-book suites. Requires local Docker, Deno, pdftotext and Git history containing the pinned historical SHA. CI installs the PDF tool and sets up Deno before the suite.
- `git diff --check`: pass. Final scope review confirms no historical migration, pricing/salesperson, website or Workstream B edits.

## Unverified hosted dependencies

Synthetic Auth/Storage and public-only PostgREST fixtures do not prove deployed owners, execution/table/default grants, exposed schemas or the unavailable platform `rls_auto_enable()` behavior. The source baseline needs function-terminator and PK/UNIQUE-order normalization for an empty database; these are declared fixture transformations.

Actual provider acceptance/retrieval permissions, tags, retention, account/key behavior and recipient delivery remain unverified. The hashes attest our saved/submitted artifact and request; they are not a provider cryptographic attestation of recipient attachment bytes.

Hosted Storage metadata/version-to-byte consistency and immutable object enforcement remain separate evidence requirements. The captured metadata cannot independently attest remote bytes during their first download; actual downloaded/embedded bytes are frozen in the artifact/request. Subsequent retry cannot refetch different bytes. Workstream B attachment/deletion review remains separate. Existing signed URLs retain their TTL. No production configuration, data or secrets were accessed, and no merge/deployment occurred.
