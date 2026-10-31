# TRD and CRD Operations production go-live checklist

## Current deployment

- Cloud Run service: \`trd-crd-operations\`
- Region: \`us-east1\`
- Current service URL: \`https://trd-crd-operations-687495157172.us-east1.run.app\`
- Last verified active revision: \`trd-crd-operations-00001-t5v\`
- Last verified active image: \`us-east1-docker.pkg.dev/trd-crd-operations/trd-crd-operations/trd-crd-operations@sha256:117e773864aa288b0e36a8add0e43eaa4a21e9fe97a086136a1eefa4538a9bf0\`
- Supabase project: \`gubvelngdohrfvqeeabu\`

The current service is deployed, but its active image was observed to lag behind the latest GitHub source. A successful container build is not proof that the latest image is serving traffic.

## Recommended public URL

Use \`https://operations.theroofingdrs.com\` as the permanent Operations address. Keep the current Cloud Run URL available as a fallback during the transition.

1. In Google Cloud Run, open service \`trd-crd-operations\` in \`us-east1\`.
2. Add a custom domain mapping for \`operations.theroofingdrs.com\`.
3. Complete any domain ownership verification Google requests.
4. Copy the exact DNS records shown by Google Cloud.
5. Add those records in the GoDaddy DNS zone for \`theroofingdrs.com\`. Do not substitute a guessed IP address or CNAME target.
6. Wait for Google Cloud to confirm the mapping and TLS certificate are ready.
7. Add the custom domain to Supabase Auth allowed redirect URLs and set the production Site URL to the custom domain.
8. Test magic-link and password sign-in from the custom domain before switching the website buttons to it.

## Website link transition

The website source contains legacy staff/admin routes that pointed to older portal experiences. The link transition must:

- Point TRD Admin Operations to the secure Operations Center.
- Point CRD Staff Portal and Staff/Admin Operations links to the same secure Operations Center.
- Replace legacy TRD \`/app\` and \`/field\` entry routes with a clear handoff to the secure portal.
- Replace legacy CRD \`/admin\`, \`/staff\`, \`/staff-portal\`, and related aliases with a clear handoff to the secure portal.
- Keep the public homeowner/client portal separate.
- Never expose privileged CRM credentials or Supabase service-role secrets in either public website.

The website link change is prepared in the separate website repository branch and must pass its integration build before the website integration branch is merged or deployed.

## Application and security checks

- [ ] Confirm the active Cloud Run revision is built from the intended GitHub \`main\` commit and record the new image digest.
- [ ] Confirm \`VITE_SUPABASE_URL\` and \`VITE_SUPABASE_PUBLISHABLE_KEY\` are present as build arguments.
- [ ] Confirm the Google Maps build substitution is populated for the Operations build. The checked-in \`cloudbuild.yaml\` default for \`_VITE_GOOGLE_MAPS_API_KEY\` is empty.
- [ ] Confirm the Supabase Auth redirect allowlist contains the Cloud Run URL and final custom domain.
- [ ] Test owner sign-in and access to both TRD and CRD divisions.
- [ ] Test a staff account with only TRD membership and verify it cannot read CRD records.
- [ ] Test a staff account with only CRD membership and verify it cannot read TRD records.
- [ ] Test division-admin and read-only permissions.
- [ ] Exercise the owner-only employee invitation function with a controlled test employee. Confirm a non-owner receives HTTP 403 and owner access cannot be assigned through invitations.
- [ ] Confirm private file uploads and signed downloads for both division prefixes.
- [ ] Verify customer, property, inspection, proposal, warranty, and Roofr measurement workflows.
- [ ] Confirm the latest Google Maps project-location migration is applied to the live database before relying on saved project coordinates.
- [ ] Review the Supabase security advisor and confirm no service-role or secret key is present in browser bundles.
- [ ] Confirm login and refresh work on desktop and mobile browsers.

## Scope boundaries and hold points

- Do not reset, recreate, or seed the production database.
- Do not apply the checked-in schema baseline snapshot as a migration.
- Do not merge the draft Project Pipeline and Job Costing PR until its documented missing workflows and migration validation are complete.
- Do not deploy a new Cloud Run image or change production website routing until the build and access checks pass and the deployment is explicitly approved.
- Keep TRD and CRD division access enforced by Supabase Row Level Security. Hiding a button in the frontend is not an authorization boundary.

## Build and deployment distinction

The Operations repository GitHub Actions workflow validates TypeScript, the production build, Edge Function types, the Docker build, and a basic container smoke test. It does not itself publish the production image or deploy Cloud Run.

The checked-in \`cloudbuild.yaml\` builds and deploys the Cloud Run service when run through the intended Cloud Build trigger. Verify the trigger's substitutions and deployed revision after each production build.
