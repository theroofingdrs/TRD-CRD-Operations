# TRD and CRD Operations

A private internal operations platform for The ROOF Doctors and Commercial ROOF Doctors.

## Purpose

One CRM application serves two roofing divisions. Shared customer, contact, property, identity, and activity foundations support both divisions. Division specific workflows, records, permissions, and reporting remain separated.

## Divisions

| Division | Scope |
| --- | --- |
| TRD | Residential roofing, inspections, repairs, replacements, storm restoration, and maintenance |
| CRD | Commercial roofing, inspections, repairs, restoration coatings, capital projects, and maintenance |

## Infrastructure

This application is independent of the public websites and LaborXchanger.

- GitHub: private source repository
- Supabase: dedicated database, authentication, and private file storage
- Cloud Run: planned dedicated application hosting
- Public websites: unchanged and outside this repository

Supabase project: `gubvelngdohrfvqeeabu` in the TRDCRD organization.

## Current implementation

- React, TypeScript, and Vite application shell
- Invitation only email link sign in
- TRD and CRD division selector
- Employee profile and division membership model
- Role based, division scoped database access
- Shared customer and contact foundation
- Property and roof records
- Leads, appointments, inspections, inspection observations, projects, tasks, activity history, and file metadata
- Dashboard, lead pipeline with status updates, customer directory, contact management, property creation, roof system records, appointment, inspection, project, and task workflows
- Private property file and photo upload with signed file access
- Owner only employee invitations and division role assignment through a JWT protected Supabase Edge Function
- Owner controlled website lead import for TRD and CRD, using the original website record IDs to skip records already imported
- Automated GitHub Actions checks for React production build, Supabase Edge Function types, and Cloud Run container build
- Node 22 and Nginx container configuration prepared for Cloud Run
- AI generated inspection observations are explicitly marked unverified until a human verifies them

## Employee roles

Owner, Division Admin, Office Manager, Sales Rep, Project Manager, Field Inspector, Production Manager, Accounting, and Read Only.

Permissions are enforced in Postgres Row Level Security, not just hidden in the interface. The owner can access both divisions. Employee accounts cannot self register or assign their own role.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Install the committed dependencies with `npm ci`.
4. Run `npm run dev`.
5. Run `npm run build` before deployment.

Never put a Supabase secret or service role key in a Vite environment variable. Only the publishable key belongs in the browser.

## Data protection and boundaries

- Two existing website submissions in the legacy table are preserved and have not been imported, deleted, or modified. An owner only import action is implemented but has not yet been run.
- No demo customer or property data was inserted.
- No public website code was changed.
- No production deployment has occurred.
- Stripe is deliberately on hold. No payment processing is configured or enabled.
- Private Storage policies are enabled for the existing private bucket. Object paths must begin with TRD or CRD, and access is division scoped.
- Supabase leaked password protection is a Pro plan feature and is not enabled on the current project plan.
- The new database foundation was applied additively to the existing project. A live CRM schema snapshot is checked in under `supabase/baselines/` for reference. It is not an executable migration or a reconciled Supabase CLI baseline. Reconcile and validate it before any further schema changes.

## Reference application

The prior Roof Doctors Field Operations and Roof Intelligence ZIP is an architectural and feature reference only. Its browser local storage, demo users, seeded customer records, and simulated integration behavior are not production data or production services. The public website component in that ZIP is out of scope.
