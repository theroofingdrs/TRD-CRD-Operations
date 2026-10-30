# Architecture

## Product shape

TRD and CRD use one internal application with two operating divisions. The division is an explicit data attribute, not a visual filter alone. Every division owned record must be scoped and authorized on the server.

## Shared foundation

The following concepts may be shared when the business relationship warrants it:

- User identity and employee profile
- Customer and organization contacts
- Property and site locations
- Attachments and document metadata
- Audit events

A shared record does not grant cross division access by itself. Access is controlled by explicit division membership and role permissions.

## Division specific operations

The following remain division scoped:

- Leads and sales pipelines
- Appointments and inspections
- Roof systems and condition records
- Measurements and estimates
- Proposals and approvals
- Projects and production workflows
- Invoices and financial reporting
- Follow up and maintenance programs
- Templates, communications, and branding

## Initial roles

- Owner or Super Admin
- Division Admin
- Office Manager
- Sales Representative
- Project Manager
- Field Inspector
- Production Manager
- Accounting
- Read Only

Role names are not sufficient authorization. Permissions must be enforced in database policies and server side operations, not only hidden in the interface.

## Security principles

1. Supabase Auth is the identity provider.
2. Employee role and division membership are stored in trusted database records.
3. Never authorize access using user editable profile metadata.
4. Enable row level security on every exposed application table.
5. Use least privilege policies with explicit division membership checks.
6. Never expose a Supabase service role or secret key to browser code.
7. Keep audit records for sensitive business changes.
8. AI generated inspection content is an unverified suggestion until a qualified employee reviews it.
9. Storage objects follow the same division and record access rules as database rows.

## Hosting boundaries

The CRM receives its own Cloud Run service and environment configuration. It does not share deployment settings, secrets, database, or release pipeline with the public website or LaborXchanger.

## Planned application lifecycle

Lead → Contact → Appointment → Inspection → Measurement → Estimate → Proposal → Approval → Production → Invoice → Follow up → Maintenance

Stages may vary by division. The shared application must not force commercial and residential work into identical processes.
