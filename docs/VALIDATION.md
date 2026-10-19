# Validation record

Initial date: 2026-10-03. Environment: Windows, Node 24.19.0, pnpm 11.19.0, Next 16.3.8 development and production builds, persistent local mode, and isolated fixture/PGlite tests.

This is a historical record of the checks below, with later dated updates. Translation into English on 2026-10-19 does not imply that application tests or live-service checks were rerun. Screenshot paths refer to local validation artifacts under `docs/screenshots/`; those images are excluded from the private GitHub source snapshot.

## Map browsing update · 2026-10-07

The latest map interaction removes the separate South-View/Atlanta scope buttons, leaving one search row with the People entry. The duplicate locate button below the zoom controls has been removed; only the labeled South-View return button remains. Earlier references to manual scope controls and their screenshots describe previous versions.

- Zooming out to zoom ≤ 14 automatically expands the scope to Atlanta. Zooming to ≥ 15 with the center near the cemetery returns to cemetery scope; the interval between those thresholds preserves the previous scope. Automatic changes update only URL and data, without moving the camera. Programmatic moves for initial fitting, resizing, return-to-cemetery, and URL restoration do not trigger automatic scope changes.
- Atlanta queries, map features, list counts, and associated-place lists include the cemetery. Individual place scopes, precision, and sources remain unchanged. Shared places are not counted twice, and unmapped records remain in the list. Expansion preserves the selected cemetery place, person, filters, and embedded state.
- In the browser, zooming from 15.52 to 13.52 changed the URL to Atlanta while preserving longitude/latitude at -84.37064 / 33.70239. Each of the three people showed two associated places. Zoom 14.52 retained Atlanta; 15.52 returned to cemetery scope. The city overview showed city pins, the cemetery highlight, and a three-point cemetery cluster together.
- Final 390 × 844 mobile layout: search bar height 55px, no horizontal page overflow, and only Zoom in, Zoom out, and Return to South-View Cemetery controls at the lower right.
- The full regression run passed **90 tests**, with type checks passing across six workspace packages. After removing mode buttons, 14 map/URL tests passed again. Updated screenshots: `screenshots/map-unified-desktop.png` and `screenshots/map-unified-mobile.png`.

Earlier steps in the same map update:

- A full-window map replaced the introduction and fixed columns. The people list is collapsed by default and opens after a search. Theme-filter counts, lists, and markers agree. Layouts at 1365 × 900, 390 × 844, and 632 × 356 were checked. In short windows, expanded details use the available window; closing returns to the map rather than leaving an unreadably short text area.
- South-View uses the closed polygon from OSM way 34773826 with translucent fill, a soft outline, and a label. Initial framing and Return to South-View Cemetery fit the complete reference area to the window. OSM credit and its source link remain visible. No person coordinates or precision statements changed.
- Pins use fixed-size SVGs whose tips align with MapLibre's bottom anchor; labels do not affect root-element dimensions. After desktop selection/zoom and mobile camera moves, all three SVG tips differed from their DOM position anchors by 0 CSS px on both axes. Small basemap dots at the same coordinates provided a visual check. This verifies rendering alignment, not surveyed grave accuracy.
- Fixed markers being skipped while basemap resources were still loading. Existing markers now update when coordinates change. The first ResizeObserver no longer writes a temporary camera state to the URL prematurely, so an initial mobile visit shows the full area.
- Checked Lewis search, the Enterprise theme, Enter to open a person, Escape to close and restore focus, permanent person pages, and return to the original person/camera. Embedded menus open the standalone map; contribution links use `_blank`, and standalone URLs omit `embed`.
- A read-only local proxy blocked the map worker: a map-failure notice appeared and the list opened automatically. Herndon remained searchable, with details and permanent archive pages accessible. The proxy was stopped afterward without changing the normal demo configuration. The device GPU was not disabled.
- At this earlier stage, `pnpm test` passed **84 tests**, including polygon bounds/closure and small-window camera-space checks; all six package type checks and the final production build passed. A separate fixture-mode production preview verified the 1280 × 720 full-window layout, collapsed list, person details, and cemetery/Atlanta switching. The everyday demo was restored to local development mode.
- Screenshots: `screenshots/map-browse-desktop.png`, `screenshots/map-browse-mobile.png`, and `screenshots/map-detail-desktop.png`. Older mobile map/list-toggle descriptions below predate the map-first layout, floating list, and bottom detail panel.

