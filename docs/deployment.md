# Deployment Readiness

## Current state

The React application source and Supabase database foundation are committed. GitHub Actions has passed the type check and production build. The application is not deployed and no Cloud Run service has been created or changed.

An owner only `crm-invite-employee` Supabase Edge Function is deployed with JWT verification enabled. It checks active owner membership in the requested division, does not allow assigning owner access, and keeps privileged credentials server side. The function has not yet been exercised by sending a real employee invitation.

## Required environment

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

1. Confirm the committed `package-lock.json` is current and run `npm ci` and `npm run build`.
2. Verify magic link login and logout using the approved local and hosted redirect URLs.
3. Verify owner access to both divisions.
4. Verify division isolation and each employee role.
5. Verify customer, contact, property, roof system, lead, appointment, inspection, project, and task create flows.
6. Test the owner only employee invitation function with a controlled test employee. Confirm a non owner receives a 403 response and owner role cannot be assigned.
7. Verify private Storage upload and signed download using TRD and CRD folder prefixes, including a rejected oversized or unsupported file.
8. Confirm no secret keys are present in the browser bundle.
9. Confirm website lead intake remains unchanged and validate any future intake sync without altering source submissions.
10. Review Supabase security and performance advisors.
11. Generate and review a proper migration baseline from the live schema before further schema changes. Do not reset or recreate the database.

## Explicit hold points

Do not deploy, create a Cloud Run service, change the public websites, enable Stripe, create live payment products, or accept payments until separately authorized.
