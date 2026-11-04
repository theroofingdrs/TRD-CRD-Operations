# Production operations and release checks

Source improvements are not a production deployment. The current managed
execution environment has no cloud identity, administrative database connection,
server-service binding, or provider credentials. Hosted configuration is unknown
unless independently observed. Never substitute the disposable baseline for a
migration, reset a live database, print secrets, or use customer rows as test data.

## Administrative read-only verification

With a narrowly scoped, approved administrative binding, run
`scripts/production-readiness.sql` in its explicit read-only transaction. Reconcile
its migration list with source, investigate missing/unexposed financial tables,
and review policy expressions, grants, default grants, private schema exposure,
bucket privacy and MIME/size limits. Check API-exposed schemas and function
execution grants in the Supabase project settings as well as SQL catalog state.
Inspect Auth signup/audit history and allowed redirect origins separately. Do not
apply a migration or change Auth/Storage policies as part of the inspection.

Use the cloud console or an approved read-only cloud identity to inspect Cloud Run
serving revision, image digest, service identity, secret references, ingress and
IAM; do not request or export secret payloads. Verify server-only Supabase and
provider bindings separately from public Vite configuration. Record revision and
reference names, not secret values. The website has a configuration-only preflight:
`node --experimental-strip-types scripts/runtime-readiness.mjs` in its repository.
Exit 2 means unresolved runtime bindings. A passing preflight is not hosted proof.
Both repositories scan built public assets for server credential bindings in CI.

## Controlled cutover (requires separate approval)

1. Record serving revisions, image digests and traffic allocations for both apps.
   Record the current migration inventory and independently verified backup point.
2. Prove restore into an isolated non-production project. Check the current backup
   schedule, encryption, PITR availability/window and Storage backup coverage.
   A backup listing alone does not establish a successful restore. Database backups
   do not necessarily include Storage object bytes; verify both.
3. Review/add only the missing additive migrations in order. Investigate drift
   before execution. Do not reset, seed or backfill historical inquiries.
4. Deploy compatible CRM/functions and website revisions with booking,
   notification capture/delivery and provider callbacks still disabled. Missing
   intake RPC/configuration must fail visibly, without a false confirmation.
5. Use approved controlled staging data to verify all five inquiry paths, saved
   receipts, follow-up ownership, private downloads, division denials, mobile
   recovery and operational transitions. A production probe that creates data
   needs separate authorization; it is not part of the read-only inventory.
6. Verify provider authority on test calendars first, then approve exact calendars,
   operators, durations, buffers, notice/horizon, reminder lead time, sender and
   recipients. Recheck the shared external-calendar race policy; FreeBusy is a
   snapshot and does not lock another actor's Google Calendar writes.
7. Enable each provider capability separately only after approval and monitoring.

## Rollback and recovery

Prefer restoring traffic to the last known compatible Cloud Run revision. The
exact approved operation is `gcloud run services update-traffic SERVICE --region
REGION --to-revisions REVISION=100 --project PROJECT`; substitute the independently
recorded identifiers during the approved incident. This changes production and
was not executed here. Retain source and durable receipts. Before rolling the
website back, check the earlier version's lead-delivery compatibility and duplicate
behavior. Do not automatically downgrade or delete additive schema/data.

For intake failure, retain the submission UUID and saved error, correct the
underlying dependency, and use the exact-division owner's saved-payload retry.
For a lost calendar response, preserve both reserved slots and use provider
evidence reconciliation. Never assume an absent uncertain create was rejected.
For notifications, `accepted`/legacy `sent` is not delivery. Verify signed delivery
receipts/provider evidence, keep ambiguous sends uncertain, and retry only a
known rejection within the original idempotency window. Do not generate a new
provider key merely to force a resend. Recovery actions are audited.

## Monitoring and ownership to verify before release

Configure and test alerts for website 5xx/latency, repeated intake failures,
unassigned leads/follow-ups, old pending jobs, stale/uncertain sends, bounced
messages, uncertain bookings, credential expiry and exhausted capacity. Route
alerts to an approved operational owner; no recipient is invented in source.
Use submission UUID, notification ID and booking reference for correlation. Do
not log contact payloads, photo bytes, authorization headers, tokens or provider
error bodies. Confirm retention, deletion and access rules for logs and private
receipts. Record a restore-test date and operational escalation owner before
claiming production readiness. None of these hosted controls is verified by CI.
