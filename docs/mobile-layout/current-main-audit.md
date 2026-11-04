# Customer mobile layout acceptance audit

**Release blocker remains open. This PR is regression/verification work, not a
claim that the production iPhone defect is fixed. No application CSS was changed:
current main already contains the earlier correction and outward overflow was not
reproduced against it. Local implementation/testing did not wait for production access.**

## Source and reproduction

Baseline: `d03d5d54637c754d26e0184d006674969be7df43` (`main`, including #29).
The customer layout is:

`#root → .app-shell → .main-area → .content-stack → customer .panel →
.content-stack.customer-detail-sections → .customer-service-history`.

The customer detail grid also owns billing/mailing address, linked records,
properties, the Roofr report panel, roofs, claims and other linked sections.
Current source already uses `minmax(0,1fr)` tracks, zero minimum sizes, wrapping
headings/actions and controls, and local table scroll containers. There is no
document-level horizontal clipping. These corrections predate this audit.

The unmodified source passed all 352 existing Chromium cases. A more realistic
empty-history customer (one property, no roofs/reports/claims) and the existing
long-text stress fixture also pass the stricter measurements. The earlier iPhone
screenshot's horizontal mobile navigation differs from current source's wrapping
two-column navigation. That is a reason to identify the serving build, **not proof
of which revision production currently runs**.

Do not add another containment override without a failing reproduction against
the serving assets or the affected browser. Current-source Chromium measurements
cannot identify the exact production root cause.

## Test gap corrected

The old assertions primarily measured global page bounds, selected layout
containers and heading alignment. A paragraph could escape its section into the
card's padding without leaving the larger main-area bounds. Tests did not inspect
painted text ranges or explicitly require balanced service-section margins and
the heading, description, action and empty-state presence together.

`customer-layout-check.mjs` now checks those requirements on the rendered customer
screen, including all service descendants outside genuine table scrollers,
painted text, sibling customer sections, and clipping ancestors. A controlled
8px shift of the service description must fail the new assertion even though
document width remains 390px. The mutation is removed before normal scenarios;
it does not change source CSS or production behavior.

The responsive script builds and serves the actual application, navigates via
browser input, and uses synthetic authentication/data with all external browser
traffic intercepted. It runs 360 scenario/width combinations at
320/360/375/390/430/768/1024/1440px, including ordinary and long-text customers,
closed/expanded service history, property/customer forms, Roofr review, and the
existing workspace regression matrix. No production records are read or written.

At mobile widths the service section's left edge is 31px and right edge is
`viewport − 31px`: 14px page padding + 1px card border + 16px card padding.
Both section margins relative to the customer card content are zero. Desktop
and tablet checks use the card's actual content box, accounting for the sidebar.

## Serving-build verification

After building the candidate, run in an environment allowed to reach production:

```
npm run build
node scripts/verify-responsive-assets.mjs --url https://operations.theroofingdrs.com/
```

This read-only command GETs the public HTML and its same-origin stylesheets and
compares their SHA-256 content with the local production build. A stale stylesheet,
unexpected shell, HTTP error or network failure fails explicitly. It sends no
credentials and does not call customer APIs. Tests exercise matching/stale bytes
and HTTP failure; the responsive suite also checks the actual served local build.

**A stylesheet match does not prove the JavaScript revision, authentication, font
loading, iPhone behavior, or a successful UI fix.** If CSS differs, identify the
Cloud Run revision/image and browser cache before adding source patches. Then
inspect the actual affected customer with the owner's authorized session,
record document/visual viewport and parent/descendant bounds, and verify Safari
on the real mobile device. Do not record customer data in screenshots or logs.

## Access limitations and evidence

The current managed session has no production browser identity. Its enforced
network policy allows the configured Supabase host but not the Operations public
host. The web tool also reports the Operations URL inaccessible. No authentication
changes, production configuration changes or deployment were attempted.

A separate WebKit image pull failed with a registry-layer `Forbidden` response;
WebKit/Safari testing was therefore **not performed**. Chromium screenshots below
must not be described as iPhone or production evidence.

## Historical reproduction and screenshot comparison

For a failing case, the same current customer component and stress fixture were
rendered with the historical stylesheet from `e9e2b5d`. Document-level clipping
was disabled for diagnosis; no application source file was overwritten. Its
`.content-stack` and nested `.form-grid` implicit auto-minimum tracks allowed
native controls/long content to expand the customer detail grid. Service history
inherited that grid's width; it was not the original source of expansion. At
320px it extended to 338.77px even though the card content ended at 289px. At
360px the document still measured 360px while the same section escaped the card
content by 9.77px. This demonstrates why document width alone is insufficient.

These comparisons are **historical stylesheet versus current main**, not a new
layout change in this PR, and not screenshots of the deployed CRM. The existing
`c820742` correction on main supplies zero-minimum tracks and shrinkable children.

| Width | Historical document / section width | Current document / section width | Historical CSS | Current main |
| --- | --- | --- | --- | --- |
| 320 | 339 / 307.77 | 320 / 258 | [Image](audit-historical-320.png) | [Image](audit-current-320.png) |
| 360 | 360 / 307.77 | 360 / 298 | [Image](audit-historical-360.png) | [Image](audit-current-360.png) |
| 375 | 375 / 313 | 375 / 313 | [Image](audit-historical-375.png) | [Image](audit-current-375.png) |
| 390 | 390 / 328 | 390 / 328 | [Image](audit-historical-390.png) | [Image](audit-current-390.png) |

At 375/390px this historical fixture did not reproduce outward overflow either;
do not infer a failure from its older styling alone. All screenshots contain only
synthetic customer/property data.

## Short owner verification procedure after an authorized deployment

1. On the iPhone, open the CRM and an existing customer card; leave forms closed.
   Do not create or edit a customer to perform this check.
2. Check billing/mailing address, linked records, properties and Roofr, then scroll
   to maintenance/service history. Its heading, description, add button and empty
   state should share the customer card's content margins and remain readable.
3. Try horizontal page scrolling. A wide data table may scroll inside its own
   wrapper, but the card/page should not move sideways. If needed, open the service
   form to check fields/buttons and close it without saving.
4. With Safari Remote Web Inspector, compare the document scroll width with the
   device viewport and inspect the section against the customer card's padding.
   Record geometry/build identifiers only, not customer text. Check the served
   stylesheet with the read-only command above if the UI differs from these
   source screenshots. Repeat at 320/360/375/390px and tablet/desktop sizes.

No authenticated production result or iPhone acceptance is claimed.
