# Private file registration and access

Base: `fix/private-file-policy-isolation` at `90d5bad5f5cb2910097f279d95d18b99c1b2946e`, six commits above PR #24's pricing head `df04a3e3fa3ac0acdf4713f55a46a896154f271c`. The dedicated branch retains the reviewed isolation delta. Its PR targets reconcile/pricing-engine, retaining the six existing private-file commits plus the corrections. The assignment/pricing prerequisites stay in their existing PR stack; the original private-file branch is preserved. Do not integrate all 30 commits as one security change.

## Migration and compatible clients

Apply `20261103020000_atomic_private_file_registration.sql` AFTER the reviewed baseline and earlier migrations, including `20261102030000`. Historical migrations remain unchanged. Preconditions require a non-public roof-doctors-private bucket and the reviewed Storage owner_id column; mismatches abort transactionally. Unexpected file policies/column grants fail closed for review.

`crm_register_private_file(jsonb)` derives auth.uid(), checks active exact-division/resource roles, validates supported target/path/parent relationships and locks the actual owned Storage upload. File creation and required receipt/photo/historical-document link commit atomically. Unique bucket/path plus upload-row locking make concurrent retries return one file; identities/metadata cannot be rebound. Failed required links roll back the file/audit. Registration audit is private. Source-scoped whole-import idempotency remains separate H1/H2 work; registration idempotency is by immutable upload identity.

Client inserts now use registerFile. Inspection metadata and Invoice2go historical attachment rows are created inside registration; redundant post-registration financial links are removed. Invoice2go customer paths and Roofr property subfolders are explicitly supported. Existing financial records still precede uploads; a failed attachment does not erase the already saved invoice/expense. Failures are visible. Object upload itself is external to the database transaction; failed registrations can leave owner-only unregistered objects requiring cleanup.

## Effective policy model

All reviewed permissive crm_files policies are replaced; direct authenticated INSERT/UPDATE/DELETE is revoked. Reads use exact resource/division and current stored relationships. All nine staff roles retain current division reads; write permission uses existing resource/financial helpers. Financial documents are NOT asserted accounting-only: existing division read rules are preserved. Portal mappings grant no base-table file access.

Supported targets: property (one-level and Roofr paths), inspection, project invoice/payment/expense, supplement, company_expense, and customer Invoice2go history. Unknown targets and mismatched batch/project/customer/inspection paths fail closed. No generalized project attachment category is invented.

Generic/global-owner Storage mutations are removed. Upload paths are checked against their supported target grammar and role. Registered bytes and metadata identities cannot be overwritten. Owned unregistered uploads have narrow read/delete cleanup rights while current upload authority remains valid. An exact active division owner may delete an unreferenced property object; deletion is audited and its immutable metadata remains as a tombstone. Reads hide absent objects and the old path cannot be re-uploaded/rebound. Required financial/photo/history attachments cannot be deleted or detached through this operation; no such delete UI existed in the inspected source. A future evidence-retention/detachment workflow needs its own audited contract. No new broad SELECT is used to solve circular registration.

New signed-URL issuance remains subject to Storage reads. Previously issued URLs remain valid until their existing TTL (commonly 60 seconds; inspection viewing 3600 seconds). No immediate-revocation claim or file-delivery redesign is included. Historical supported paths remain readable with valid links; unsupported/orphan legacy graphs are withheld, never silently repaired.

## Coordination and rollback

Coordinate an upload/import pause and compatible client+operation+policy cutover. No migration or configuration was applied to production. Storage owner_id semantics, bucket state, complete deployed policies/default grants and actual signed-URL behavior need separately authorized deployment verification. Unexpected Storage policy names abort the cutover, including policies outside the reviewed application namespace. The test harness is identical in both workstreams and isolates each suite in a separate database when combined. Do not roll back by restoring broad policies; pause uploads and roll forward a compatible client. Preserve records and audit; adjudicate orphan uploads manually.

`security/server-authoritative-document-delivery` owns outcome state and provider recovery. Its SQL does not call this migration or duplicate its objects. Shared App/Inspections/CI edits require cross-review. H1/H2/H3/H4 remain separate release blockers and are not fixed here.

## Validation

`python3 scripts/test-security.py` uses the actual baseline plus ordered source migrations and realistic grants (not GRANT ALL). It reproduces the original payment INSERT RETURNING denial before correction, proves drift rollback, runs authenticated registration/read/mutation assertions for supported attachment lifecycles, 8 competing registration sessions, concurrent reference/deletion protection, exact-owner property deletion/tombstone/path-reuse checks, direct PostgREST JWT/mutation/private-schema tests, and existing financial/price-book suites. All pass.

The former handwritten project-pipeline fixture remains a financial regression suite. Its file-policy assertions moved to the full-baseline security harness so incomplete permissive fixtures are no longer treated as security evidence. `npm run build` and `git diff --check` pass; existing large-bundle warning remains.

Tests use network-isolated PostgreSQL 17, PostgREST 13 and synthetic Auth/Storage infrastructure. The snapshot needs function terminators/PK ordering normalization; unavailable platform rls_auto_enable is excluded explicitly. Tests do not establish deployed catalog, actual hosted Storage upload/signing, URL expiration enforcement, production configuration or customer-data state. No production or live provider endpoints were accessed. Independent review is required.
