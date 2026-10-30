# TRD and CRD Operations

A private internal operations platform for The ROOF Doctors and Commercial ROOF Doctors.

## Purpose

One CRM application serves two roofing divisions. The application shares core customer, contact, property, identity, and audit foundations where appropriate. Division specific workflows, records, permissions, branding, and reporting remain separated.

## Divisions

| Division | Scope |
| --- | --- |
| TRD | Residential roofing, inspections, repairs, replacements, storm restoration, and maintenance |
| CRD | Commercial roofing, inspections, repairs, restoration coatings, capital projects, and maintenance |

## Infrastructure boundaries

This application is independent of the public website and LaborXchanger.

- GitHub: source code and reviewed changes
- Supabase: dedicated database, authentication, and file storage
- Cloud Run: dedicated application hosting
- Public websites: remain separate and are not modified by this project

## Delivery approach

Work is incremental. Each phase must be reviewed and verified before moving forward. No production deployment, public website change, or external customer communication is performed without explicit approval.

## Initial implementation phases

1. Application foundation, environment configuration, and documentation
2. Supabase schema, authentication, division membership, and row level security
3. Role based navigation and operational dashboard
4. Shared customer, contact, and property records
5. Leads, appointments, inspections, measurements, estimates, and proposals
6. Project production, invoicing, follow up, and maintenance
7. Reporting, integrations, offline workflows, and AI assisted review

## Reference application

The prior Roof Doctors Field Operations and Roof Intelligence ZIP is an architectural and feature reference only. Its browser local storage, demo users, seeded customer records, and simulated integration behavior are not production data or production services. Useful domain types and workflows will be selectively migrated after review.

## Current status

Repository foundation only. No Supabase project is connected. No production data or integrations are configured. No deployment has occurred.
