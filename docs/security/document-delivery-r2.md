# R2 proposal-state concurrency correction

Review base: `ada39c728472fbfc225439b03c0fafabaf4ee8c3`. Corrective branch: `security/document-delivery-r2`. The original Workstream A branch and draft PR #26 remain at their existing head, targeting `reconcile/pricing-engine`. This child branch is for separate independent review; it is not merged into that PR. Historical migrations and the snapshot/artifact architecture are unchanged. Workstream B, website and pricing/salesperson files are untouched.

## Coordination and source-writer inventory

Crystal owns both security efforts. Remote PR #21 -> #22 -> #24 -> draft #26 and the private-file branch were re-pinned before editing; no new overlapping implementation was present. The correction owns a new migration and its delivery-specific tests/docs. It does not redefine another workstream's functions or transplant its changes.

Proposal context is defined by the existing `crm_document_render_inputs('proposal',id)`:

| Source | Context-bearing data | Existing writers inspected |
| --- | --- | --- |
| `crm_proposals` | Full row excluding status/updated_at | `src/Proposals.tsx`, direct table DML, trusted delivery functions |
| `crm_customers` | ID, display name, trimmed email | `src/App.tsx`, `src/Invoice2goImport.tsx`, website-intake import, direct DML |
| `crm_properties` | ID/customer relationship and rendered address | App customer/property creation, Invoice2go/intake imports, direct DML; coordinate RPC changes excluded non-rendered fields |
| `crm_proposal_templates` | Template row excluding creation/update timestamps | `src/ProposalTemplates.tsx` UPSERT, direct DML |
| `crm_files` | Referenced Roofr file identity and metadata | App/Roofr/inspection/project/import attachment writers; Workstream B registration RPC reviewed read-only |
| `storage.objects` | Referenced object's identity/metadata, excluding last access | Storage API DML and cleanup/deletion; Workstream B registration/reference/deletion locking reviewed read-only |

Membership and optional-parent authorization checks remain in the existing trusted functions; they are not replaced by an epoch. Inspection/warranty-only inputs do not control the proposal `sent` transition. All source INSERT/UPDATE/DELETE paths participate through PostgreSQL triggers, including privileged service DML: no application opt-in is needed. Unknown deployed writer functions, grants, replication-trigger settings and unsupported privileged maintenance remain hosted catalog review gates. Clients must not have TRUNCATE/DDL authority; this is not protection against a database administrator disabling constraints/triggers.

## Enforceable contract

`20261103050000_serialize_proposal_context_epochs.sql` adds private proposal epochs and change audit records. No CRM rows are rewritten during migration. The derived private state is initialized as needed.

A transaction-scoped advisory mutex `(271026,2)` serializes the short SQL critical sections. It is not held across rendering, Storage downloads or provider HTTP. The existing freeze, claim, finish and reconciliation functions acquire it before proposal resource locks. Both completion paths use the same private current-state transition helper and retain all original authorization/artifact/claim checks.

Context-bearing source edits acquire the mutex through trigger-enforced TRY locking. A contention error is SQLSTATE `40001`: **retry the entire source-edit transaction**, not a savepoint fragment and never a provider send with a new key. TRY locking is deliberate: a Storage registration or other writer may already hold a source row lock, so it must not wait for the mutex while preventing its holder from progressing. Updates/deletes lock before row DML; relevant inserts also check before commit. Ordinary new-customer/property/file/upload insertions without existing proposal dependencies do not acquire the mutex and do not add retry conflicts to intake creation.

After a genuine context change, transition-table triggers find all dependent proposals, lock IDs in ascending order, advance their private epochs, clear current-sent evidence, and invalidate only `sent` to `draft` in the SAME source transaction. Other business states, including accepted/declined, and historical receipts/artifacts remain unchanged. A shared global customer edit invalidates derived status for its actual dependent proposals without exposing those proposals or granting staff new authority. Irrelevant fields, no-ops and status-only timestamp updates do not advance epochs.

Lock order is mutex -> proposal IDs ascending -> private epoch. A source edit cannot commit context B while completion retains the critical section. If completion wins, an overlapping edit aborts with retryable `40001`; after completion commits A, retry commits B and invalidates the derived sent state atomically. If the edit wins, completion waits before proposal locking, then records historical A acceptance without marking current B sent. Multiple-statement source transactions retain their mutex until transaction end. Custom callers must retry their whole transaction after a conflict. No browser/table/epoch grants or staff roles are broadened.

