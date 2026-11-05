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

Every scenario runs at **320, 360, 375, 390, 414, 667, 768, 1024, 1280 and 1440px**. Checks cover
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

## Reproducible CI browser startup

The failing main run `41871213259` used the mutable `ubuntu-latest` image, which
resolved to Ubuntu 26.04. There was no browser installation step or locked browser
dependency. The old launcher selected the first command found by `which`, ignored
its stderr, and polled a fixed port for only 15 seconds. Consequently the original
log does not establish whether that particular process exited or was still starting.

A controlled hosted probe in run `41874756050` captured the original command:
`/usr/bin/chromium`, Chromium 156.0.8078.0, ready after **12,605 ms**, with no prior
listener on port 19422 and nonfatal D-Bus warnings. A separate successful probe in
run `41873872623` selected `/usr/bin/google-chrome`, Google Chrome 156.0.8078.47.
This establishes variable ambient-browser selection and a cold start close to the
15-second cutoff; it does not prove a missing binary or missing shared library.
The discarded stderr from the exact original failure cannot be reconstructed.

The build job now uses Ubuntu 24.04 and exact `playwright@1.64.1` from the lockfile.
`playwright install --with-deps chromium` installs the matching browser revision
and Linux dependencies (Chromium 156.0.8078.4, revision 1248 for this lockfile). Its executable path is explicitly exported as `CHROME_BIN`.
CI never silently falls back to a preinstalled system browser. No Playwright browser
or dependency is added to the shipped frontend bundle.

The launcher verifies the executable/version, captures bounded stderr, fails fast
on launch error/early exit, allows 60 seconds for hosted startup, and reports the
actual readiness delay. Each browser gets a private profile and OS-assigned debug
port; readiness uses its own `DevToolsActivePort` file and validates the local
DevTools endpoint. Failed processes are terminated with bounded cleanup. Missing
binary, early exit, stalled startup and wrong-endpoint diagnostics have automated
tests. The viewport and overflow assertions remain unchanged.

For local machines with a working system browser, use
`CHROME_BIN=/absolute/path/to/chromium npm run test:responsive`, or install the
locked browser with `npm exec -- playwright install chromium`. Never put credentials
in browser arguments or diagnostics. These changes affect test infrastructure only;
no production configuration, deployment or customer record is changed.
