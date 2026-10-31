# TRD / CRD Proposals, Inspections, and Warranties

## Confirmed product decisions
- Electronic signatures are deferred. Initial customer delivery is a generated PDF with manual signature handling.
- Proposal pricing supports itemized line items and a lump sum.
- Begin with professional standard TRD and CRD templates that remain editable.

## Delivery sequence
1. Data foundation: additive proposal and warranty records, inspection measurements and template metadata, division scoped RLS, and no changes to existing customer or project records.
2. Proposal workspace: separate residential and commercial forms, editable sections, pricing modes, saved drafts, and proposal history per customer and property.
3. Inspection workspace: separate TRD and CRD checklists, severity and recommendations, measurements and roof sections, photo upload and captions linked to existing private CRM file storage.
4. Documents and delivery: generate branded PDFs from saved records, email to the selected customer contact through a verified server side email integration, and record delivery status and history.
5. Warranty workspace: editable workmanship and manufacturer warranty records, linked to customer, property, project, and generated documents.

## Security and preservation requirements
- Existing CRM records and current tables remain intact.
- New records use existing division membership authorization helpers.
- Property and customer links are validated against the active division.
- Uploaded files remain in the existing private bucket and use its current storage access policies.
- No service role key or email credential is placed in browser code.
- No production schema change or deployment occurs from this feature branch without review and verification.

## Open implementation checks
- Confirm the existing email sender and server side delivery path before enabling customer email.
- Confirm PDF generation and file retention behavior against the existing private file model.
- Test TRD and CRD access separately, including read only and field inspector roles.
