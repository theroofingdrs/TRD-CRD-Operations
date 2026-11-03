# R3: enforce a fresh-snapshot transaction contract

Base: `941efe1f18beaf8a312cff52dbfe8df7f9ce8fb4`, `security/document-delivery-r2`.
Correction: child branch `security/document-delivery-r3`. PR #26 and R2 remain unchanged. No production operations are part of this change. Independent review is required before any integration decision.

## Root cause and design comparison

R2's advisory mutex orders execution, not MVCC visibility. A REPEATABLE READ source transaction can read before a proposal exists, then acquire the mutex after another transaction creates and accepts that proposal. Its AFTER trigger's dependency query sees no proposal and returns early. The source commits B; the proposal remains sent for historical A. Epoch numbers do not detect an invisible dependency.

| Approach | Guarantee and isolation implications | Locks, callers and retry implications |
| --- | --- | --- |
| Explicit READ COMMITTED contract (selected) | Reject unsupported isolation before every source write and delivery entrypoint. Under RC, VOLATILE PL/pgSQL trigger/function SQL statements obtain fresh snapshots; dependency evaluation after acquiring serialization sees earlier commits. | Existing mutex -> root -> epoch ordering retained. Adds no locks. REST requests remain separate transactions. Unsupported custom callers must roll back and start at RC. |
| Move advisory acquisition alone | Does not repair an already established RR/SERIALIZABLE snapshot. A wrapper cannot downgrade isolation after database queries have begun. | Would require controlling all connection/transaction entrypoints, including Storage and direct SQL; a caller-only convention is insufficient. |
| MVCC dependency/version sentinel | Potentially support stronger isolation by forcing an MVCC-visible write conflict across all source/root creation transactions, with abort/retry when snapshots conflict. | Needs versioned dependency bookkeeping, coverage of inserts/deletes/reassignment and all six source graphs, deterministic lock ordering, and broader concurrency review. More scope and contention; not selected for this correction. |
| Combine explicit contract and new dependency model | Unnecessary to close the reproduced interleaving. Could be evaluated separately if stronger-isolation writers become an approved requirement. | No undocumented bypass or privileged exemption should be added. |

All context source INSERT/UPDATE/DELETE statements, including zero-row, status-only and otherwise irrelevant updates, now execute `aaa_proposal_context_isolation` first. This deliberately includes all Storage buckets; ordinary blog/expense/private-file writes therefore also require RC. The check is not an RLS policy and applies to privileged SQL writers too. It does not grant any operation previously denied by RLS or ACLs.

The four service-only RPCs `crm_freeze_document_render`, `crm_claim_document_delivery`, `crm_finish_document_delivery` and `crm_delivery_reconciliation` check isolation as their first executable statement. This includes read-mode reconciliation. No artifact, receipt, request, key, business-status, authorization or provider-recovery behavior is otherwise changed. The migration contains explicit R2 function definitions with only that added statement; existing function ownership/ACLs persist under CREATE OR REPLACE.

`25001` means unsupported transaction state: roll back the **whole transaction**, start a new one explicitly at READ COMMITTED, re-read/validate input as appropriate, and retry the database operation. Repeating an RR/SERIALIZABLE transaction unchanged is not a recovery strategy. Existing `40001` contention still requires an entirely new transaction/snapshot, not a savepoint retry. Never wrap a provider POST or whole import in an indiscriminate transaction-retry loop.

## Correctness and lock order

- An old RR/SERIALIZABLE source transaction cannot commit the reproduced edit: BEFORE STATEMENT rejects it, even if its old snapshot has no dependent proposal.
- RC completion first: contending source edits receive 40001. A fresh edit transaction after completion sees the dependency, atomically clears sent epoch and changes current sent to draft. Historical accepted receipt/artifact remain untouched.
- RC source first: the edit retains the mutex until commit. Completion waits before root locking; subsequent VOLATILE SQL sees committed context and does not mark B sent for snapshot A.
- An unsupported-isolation completion is rejected before any claim/outcome state change. Retrying just the completion RPC in a fresh RC transaction preserves the same operation and avoids another provider submission.
- New guards acquire no row/advisory locks. R2's TRY-before-source-DML behavior and mutex -> ascending roots -> epoch order remain unchanged. Errors roll back source invalidation and earlier statements together.
- Administrative TRUNCATE (not an application write contract), DDL, disabled triggers, replication bypass and superuser mutation of security definitions remain outside the ordinary authorized-writer model. Do not run maintenance/import writes under replica trigger suppression.

## Source and caller inventory / compatibility

Application source below is unchanged; compatibility is explicitly conditional on the actual request transaction being RC. No production connection settings were read or changed. Local SQL default is measured by the regression harness; the migration enforces actual isolation rather than trusting defaults.