## Automated checks

The following results describe the initial validation stage:

- `pnpm typecheck`: all six workspace packages passed.
- `pnpm test`: 82 tests passed. Coverage retained map, source, identity, coordinate, data-mode, tRPC, guest-receipt, original-isolation, review-transaction, attribution, supplement, photo-privacy, ownership-claim, email-code, mail-failure, and persistence checks. It also covered public full-text search, pagination and category counts, multi-person/place associations, uncertain dates, featured permissions, withdrawal dependencies, Stories URL state, and restoration of incomplete date drafts. Google OAuth and independent sign-in capability tests were included, along with eight S3/R2 storage tests.
- `pnpm build`: production build succeeded; `/explore`, `/people/[id]`, and tRPC endpoints are dynamic server routes.
- SQL migrations and seed data ran in PGlite's actual PostgreSQL engine. This stage did not connect to a live Supabase project.
- The reviewed collection contained 3 people, 6 places, 6 person-place relationships, 3 external materials, 17 sources, and 7 cross-project identity mappings. Disputes and limitations remained in the data.
- Production route checks returned 200 for map/submission pages, 403 for guest review access, and 404 for withdrawn entries/photos. Private endpoints returned `private, no-store`.
- All 19 deployment trace manifests were inspected: none contained `.southview`, private outbox files, authentication secrets, or `.env.local`. Source ZIPs likewise excluded runtime databases, contacts, original uploads, receipt tokens, and test mail.

## S3 and Cloudflare R2 storage checks

- Real signing and request serialization from the pinned AWS SDK v3 were exercised through an isolated transport layer. Checks covered the R2 endpoint, `auto` region, SigV4, path-style addressing, conditional writes, absence of ACL/personal metadata, and compatible checksum settings. Bucket-subdomain addressing for other providers was also covered.
- Tests covered missing configuration, invalid endpoints/buckets, access denial, missing buckets/objects, redirects, oversized reads, length/type mismatches, interrupted streams, and original-file cleanup. Storage failures did not fall back to local files, and returned errors excluded raw upstream diagnostics and credentials.
- The `pnpm storage:check` script ran in a child process against a real local HTTP S3 test endpoint. It wrote a PNG original and processed JPEG, read and compared them, and deleted both, leaving zero test objects. That endpoint did not connect to R2 or prove real cloud permissions or public-access settings.
- Existing community HTTP tests continued to cover private originals, receipts, ordinary-user/reviewer permissions, isolation before review, publication, withdrawal, and EXIF removal. The storage change preserved business interfaces, database attachment keys, and permanent URLs.
- At this initial test stage, no real Cloudflare bucket or credentials had been created; real integration was pending the [setup instructions](./R2-STORAGE.md). Later live R2 results appear in the 2026-10-07 deployment section below. The S3 API cannot inspect `r2.dev` or public custom-domain settings, so both must be checked in the console.

## Google sign-in checks

