# Prior CRM Reference Review

Source: The Roof Doctors Field Operations and Roof Intelligence ZIP supplied for this project.

## Useful capabilities to preserve or adapt

- CRM dashboard and lead management
- Customer and property records
- Appointment scheduling and field assignment
- Field operations dashboard
- Inspection workspace and configurable checklists
- Inspection photos and supporting documentation
- Roof system, component, condition, and service history records
- Measurement request and provider abstraction
- Project management
- Audit history
- Offline synchronization concepts
- AI assisted inspection screening with human review

## Important limitations found in the reference

- The application stores its primary dataset in browser local storage.
- It includes hard coded demo users and seeded customer and property records.
- The package describes Gemini integration, but the presence of an integration abstraction does not establish a production service connection.
- The Roofr integration view and measurement provider abstraction require separate credential, API, and workflow verification.
- The reference is oriented around residential roofing and needs explicit commercial workflows and data modeling.
- Public website components included in the reference are out of scope for this internal CRM.

## Migration rule

Do not copy the reference wholesale. Extract and adapt domain concepts, types, and useful workflows into a secure server persisted application. Do not migrate demo records, fake credentials, local storage as the system of record, or simulated integration success.