| Caller / writer | Transaction boundary and source writes | Failure/retry and external-side-effect behavior |
| --- | --- | --- |
| `src/App.tsx` customer/property forms | Independent Supabase REST INSERT/UPDATE requests: customers, properties; subsequent linking/contact requests are separate commits. | Errors displayed, form state retained on first failed write; no automatic 40001 retry. Manual repeat of a failed single DML starts a fresh request. Already committed linking/contact work is not transactionally rewound. |
| `src/Proposals.tsx` | Proposal INSERT in one REST transaction. | Failed save reports error and retains draft form. Success clears fields. No automatic retry or provider call. |
| `src/ProposalTemplates.tsx` | Template UPSERT in one REST transaction. | Error shown, template state retained; manual new request. |
| `src/RoofrMeasurements.tsx` | Storage upload, file INSERT, and reviewed metadata UPDATE are separate operations. | Metadata error retains review. Upload/registration failure has cleanup path. Re-uploading the entire workflow is not a DB retry; inspect prior upload outcome first. |
| `src/Inspections.tsx`, `src/ProjectPipeline.tsx`, App file uploads | Storage upload then crm_files INSERT and associated record writes; multiple requests. | Errors/cleanup paths exist, but no generic atomic workflow retry. Existing uploaded objects may require recovery; do not blindly replay uploads. |
| `src/Invoice2goImport.tsx` | Per-row customer/property creation, Storage/file/history writes in separate requests. | Accumulates failures; no complete-database-transaction automatic retry. Entire-import replay may duplicate committed work and is not endorsed by R3. Recover/resume only after inspecting synthetic/staging operation identities and committed progress. |
| `supabase/functions/crm-import-website-intake/index.ts` | Service REST customer/property INSERTs, then separate links/contacts/lead operations. | Per-record failure capture, no automatic transaction retry. Previously committed steps remain; no whole-import retry introduced. Existing matching/sharing concerns are outside R3/H1-H2 remains separate. |
| `src/BlogManager.tsx`, expense receipts in `src/ProjectPipeline.tsx` | Storage writes share storage.objects, even without proposal dependencies. | RC required; unsupported backend isolation fails closed. Hosted Storage's internal transaction/error handling must be checked in staging before cutover. |
| `crm_owner_save_property_coordinates` | Definer RPC updates only property coordinates/timestamp; source BEFORE guard executes. | RC leaves these non-context edits without epoch invalidation. RPC failure rolls back its transaction; no external side effect. |
| Administrative deletion / cascading DML | Any authorized deletion or cascade reaches source-table guards; no separate customer-deletion RPC was identified in the checked-in source. | Existing authorization retained; each transaction must be RC. No creator/global-owner exception. |
| Direct PostgREST DML, SQL, service imports, future RPCs/triggers | All writes to the six tables run statement triggers. BYPASSRLS does not bypass ordinary triggers. | Custom transaction owners must choose RC and restart the entire transaction on 40001. Unsupported isolation is rejected, including zero-row writes. |
| Edge freeze/claim | Each `server.rpc` is a separate REST transaction. | Failure stops before provider submission; reload before recapture. No automatic whole-send replay. |
| Edge finalization (`index.ts:607`) | One RPC after provider POST. | SQL error propagates as HTTP 503 with uncertain durable outcome. No blind automatic provider resend. Preserve original operation/body/key; use original recovery flow. |
| Edge reconciliation (`index.ts:377,383`) | Read RPC, provider GET, write RPC in separate transactions. | Initial RPC error fails closed; write failure returns 409. No automatic retry; repeat verified recovery in fresh requests, never provider POST. Membership is rechecked by SQL. |

Hosted PostgREST role/function isolation settings and Storage connection isolation were not queried. A hosted RR/SERIALIZABLE override will now cause a clear failure instead of silent invalidation bypass. If a legitimate writer requires stronger isolation, do not disable this guard: stop cutover and separately design/review MVCC dependency tracking. Existing multi-request imports/uploads are not atomic and are not made atomic by R3.

## Deterministic regression evidence

`scripts/isolation_checks.py`, invoked by `scripts/test-security.py`, uses actual PostgreSQL 17 functions, authenticated-role source writes, service-only RPC calls and disposable fixtures. It never contacts the provider. Coordination barriers are advisory-lock observations, not sleep-based race scheduling.

