# Operations responsive layout correction

This is source validation, not deployment verification. The owner's iPhone image
shows the customer card remaining narrow while its shared detail grid expands
past it. The real screenshot is not included here because it contains customer
data. All captured images and browser fixtures below are synthetic.

## Layout trace and findings

The shared path is `#root → .app-shell → .main-area → .content-stack → customer
.panel → .content-stack.customer-detail-sections`. Billing/mailing address, linked
records, properties, Roofr and service history are children of that final grid.
Constraining only the service section cannot correct an oversized grid track.

The earlier stylesheet (`e9e2b5d`) retained implicit auto-minimum grid tracks.
Rendered against the current customer component at 320px, the detail track was
307.77px wide inside a 258px content box. The address summary, properties, Roofr
panel and service history consequently shared the same out-of-parent extent.
Native controls and content participated in intrinsic sizing. This reproduces the
shared sizing failure, but does not identify the deployed revision in the owner's
screenshot.

The latest-main baseline (`740775c`) already contained multiple appended fixes.
Its closed customer section did **not** reproduce document-level outward overflow
in Chromium at the requested widths when body clipping was removed. It did still
have these measured defects:

- Service-history headings had an extra 13px mobile inset: 12px padding plus a 1px
  border added inside the already padded customer card.
- Blanket `input { width:100% }` also sized checkboxes, whose default margin pushed
  them 4px outside their parent in customer, import, contact and proposal forms.
- Mobile `white-space:normal` and inherited anywhere-wrapping compressed customer
  table headers into near-vertical text instead of preserving readable columns.
- Body-level `overflow-x:hidden` concealed rather than proved containment.

The cleanup replaces the overlapping containment patches with one shared sizing
contract: zero-minimum grid tracks and children, shrinkable controls, bounded
Roofr field labels, wrapping action groups, and locally scrollable data tables.
Service history uses its parent's spacing. Mobile navigation wraps and scrolls
vertically; mobile kanban columns stack. Desktop/tablet navigation and board
behavior retain their wider layouts. Text autosizing is normalized for mobile
WebKit without restricting pinch zoom. No global horizontal clipping remains.

## Browser regression coverage

Run `npm run test:responsive`. The test builds the production React CRM with synthetic public bindings and renders it in Chromium,
seeds synthetic employee authentication and intercepts **all external traffic**.
It never reads or modifies production records. All 22 workspaces are rendered,
including customer details with empty/populated service history, service/property/
customer forms, Roofr review and custom waste controls, project financial details
and expense forms, and other available workspace forms.

Every scenario runs at **320, 360, 375, 390, 430, 768, 1024 and 1440px**. Checks cover
requested device width versus document/layout width, main-area margins, immediate
parent content bounds, service-heading alignment, readable customer-table headers,
root clipping, table-cell control bounds, and browser runtime errors. Attachment downloads are hit-tested after local table scrolling at every width. Browser input events open the forms and
navigate the UI. The test uses long addresses, unbroken references and filenames.
It does not mistake an expanded mobile `window.innerWidth` for the requested width.

Set `RESPONSIVE_CAPTURE_DIR=work/responsive` to save optional screenshots and
measurements locally. Normal CI creates no screenshot transfer package. The
workflow runs this test on subsequent changes. A passing production build alone
is insufficient.

## Before and after

These images use the same synthetic data and 900px viewport height. The before
stylesheet is from `740775c`, with body clipping disabled for diagnosis. The after
stylesheet is the correction. They show the service section and neighboring table
content; other sections are verified by element bounds even when off-screen.

| Width | Before | After |
| --- | --- | --- |
| 320px | [Baseline](before-320.png) | [Corrected](after-320.png) |
| 390px | [Baseline](before-390.png) | [Corrected](after-390.png) |

No production deployment, migration, secret change or customer-data mutation was
performed. The serving build at `www.operations.theroofingdrs.com` was not identified
from this environment; the source verification does not claim the live iPhone
page has changed. That requires a separately approved deployment and device check.
