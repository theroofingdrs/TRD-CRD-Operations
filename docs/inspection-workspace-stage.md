# Inspection workspace stage

The inspection workspace uses existing `crm_inspections` and `crm_inspection_items` records. It adds a small metadata table for photo captions and labels, while image bytes remain in the existing private `roof-doctors-private` bucket and metadata remains in `crm_files`.

TRD and CRD receive different checklist templates. Each item supports a finding checkbox, severity, location, observation, recommendation, and optional photo association. Measurements and roof sections are stored in the additive JSON fields on the inspection record.

The inspection photo table is division scoped and validates that the linked inspection and file belong to the same division. No public bucket or public URL is used.