- Before migration: clone exact R2 schema, establish an RR source snapshot before proposal creation, create/freeze/claim/finalize A in another transaction, then commit B under the original source transaction. Require stale sent state, equal epochs and preserved historical evidence.
- After migration: 72 cases: 6 sources x 2 completion paths x 2 orderings x RC/RR/SERIALIZABLE. Stronger-isolation edits must abort with 25001; retry only the source DB transaction at RC. Source-first tests prove completion is waiting on the real mutex before source commit.
- Six additional old-snapshot completion cases exercise both completion functions at all three isolation levels. Unsupported calls abort before persistence; fresh RC retries retain the same operation.
- 36 privileged zero-row INSERT/UPDATE/DELETE attempts prove every source statement is guarded even when its snapshot would select nothing. Authenticated context-changing UPDATEs are exercised in the 72 cases; no test grants ordinary users a denied DELETE merely to reach a trigger.
- Whole-transaction rollback tests place an earlier marker INSERT before rejected source edits (25001 and contended 40001), require the marker to be absent, then retry both statements in a fresh RC transaction and require one marker.
- All four service RPCs explicitly tested for unsupported-isolation rejection. Catalog SQL verifies trigger event coverage and private helper ACL/search paths.
- Every successful historical completion checks unchanged operation ID, snapshot ID, request/PDF hashes and derived idempotency key, plus actual hash validity, current fingerprint mismatch and current draft state.
- Existing real-renderer R1 tests, claim concurrency, recovery/authorization SQL, PostgREST boundaries, financial and price-book suites remain in the harness.

## Deployment and rollback boundaries

Apply only after reviewed A/R1/R2 migrations in a coordinated staging cutover. Pause document sends and source edits for installation; resolve pre-existing long-running source transactions rather than assume they have fresh snapshots. DDL lock acquisition and guard installation are transactional. The migration changes no customer records or receipts. R3 does not repair historical stale sent state: any adjudication requires a separately authorized, audited workflow.

Keep the R3 guard installed on rollback. Reverting callers can preserve the database isolation requirement; removing the guard restores the reproduced defect and is not a secure rollback. If staging reveals a non-RC backend dependency, pause affected writes and obtain a separately reviewed compatibility correction. Never repair compatibility by adding service-role exemptions or weakening RLS.

Release gates: independent R3 review; full stack/dependency review; actual hosted PostgREST and Storage isolation/catalog compatibility; load/latency checks for R2's coarse mutex; import/upload recovery review where retries span committed requests. No release approval is implied by local tests or CI.

## Local validation (2026-11-03)

All commands below exited 0 against this corrective source tree. Deno binary used locally: `/workspace/work/npm-cache/_npx/05b6ef7b13673c57/node_modules/.bin/deno`; shared cache `/workspace/work/deno-cache`.

```sh
PYTHONDONTWRITEBYTECODE=1 SECURITY_TEST_DENO=/workspace/work/npm-cache/_npx/05b6ef7b13673c57/node_modules/.bin/deno DENO_DIR=/workspace/work/deno-cache python3 scripts/test-security.py
npm run build
node --experimental-strip-types supabase/functions/crm-send-document/delivery.test.mjs
DENO_DIR=/workspace/work/deno-cache /workspace/work/npm-cache/_npx/05b6ef7b13673c57/node_modules/.bin/deno test --allow-env --node-modules-dir=none supabase/functions/crm-send-document/handler.test.ts
DENO_DIR=/workspace/work/deno-cache /workspace/work/npm-cache/_npx/05b6ef7b13673c57/node_modules/.bin/deno check --node-modules-dir=none supabase/functions/crm-send-document/index.ts supabase/functions/crm-import-website-intake/index.ts supabase/functions/crm-invite-employee/index.ts supabase/functions/crm-public-blog/index.ts
git diff --check
```

Results: historical R3 defect reproduced before migration; migration grant drift rejected atomically; 72 source/order/isolation cases, 6 old-snapshot completion cases, 36 privileged source-statement denials, 8 unsupported-isolation RPC denials, whole-transaction rollback/retry checks, all prior SQL suites, 8-session claim concurrency, 4 actual-PDF integrations and 4 R2 races passed. Direct PostgREST JWT/RLS/forged-header tests, project-pipeline financial and price-book suites passed. Provider tests: 9 passed; Edge tests: 16 passed. Build/typecheck passed with the existing Vite >500 kB bundle warning; Node emitted a punycode deprecation warning.

Final source comparison verified that removing the added first isolation-check statement from each of the four new RPC definitions yields the exact corresponding R2 definition. No application/Edge/provider code, historical migration, original branch or existing PR was changed. CI status is associated with the final corrective commit and reported separately; local results do not substitute for hosted compatibility or independent security review.

Strategy-reset supplemental check: added a deterministic BEFORE STATEMENT barrier ahead of the production guards on a disposable property UPDATE. The RC UPDATE is already executing when a second transaction creates and accepts a previously nonexistent proposal. After release, the real source AFTER trigger must see the new dependency, invalidate current sent state, and preserve exact historical evidence. Both finish and reconciliation cases passed, followed by the complete security harness with exit 0. This explicitly covers statement-snapshot timing in addition to the older transaction-snapshot matrix. Failed-migration rollback is tested by execution-grant drift; secure operational rollback retains the installed isolation guards as specified above.
