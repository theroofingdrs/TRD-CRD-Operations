# Deployment Readiness

## Current state

The React application source and Supabase database foundation are committed. The application is not deployed and no Cloud Run service has been created or changed.

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

1. Generate and commit a package lockfile.
2. Run `npm ci` and `npm run build`.
3. Verify magic link login and logout.
4. Verify owner access to both divisions.
5. Verify division isolation and each employee role.
6. Verify customer, property, lead, appointment, inspection, project, and task create flows.
7. Verify private Storage upload and download using TRD and CRD folder prefixes.
8. Confirm no secret keys are present in the browser bundle.
9. Confirm website lead intake remains unchanged.
10. Review Supabase security and performance advisors.

## Explicit hold points

Do not deploy, create a Cloud Run service, change the public websites, enable Stripe, create live payment products, or accept payments until separately authorized.
