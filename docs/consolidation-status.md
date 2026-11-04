# Consolidation status — November 3, 2026 (Central)

## Repository inventory

Source inspected: local working tree, all remote branch tips, commit history, migrations, application modules and CI. Original CRM main was `a330498`. The only pre-existing untracked file was `tsconfig.tsbuildinfo`; it was preserved. Original feature branches remain intact.

Integrated into local main: the reconciled pricing chain (`reconcile/admin-salesperson-assignments`, `reconcile/assigned-salesperson-readonly-display`, `reconcile/pricing-engine`), document delivery corrections through `security/document-delivery-r3`, and `security/private-file-attachment-integrity`. Main already contained the completed project pipeline/financial rollups, customer actions, blog management, Invoice2go and Roofr review/re-extraction work. Old parallel feature branches carry superseded migration filenames or earlier implementations and must not be blindly merged over the reconciled versions. Existing manual production deployment control is retained.

The public website is the separate `theroofingdrs/TheRoofingDrs-Combined` repository; Operations is not a public website. Both existing repositories are retained rather than creating a replacement application or transfer workflow. Autonomous-agent architecture and budget notes are unrelated to this consolidation and remain on their original documentation branch.

## Integration fixes

- Combined delivery and file-security test harnesses without reopening browser mutation grants.
- Existing measurement review directly updated `crm_files`; immutable registration correctly rejected it. New additive `20261104010000_review_roofr_measurements.sql` exposes only an authorized property-report review operation, preserves file identity/type/links, sets reviewer/time on the server, and audits the action. The client now uses this RPC.
- Lead lists expose linked customer contact details for follow-up. Manual leads can link an existing division customer and require a service description. Division changes remount lead state, and status writes are division scoped and disabled while pending.
- Historical security fixtures now supply the verified actor for attachment references. File/Storage maintenance invalidation checks use privileged fixture writers because browser metadata mutation is deliberately revoked. Permission-denial checks remain in the file suite. Historical race reproduction is run once in delivery mode, rather than duplicated in the files suite.
- Corrected deployment documentation and ignored generated local build/test state.

## Validation

- Application TypeScript and production build pass (existing large bundle warning).
- Delivery provider unit tests: 9 passed; actual Edge handler tests: 16 passed.
- Combined security harness passes baseline and ordered migrations, historical defect reproductions, actual PDF tests (4), delivery/isolation races, registration races, direct PostgREST boundaries, financial and price-book suites.
- The file suite was rerun with the new review migration: permitted review, immutable identity, invalid waste allowance, cross-division denial, restricted grants and audit assertions pass.
- CRM container build and smoke checks pass for the application shell, private robots rules and PNG branding. The smoke check found restrictive copied public-asset permissions; the final image explicitly grants static-file read access to Nginx. CI now checks branding as well as HTML. Local logs are scratch files under ignored `work/`.

## Live boundaries and remaining work

No production database, customer records, provider messages, DNS or deployment was changed. Live Supabase grants/catalog, Storage semantics, migrations and runtime bindings still need a coordinated release check; repository tests do not prove those hosted conditions. Historical baseline normalization is disposable test setup, not a production migration.

Website-to-CRM intake currently uses the existing owner import operation. Automatic routing/notifications, transaction-wide import idempotency and hosted end-to-end submission-to-follow-up verification are not completed by this consolidation. Booking configuration remains disabled pending real provider/calendar bindings. These are product gaps, not evidence-transfer tasks.