- Used the real Better Auth request handler, PGlite, cookies, OAuth state, and PKCE. Only Google's token-exchange/public-key network boundary was mocked. Verified first registration, repeat-account reuse, session recreation/sign-out, access-token encryption, and preservation of names, submissions, and reviewer grants after matching-email linking.
- Covered refusal to link when either Google or local email was unverified; rejection of external Origin on a first sign-in without cookies; rejection of client-added scopes/extra OAuth state; restricted off-site returns; removal of receipt fragments; cancellation; missing, mismatched, and replayed state; and failed token exchanges. No account tables or migrations were added.
- Verified that Google does not depend on SMTP, and incomplete configuration/fixture mode disable the corresponding sign-in method. Session responses expose only capability booleans, with credential-free diagnostics. Guest claims still require a receipt and matching email. Ordinary Google users cannot review, and anonymous public records exclude Google names, avatars, and private contact details.
- An isolated browser QA server used explicitly invalid test client configuration to show the Google button. No real Google account or authorization was used. The standalone page displayed Google, email-code, and guest entries together. Cancellation messages did not echo external `error_description`; return links preserved the preselected person.
- Keyboard Tab moved from Google to email. Requesting a local test code focused the code input and clearly stated that no email was sent. The 390 × 844 mobile layout and 632 × 356 equivalent-reflow check showed no horizontal overflow; primary sign-in buttons were approximately 49px high.
- A real iframe wrapper showed only “Open sign-in in a new tab,” with no embedded sign-in button. Standalone and guest exits used `_blank`. The public embedded map's complete-archive exit also opened a new tab.
- Screenshots: `screenshots/google-sign-in-desktop.jpg` and `screenshots/google-sign-in-mobile.jpg`. These depict UI with test values; the normal demo hid the Google button because real credentials were absent. Configuration and outstanding live checks are in [GOOGLE-AUTH.md](./GOOGLE-AUTH.md).
- A later visual update used Google's unchanged official 4× light rectangular asset with the gradient G and official lettering, displayed at 216×48px. A temporary local preview mocked only sign-in availability and request failure. It verified image loading, Tab to email, Shift+Tab back, visible focus, and a usable button after failure. The 390×844 viewport had no horizontal overflow. No Google authorization or production credential change occurred. `screenshots/google-sign-in-official-desktop.png` and `screenshots/google-sign-in-official-mobile.png` supersede the older button appearance; the OAuth flow remained unchanged.

## Stories and photo-viewer checks

- `/stories` displayed 7 discoverable records: 3 people, 3 materials, and 1 portrait with documented rights. With no published community stories, it showed an explicit invitation/empty state.
- Searching Selma found the Remembering Selma oral-history material with highlighted summary text. Returning to Stories from its material anchor retained the query. Clearing filters synchronized URL, inputs, and results.
- Enlarged photos showed creator, provider, permission, and source. Escape closed the viewer and restored focus to the thumbnail. Neither the 390 × 844 mobile layout nor 632 × 356 equivalent 200% reflow overflowed horizontally.
- Optional contribution associations accepted other people and mentioned places. Date-type switching displayed the year-range fields correctly; mobile labels, checkboxes, and year inputs worked.
- Production-mode Stories search and photo pages returned 200. `archive.discover` returned the expected matches, and public photo pages included rights information. No fictional community stories were published to shared demo data.
- Multi-photo navigation, swiping, and error states were implemented. The public collection contained only one photo, so browser testing covered the single-photo viewer; isolated tests and code review covered multiple-photo data, permissions, and ordering. This stage did not connect to real SMTP or Supabase.

## Community-contribution browser checks

| Scenario | Observed result |
| --- | --- |
| Anonymous guest submission | No sign-in required; private name/email required. Preview confirmation persisted the record and returned a submission ID and private receipt. |
| Restart and revisit | Submissions and accounts survived a Next restart; the original receipt still worked. |
| Optional sign-in and claiming | Test codes went to the developer-only outbox, with an explicit no-email-sent message. The signed-in user claimed the submission using its original receipt. |
| Human review and supplements | Reviewer access was granted through the CLI. After a request for information, the contributor saw the message and supplied text and an actual PNG test image. |
| Publication | A memory without external links could be published independently. Its permanent page showed Anonymous contributor — entry title, with separate photo creator, permission, and provider credits. |
| Person aggregation | Existing summaries, factual paragraphs, places, photos, and materials retained Initial archive compilation. New contributions appeared independently without overwriting names or biographies. |
| Withdrawal | The test entry and public photo access were withdrawn; original content and review history remained. Temporary reviewer access was revoked and the session signed out. |
| Mobile and keyboard | The 390 × 844 viewport had no horizontal overflow; fields were labeled and Tab moved from title to body. The 632 × 356 equivalent 200% reflow check also had no horizontal overflow. |
| Embedded entry points | Global and person-specific contribution links used `_blank`, retaining the preselected person. City switching, sources, and details continued to work. |

Browser test content was explicitly labeled as nonhistorical test material. No test memory was left in the public collection.

## Manual browser checks

Some controls in this initial table were replaced by the map-first update described above.

