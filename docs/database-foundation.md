# Database Foundation

## Supabase project

- Organization: TRDCRD
- Project reference: `gubvelngdohrfvqeeabu`
- Region: US East 1
- Status: active and healthy

The CRM foundation was added to this existing project using additive schema changes. Existing website intake tables and records were not modified.

## New CRM tables

| Table | Purpose |
| --- | --- |
| `crm_divisions` | TRD and CRD divisions |
| `crm_profiles` | Employee profile details tied to Supabase Auth |
| `crm_memberships` | Employee role and active access per division |
| `crm_customers` | Shared customer and business account records |
| `crm_customer_divisions` | Links shared customer records to one or both divisions |
| `crm_contacts` | People associated with customer accounts |
| `crm_properties` | Residential and commercial property records |
| `crm_roofs` | Roof sections and roof system information |
| `crm_leads` | Division scoped opportunities |
| `crm_appointments` | Inspection, sales, and service appointments |
| `crm_inspections` | Field inspection records |
| `crm_inspection_items` | Inspection observations and recommendations |
| `crm_projects` | Approved work and production projects |
| `crm_tasks` | Assigned employee tasks |
| `crm_activity_events` | Append only activity history |
| `crm_files` | Metadata for private photos and documents |

All CRM tables have RLS enabled. Authenticated Data API grants are limited to the CRM tables. The legacy website intake tables remain inaccessible through the employee browser client.

## Roles and write permissions

Read access is division scoped for active members. Write access is capability scoped:

| Role | Write areas |
| --- | --- |
| Owner | All CRM areas in assigned divisions, including team membership |
| Division Admin | All operational CRM areas in assigned divisions |
| Office Manager | All operational CRM areas in assigned divisions |
| Sales Rep | Customers, contacts, properties, leads, appointments, tasks, activity, and file metadata |
| Project Manager | Customers, contacts, properties, roofs, appointments, inspections, inspection items, projects, tasks, activity, and file metadata |
| Field Inspector | Appointments, inspections, inspection items, activity, and file metadata |
| Production Manager | Roofs, inspections, projects, tasks, activity, and file metadata |
| Accounting | Read only until the future finance module is approved |
| Read Only | Read only |

Only the CRM owner can add or change employee memberships and permanently delete operational records. Activity history is append only.

Authorization is enforced through functions in the non exposed `app_private` schema and Postgres RLS policies. Authorization does not rely on user editable Auth metadata.

## Initial owner

The existing Supabase Auth account for `theroofingdrs@gmail.com` has an owner membership in both TRD and CRD. No additional employee accounts were created.

New user signups are not self service. The Auth trigger creates a basic profile record, but an owner must assign a division membership before an employee can enter the workspace.

## Existing website submissions

The legacy `public.trd_records` table contains two existing website submissions. They remain untouched. An owner only `crm-import-website-intake` Edge Function is deployed. It reads the original submissions, maps residential and commercial leads into CRM records, and uses the source record ID to skip previously imported leads. The import has not yet been run. The two original website submissions remain unchanged.

## Security checks performed

- Verified the RLS auto enable event trigger remains active after restricting direct execution of its SECURITY DEFINER function.
- Verified newly created public tables receive RLS.
- Verified division isolation: a simulated TRD only membership can read TRD but not CRD.
- Verified Sales Rep can write leads but cannot write projects.
- Verified Read Only can read assigned division records but cannot write leads.
- Verified mismatched customer, property, and project references are rejected by division integrity checks.
- Verified a test customer, division link, and lead can be created under the authenticated owner role; the test transaction was rolled back and created no sample data.
- Verified CRM tables have RLS policies.
- Found and corrected inherited `TRUNCATE`, `TRIGGER`, `REFERENCES`, and `MAINTAIN` privileges on all 16 CRM tables. Anonymous access to CRM tables is now fully revoked, and authenticated users retain only the required CRUD grants governed by RLS.
- Rechecked all 16 CRM tables: zero anonymous data privileges and zero excess truncate, trigger, references, or maintain privileges for authenticated users.
- Supabase security advisor still reports the eight legacy intake tables as RLS enabled without policies. They have no direct anon or authenticated table grants and remain intentionally untouched.
- Leaked password protection is unavailable on the current Supabase plan. Supabase indicates that this feature requires Pro.
- The existing private bucket remains private, accepts JPEG, PNG, WebP, and PDF files up to 15 MB, and now has division scoped read, upload, update, and owner delete policies. Object paths must begin with TRD or CRD.

## Migration management note

The CRM schema was applied additively to the live project. Supabase migration history contains two recorded security migrations: `20261031004739_restrict_rls_auto_enable_execution`, which restricts direct execution of the SECURITY DEFINER RLS helper while leaving the `ensure_rls` event trigger enabled, and `20261031013644_restrict_crm_table_privileges`, which removes non row level privileges from the CRM API roles. Both source files are checked in under `supabase/migrations/`.

A 58 KB live CRM schema snapshot is checked in at `supabase/baselines/20261030_live_crm_schema_snapshot.sql`. It captures the 16 CRM tables, constraints, helper functions, indexes, triggers, RLS policies, grants, and private storage policies. It is a reference snapshot, not an executable migration and not yet a reconciled Supabase CLI baseline. It excludes live user memberships and website intake records. Before any further schema changes or a fresh environment setup, use the Supabase CLI to pull and diff the live schema, reconcile the snapshot with migration history, and validate it against a disposable project. Never reset or recreate the existing production database.
