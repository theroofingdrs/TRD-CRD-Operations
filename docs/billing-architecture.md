# Billing and Service Catalog Architecture

## Purpose

The TRD and CRD operations CRM will support one time payments, deposits, progress billing, final invoices, recurring maintenance plans, and future paid services.

The CRM is the operational record for customers, properties, work, invoices, and payment status. Stripe is the payment processor and source of truth for payment execution. Stripe credentials must remain server side.

## Divisions

Every service, estimate, invoice, subscription, payment record, refund, and revenue report must carry a division identifier.

Supported divisions:

1. TRD residential roofing
2. CRD commercial roofing

Shared customer and property records may be associated with both divisions when appropriate. Financial records must never lose their division attribution.

## Configurable service catalog

Services are records, not hard coded checkout buttons. Authorized administrators can create, edit, deactivate, and categorize services without a code deployment.

Initial service categories:

1. Roof replacement and re roofing
2. Roof repair and leak service
3. Roof inspection and assessment
4. Emergency roofing service
5. Roof restoration and coatings
6. Gutter cleaning
7. Roof cleaning
8. Preventive maintenance
9. Recurring residential maintenance plans
10. Commercial maintenance agreements
11. Other administrator defined services

Each service can define its division availability, description, unit of measure, default price, tax category, billing type, deposit rules, and whether recurring billing is supported.

Prices must be configurable and must not be invented or assumed during implementation.

## Billing capabilities

### One time invoices

Support line items, quantities, discounts, approved taxes, deposits, progress payments, due dates, partial payments, payment links, receipts, refunds, and balance due.

### Recurring plans

Support monthly, quarterly, annual, and administrator defined billing intervals. Track enrollment, start date, renewal date, status, payment method reference, cancellation, failed payment, and renewal history.

### Project payment schedules

Allow an approved estimate or contract to define a deposit and milestone schedule. Each scheduled amount becomes an invoice or payment request linked to the project.

### Payment methods

Use Stripe hosted Checkout or Stripe hosted invoice payment experiences where appropriate. Do not store card numbers or CVC values in the CRM. Store only safe Stripe identifiers and display metadata.

## Stripe integration requirements

1. Use a server side Stripe client. Never expose secret or restricted keys to browser code.
2. Use Stripe Checkout Sessions for customer initiated one time payments.
3. Use Stripe Billing for recurring maintenance plans.
4. Use Stripe Invoices when invoice lifecycle, due dates, partial payments, and customer billing records require them.
5. Use signed webhooks as the authoritative mechanism for payment completion, asynchronous payment success, failures, refunds, subscription changes, and invoice status.
6. Make webhook processing idempotent and retain event identifiers.
7. Do not mark an invoice paid based only on a browser success page or redirect.
8. Keep test and live environments separate. Do not enable live payments until test flows and reconciliation are verified.
9. Do not enable automatic tax until the business confirms its tax registrations and applicable jurisdictions.
10. Do not create Stripe products or prices in live mode without explicit approval of the actual service names and prices.

## Core records to design

The database design should include:

1. service_categories
2. services
3. service_price_versions
4. estimates
5. estimate_line_items
6. invoices
7. invoice_line_items
8. payment_schedules
9. payments
10. refunds
11. maintenance_plans
12. customer_plan_subscriptions
13. stripe_customers
14. stripe_webhook_events
15. billing_audit_events

Use integer minor currency units for monetary amounts, together with an explicit ISO currency code. Preserve snapshots of service descriptions and prices on approved estimates and invoices so later catalog edits do not rewrite historical documents.

## Security and audit

All financial records must be protected by RLS and division scoped authorization. Employees should see only the divisions and records allowed by their role. Only authorized roles may issue refunds, void invoices, change prices, or manage recurring plans. Record who performed each financial action and when.

Stripe webhook endpoints must verify signatures. Webhook event processing must be idempotent. Never put Stripe secrets in client code, GitHub commits, logs, or customer visible pages.

## Delivery order

1. Complete authentication and role based access.
2. Establish division scoped CRM foundations and customer, property, lead, and project records.
3. Add the configurable service catalog.
4. Add estimates, invoices, and payment schedules.
5. Connect Stripe in test mode and validate one time payment flows.
6. Add recurring maintenance plans and subscription lifecycle handling.
7. Add signed webhooks, reconciliation, refunds, and audit coverage.
8. Complete test coverage and security review before any live payment activation.

## Explicit boundaries

This design does not authorize live charges, create live Stripe products, set service prices, enable automatic tax, or change the public TRD or CRD websites. Existing website lead submissions must remain intact.