| Scenario | Observed result |
| --- | --- |
| Search Lewis | List, count, and places narrowed together to John Lewis; empty results offered a clear-filters action. |
| Enterprise theme | Only Alonzo Herndon appeared, with matching filtered map places. |
| Keyboard Enter / Escape | Opened the person preview, moved focus into the panel, and restored the trigger after closing. Map points were focusable buttons. |
| Cemetery / Atlanta switching | Preserved the selected person while changing the associated places; a new selection moved the camera. |
| Archive pages and sources | Direct person URLs, numbered source anchors, and original-source links worked. Returning preserved search, scope, person, and camera. |
| City overview | Three places clustered into a circle labeled 3, expanding on zoom; attribution stayed visible. |
| Mobile 390 × 844 | Map/list switching worked, details scrolled, primary controls stayed visible, and there was no horizontal page overflow. Covered lists did not accept keyboard focus. |
| embed=1 | Simplified header; standalone URLs omitted embed, and permanent archive URLs omitted embed/return parameters. |
| Basemap failure | A temporary nonexistent local style URL produced retry/list guidance. Herndon remained searchable and his archive readable. The normal basemap was restored before rebuilding. |
| Equivalent zoom reflow | A 538 × 402 CSS viewport approximated the narrow layout of the original roughly 1076 × 804 viewport at 200% zoom. |

## Shared-navigation checks · 2026-10-07

- Map, Stories, John Lewis, About, contribution, My contributions, and sign-in pages used the same `/icon.svg`, wordmark, and 64px header, with consistent link order and active highlighting. Receipt, public-contribution, and review pages shared navigation through `CommunityShell`; private submissions were not inspected for this check.
- Contribute from a person page still preselected John Lewis. The logo returned to `/explore`, while the existing return link retained map/Stories state.
- At 390 × 844, Enter opened the mobile menu, Escape closed it and restored focus, and outside clicks/page navigation dismissed it. At 632 × 356, map details started below navigation without covering it or overflowing horizontally.
- In `embed=1`, the logo, menu, and standalone-map entry opened new windows. Standalone URLs omitted embed, contribution links retained the selected person, and closing the menu did not close person details.
- Six workspace type checks, 14 scope/camera/URL tests, and the production build passed. Authentication, storage, and review behavior were not changed in this update.
- Screenshots: `screenshots/navigation-map-desktop.png`, `screenshots/navigation-stories-desktop.png`, and `screenshots/navigation-mobile.png`. Older navigation screenshots remained historical local artifacts.

## Later validation and remaining limits

### Alignment follow-up · 2026-10-07

- Map search and the People button were both 44px high with aligned vertical centers; the count used a separate badge. At 320px, icon, count, and full accessible name remained available without crowding out search.
- Person previews used separate portrait/identity columns. Theme, name, and year shared a left edge; name suffixes stayed with surnames; the MK monogram stayed inside its avatar. Source icons aligned with the first text line, with a fixed icon column for wrapped links.
- Layout checks at desktop 1280px, 390 × 844, 320 × 568, and 632 × 356 showed no horizontal overflow. Short-screen details started below the 64px header. Equivalent-zoom limits are noted below.
- The John Lewis return link aligned with body copy, and source text columns aligned. Removing independent fixed positioning from two sidebar cards prevented overlap during scrolling while retaining a 24px gap. Citation targets remained below navigation.
- Six workspace type checks and the production build passed. This was a layout update; coordinates, search data, identity permissions, and public citations were unchanged.
- Screenshots: `screenshots/alignment-map-desktop.png`, `screenshots/alignment-map-mobile.png`, and `screenshots/alignment-person-desktop.png`.

### Vercel, Supabase, and R2 deployment · 2026-10-07

