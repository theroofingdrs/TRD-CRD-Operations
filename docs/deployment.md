# Deployment Readiness

## Current state

The React application source and Supabase database foundation are committed. GitHub Actions validates the React production build, Supabase Edge Function types, and the Cloud Run Docker image. The application is not deployed and no Cloud Run service has been created or changed.

An owner only `crm-invite-employee` Supabase Edge Function is deployed with JWT verification enabled. It checks active owner membership in the requested division, does not allow assigning owner access, and keeps privileged credentials server side. The function has not yet been exercised by sending a real employee invitation.

An owner only `crm-import-website-intake` function is also deployed with JWT verification enabled. It reads legacy website submissions without modifying them, maps residential and commercial payloads into CRM customer, contact, property, and lead records, and uses each original intake record ID to skip records already imported. The import is initiated manually from the Leads screen and requires owner confirmation. It has not yet been run against the two live submissions.

## Required environment

The browser application requires these public build arguments when building the container. The Dockerfile uses Node 22 and Nginx and listens on port 8080, as expected by Cloud Run. The GitHub workflow builds the image with placeholder public configuration only; it does not publish or deploy the image.

The browser application requires:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The publishable key is designed for browser use and is not a substitute for RLS. Never add a Supabase secret key or service role key to Vite environment variables, source code, or GitHub.

## Authentication redirect configuration

The application uses invitation only email magic links. Before the first hosted login test, add the exact local development and Cloud Run application URLs to Supabase Auth's allowed redirect URLs. Set the production Site URL to the final CRM URL after it has been approved.

## Hosting

Use a dedicated Cloud Run service for this CRM. Do not deploy it to either public roofing website service and do not use the LaborXchanger service.

Suggested service name: `trd-crd-operations`.

## Pre deployment checks

1. Confirm the committed `package-lock.json` is current and run `npm ci` and `npm run build`. Confirm the Docker image builds with the approved Supabase URL and publishable key.
2. Verify magic link login and logout using the approved local and hosted redirect URLs.
3. Verify owner access to both divisions.
4. Verify division isolation and each employee role.
5. Verify customer, contact, property, roof system, lead, appointment, inspection, project, and task create flows.
6. Test the owner only employee invitation function with a controlled test employee. Confirm a non owner receives a 403 response and owner role cannot be assigned.
7. Review the two existing website submissions, import them from the correct division, then repeat the import and confirm both are skipped as duplicates. Confirm the source `trd_records` remain unchanged.
8. Verify private Storage upload and signed download using TRD and CRD folder prefixes, including a rejected oversized or unsupported file.
9. Confirm no secret keys are present in the browser bundle.
10. Confirm website lead intake remains unchanged and that the CRM import does not modify source submissions.
11. Review Supabase security and performance advisors, including the verified removal of non RLS table privileges from anonymous and authenticated roles.
12. Reconcile `supabase/baselines/20261030_live_crm_schema_snapshot.sql` with the live schema using the Supabase CLI, then validate the resulting baseline against a disposable project. The checked in snapshot is reference only and must not be applied to production. Do not reset or recreate the existing database.

## Explicit hold points

Do not deploy, create a Cloud Run service, change the public websites, enable Stripe, create live payment products, or accept payments until separately authorized.