The mutex is intentionally coarse across proposal contexts/divisions. Contending edits can require retry even for different proposals; staging load/latency testing is required before release. It provides no company-wide administrative permission. Existing UI error paths retain form state and report database errors; this patch does not add blind import/provider retries or change business pricing.

Edited content/recipient/property/template requests cannot reuse old acceptance. Because a real edit now invalidates `sent` to `draft`, a NEW explicit revised-context send may be authorized; regression tests require a distinct new operation rather than an old accepted result. No automatic send is triggered by invalidation. Unresolved prior operations still block changed-context sends. Restoration of an old context does not automatically reassert a current sent epoch from history.

## Deterministic evidence

`scripts/completion_race_checks.py`, called by the existing security harness, uses actual PostgreSQL transactions/functions and a temporary scheduling trigger after the current-context predicate. It reproduces `R2_STALE_CURRENT_SENT` against a disposable pre-050 clone for BOTH finalization and reconciliation.

After correction, four cases cover both functions in both orderings:

- Completion first: pause after validation; authorized A -> B edit must receive `40001`; resume valid unchanged A completion, retry B edit, require current B/draft plus historical A/accepted.
- Source first: hold the authorized B edit transaction open; completion must wait on the mutex before resource locking; commit B, then require current B/draft plus historical A/accepted.

Each case asserts one operation, unchanged actual artifact/request hashes and retained provider acceptance. No provider call occurs in these SQL tests. The existing four actual-renderer/RPC tests still prove R1 closure and exact uncertain-retry PDF/body/key identity. Eight-session claim serialization and all other original SQL/Edge/PostgREST/financial/price-book tests remain enabled.

`security_delivery_context_epochs.sql` tests all six source tables, staff-authorized edits, ignored metadata/coordinates/phone/status timestamps, private epoch authority, preservation of terminal business states and truthful historical acceptance after source-document deletion. The existing changed-context tests now explicitly require a new revised-context operation rather than accidentally relying on stale `sent` state to reject all revised sends.

A separate local disposable compatibility clone applied the exact Workstream B policy-isolation dependency `20261102030000` followed by its registration migration `20261103020000` from `9b6484a64bcb6c54b60620e1f91752ddb64bc4fc` only as test input. An initial attempt without the policy dependency was correctly rejected by its preflight (`Unexpected crm_files policy`); no guard was bypassed. With the reviewed dependency present, both R2 paths/orderings passed there, as did its actual registration RPC during a held completion mutex and authorized unreferenced-object deletion. No B code/worktree/branch was changed. This is compatibility evidence, not Workstream B approval or a wholesale branch integration.

## Commands and release limits

- `SECURITY_TEST_DENO=/workspace/work/npm-cache/_npx/05b6ef7b13673c57/node_modules/.bin/deno DENO_DIR=/workspace/work/deno-cache python3 scripts/test-security.py`
- `npm run build`
- `node --experimental-strip-types supabase/functions/crm-send-document/delivery.test.mjs`
- `DENO_DIR=/workspace/work/deno-cache /workspace/work/npm-cache/_npx/05b6ef7b13673c57/node_modules/.bin/deno test --allow-env --node-modules-dir=none supabase/functions/crm-send-document/handler.test.ts`
- `DENO_DIR=/workspace/work/deno-cache /workspace/work/npm-cache/_npx/05b6ef7b13673c57/node_modules/.bin/deno check --node-modules-dir=none supabase/functions/crm-send-document/index.ts`
- `git diff --check`

All pass locally; exact-SHA remote CI is reported separately. Existing bundle-size and SDK deprecation warnings remain nonfatal. Apply 050 only after the ordered Workstream A dependencies in a later separately authorized send pause/cutover; never run migrations at startup. Secure rollback disables completion or rolls forward, never restores the racy current-state transition. Existing snapshots, receipts and requests stay auditable.

No production migration, data, endpoint, credential or configuration was accessed. Hosted catalog/grants/exposed schemas, all deployed writer entry points, real provider permissions/retention, hosted Storage metadata-to-byte behavior and load/contention remain unverified non-production evidence gates. A separate independent adversarial review of the new commit is required. Do not self-approve, mark PR #26 ready, merge or deploy.