- The Vercel production build and six workspace type checks passed. All 91 existing tests passed; after adding direct-upload HTTP authorization/signature-limit checks, all 15 relevant tests passed.
- The dedicated free Supabase database received four versioned migrations and the public archive seed. Local identities, submissions, and outbox files were not uploaded.
- Live tests covered guest text/link submissions and a 6,763,777-byte photo, validation, EXIF removal, temporary private-original downloads, repeated upload completion, and follow-up after finalization. Requests without receipts and public access to unreviewed contributions/photos returned 404; guest review API requests returned 403. Test content was never public, and only the test records/files were cleaned up afterward.
- The `south-view-archive` R2 bucket remained private, with application credentials scoped to object read/write in that bucket alone. CORS preflight for the production origin returned 204; one-day expiry for temporary `staging/` objects was enabled. The unused, empty bucket with the previous name was deleted after user confirmation.
- Production URL: <https://south-view-archive.vercel.app/explore>. This deployment uploaded local source directly, without a GitHub commit/push at that time. Resources and remaining configuration are in [VERCEL.md](VERCEL.md).

### Wide-screen hover and detail-panel fix · 2026-10-07, deployed

- Short previews appeared beside the active place marker or people-list row, avoiding screen edges, navigation, and search results, instead of being fixed at the bottom center.
- With the right panel open, hovering immediately updated both person and specific place. The small preview used a 60ms delay when the panel was closed. Leaving a marker retained the panel's record for continued reading. The active place appeared first in the associated-place list and was marked selected.
- Hover updated selection by replacing the current URL without adding history entries, moving the camera, or stealing focus. Keyboard focus updated immediately; touch still used selection by tap. Dragging, leaving the window, changing filters, or pressing Escape canceled pending previews.
- Markers preserved their DOM/SVG when selection styling changed rather than rebuilding content under the pointer. Previews paused during camera movement, then rechecked the marker under the pointer and triggered without requiring re-entry. Markers that had been left, covered, or canceled with Escape did not retrigger. This supported desktops with both touch and mouse input.
- All 27 targeted tests passed, covering preview delay/cancellation, replay after animation, person/place matching, wide-screen placement, map filters/camera, and return links. TypeScript checks and production build passed.
- Local browser access was rejected by the tool's address-safety check. After redeployment, Edge checks on production showed the preview beside a keyboard-focused marker. Switching from King Sr. to John Lewis updated the right panel and selected marker while retaining `lng=-84.37280&lat=33.70166&z=17.00`. Screenshots: `screenshots/vercel-hover-preview.png` and `screenshots/vercel-hover-detail.png`. These verify placement and keyboard linkage, not actual pointer-hover feel or a renewed mobile check.
- Deployment `dpl_A9DqTGvCGeC6LkBB6hRHZ9FS12Cv` passed build/type checks and updated the production alias; map, person, and contribution pages returned HTTP 200. This was still a direct local-source deployment without GitHub commit/push at that time.

### Outstanding production verification

- The browser tool did not expose native zoom, and shortcut attempts did not change its zoom level. The results above are equivalent-layout reflow checks, **not native 200% browser-zoom testing or screen-reader certification**. Repeat those manually in target browsers before release.
- Basemap failure fallback was exercised. The device GPU was not forcibly disabled. WebGL initialization-failure and context-lost branches were implemented but still need target-device testing.
- A standalone Vercel site was published without modifying the existing cemetery website. The complete production iframe ancestor chain still needs validation on that website.
- SMTP and the retained Supabase private-storage adapter were tested in isolation; no external emails were sent. In the recorded deployment, Google OAuth and SMTP remained unconfigured, so online accounts and staff web review were unavailable. Mail delivery, backup/restore, and real operational review still require verification.
- Cemetery coordinates are reference positions, not independently surveyed graves, and cannot support turn-by-turn grave navigation. King Sr.'s conflicting birth years were not arbitrarily resolved. The two people without licensed portraits use monograms.

## Reproduction

Follow the root README to install and start the application. Run `pnpm typecheck`, `pnpm test`, and `pnpm build`, then `pnpm start`. Visit `/explore` and repeat the relevant flows above. Change `NEXT_PUBLIC_MAP_STYLE_URL` temporarily only in development for basemap-failure checks, restore it afterward, and rebuild. Database-failure tests use isolated test adapters rather than changing production connections.

Screenshots referenced here are local validation artifacts under `screenshots/`, intentionally excluded from the GitHub snapshot. The 2026-10-19 repository/documentation update did not redeploy the application or complete the work-in-progress AI review dashboard.
