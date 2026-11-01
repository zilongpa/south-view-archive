# South-View · A Living Archive

A public archive application designed to grow into a production service, connecting people with South-View Cemetery and places across Atlanta. Built from a focused **create-t3-turbo** starter: Next.js App Router, TypeScript, pnpm/Turbo, tRPC, Drizzle/PostgreSQL, and MapLibre GL JS.

The application includes a map and people list, search and filters, cemetery/city views, cited person pages, links to oral histories and documents, community submissions, optional Google sign-in, private receipts, staff review, attributed publication, and withdrawal. **The archive sends no email**: contributors keep the private receipt link shown after sending, and review decisions appear on that page. The initial archive contains **3 people and 6 places**. Submissions are not published automatically. Personal memories retain their own attribution and do not automatically become biographical facts. Staff can run optional GPT-6 Luna review with web research after configuring the server OpenAI key. Recording and audio-file uploads are not supported. AI findings remain advisory; only staff can publish.

`/explore` uses a full-window map for immediate browsing. A single-line search bar and People entry sit at the upper left; separate South-View/Atlanta mode buttons have been removed. Selecting a pin opens a side panel, or a bottom panel on mobile. South-View has a translucent area highlight and outline, with zoom controls and a single labeled return button at the lower right. Zooming out to city scale automatically shows Atlanta locations **alongside all cemetery locations**; zooming back near the cemetery focuses that area again. Automatic changes preserve the camera, filters, and selected person. The detail panel can still locate a person's associated places. The OpenStreetMap outline is a reference area, not a surveyed property boundary. Pin tips anchor to coordinates, and filters, selection, and camera state remain in the URL. Facts, sources, and item-level attribution remain available in the details.

Map, person, about, submission, sign-in, and management pages share `SiteNavigation`: the same logo, wordmark, 64px header, and three destinations (Explore, Share a story, My contributions). Published community stories appear on person pages and their own permanent pages; there is no separate Stories section. The 2026-10-28 usability update also added a required-field legend, example placeholders, inline validation, distinct grave and related-place markers with a legend, and a higher-contrast palette.

**Contributions are made on the person's own page.** Pressing _Edit this page_ (or arriving with `?edit=1`) shows + buttons after each biography paragraph, under the places list, and in the community section, plus a photograph slot when no portrait exists. Each addition is written in place, previewed as an _awaiting review_ block, and sent as an ordinary submission carrying an advisory `placement` (section, paragraph, proposed place name) that the review desk displays. Several additions sent together share one private receipt link. `/contribute` now only introduces a person who is not in the archive yet and otherwise redirects visitors to the right person page. The mobile menu supports keyboard use, Escape, and outside-click dismissal. Map search sits below the header; person-page contribution links retain the selected person, and embedded pages provide standalone-window entry points.

Submission and review forms support additional related people, existing places mentioned in the material, and known, approximate, ranged, or unknown event dates. One contribution can appear on multiple person pages without duplicate uploads or overwriting biographies. Event dates are separate from publication dates. Only reviewers can add a story to Editor's selections when publishing; selection does not turn a community memory into a verified fact. The initial collection contains no invented community stories.

## Quick start

Requires **Node.js 22.21 or later** and **pnpm 11.19.x**. The lockfile is committed. Run these commands from the repository root:

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example apps/nextjs/.env.local
pnpm dev
```

On macOS or Linux, use `cp .env.example apps/nextjs/.env.local` instead of `Copy-Item`. If that file already exists, edit it rather than overwriting it.

Open [http://127.0.0.1:3000/explore](http://127.0.0.1:3000/explore). The default `ARCHIVE_DATA_MODE=local` creates a persistent PGlite database under **`.southview/`** at the repository root, applies migrations, and imports the initial collection once. Restarting does not erase submissions or overwrite records. No external database account or map API key is required; the OpenFreeMap basemap needs an internet connection.

No email is sent in any mode. Guest contributors receive their private receipt link on screen after sending; account holders sign in with Google. Photos and the development authentication secret live under `.southview/`. This directory is ignored by Git and must never be moved into `public/` or served as static files. `SOUTHVIEW_DATA_DIR` changes the shared private-data root.

Common commands:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`pnpm check` runs type checks, tests, and a production build in sequence. Tests use isolated databases, temporary files, and mocked external requests; they do not connect to a live cloud database or send email. `pnpm start` requires a build and runs in production mode: the development outbox is disabled even with a local database. Sign-in then requires an HTTPS origin, an explicit authentication secret, and valid Google OAuth configuration. Use `pnpm dev` for the local guest-submission demo. The server listens on `127.0.0.1` by default; containers and hosting platforms should use their required host and port.

MapLibre 6 requires a worker and shared module from the same version. `dev` and `build` automatically run `apps/nextjs/scripts/prepare-map.mjs`, copying the installed worker, matching shared module, and license to `apps/nextjs/public/vendor/maplibre/`. Do not download or commit those generated files separately. Use the project scripts rather than bypassing preparation with a direct `next build`. Deployments must include the generated files and serve them under `/vendor/maplibre/`; `start` uses the assets prepared during the build.

If a Node version manager reports a missing version, first make sure `node --version` and `pnpm --version` work. The application does not depend on Codex or a particular local directory.

## Environment files: web application and database scripts

`.env.example` documents configuration; it is not loaded automatically.

| Use                                                                  | Local configuration                   | Loading behavior                                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`, Next builds, and the running web application             | `apps/nextjs/.env.local`              | Next runs from `apps/nextjs` and does not automatically read the root `.env`.                                                                                 |
| Migrations, seeding, `pnpm reviewer:grant`, and `pnpm storage:check` | Root `.env.local` or `.env`           | Root `.env.local` is loaded before root `.env`; existing process variables take precedence. These scripts do not read the web application's environment file. |
| Deployment                                                           | Hosting platform environment settings | Keep server secrets out of browser variables and Git.                                                                                                         |

```dotenv
# apps/nextjs/.env.local
ARCHIVE_DATA_MODE=local
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000
BETTER_AUTH_URL=http://127.0.0.1:3000
PHOTO_STORAGE=local
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/positron
NEXT_PUBLIC_MAP_FONT=Noto Sans Regular
```

- `ARCHIVE_DATA_MODE` accepts `local` (the default persistent local database), `fixture` (read-only initial archive; community writes rejected), or `database` (an explicitly configured PostgreSQL connection). Browser requests cannot change the mode.
- `database` requires a server-side `DATABASE_URL` and does not automatically migrate or seed. Connection failures, missing tables, and invalid references produce errors; **there is no silent fallback to demo data**.
- `PHOTO_STORAGE=local` stores photos locally; `PHOTO_STORAGE=s3` uses private S3-compatible storage, with Cloudflare R2 used for the deployed configuration. If omitted, the photo driver defaults to `s3` in database mode and `local` otherwise. Storage and database modes can be chosen independently; a local database can use R2. See [R2 setup and connection checks](docs/R2-STORAGE.md).
- `NEXT_PUBLIC_SITE_URL` supplies permanent sharing and canonical URLs. Set the actual HTTPS origin before deployment. `NEXT_PUBLIC_*` values are embedded in client code at build time; changing them requires rebuilding.
- `NEXT_PUBLIC_MAP_STYLE_URL` can point to another MapLibre-compatible style or a self-hosted map. `NEXT_PUBLIC_MAP_ATTRIBUTION` adds attribution; it does not replace or remove the basemap's own attribution.
- `NEXT_PUBLIC_MAP_FONT` controls the application's cluster-count labels. Its default, `Noto Sans Regular`, matches the current OpenFreeMap style. When changing providers, verify that the glyph service supports this font, adjust it if needed, and rebuild. It does not change website fonts or the basemap's existing label fonts.
- `DATABASE_URL` and `MIGRATION_DATABASE_URL` are server-only. Never prefix them with `NEXT_PUBLIC_` or put them in URL query parameters.

## Optional Google sign-in

Create a dedicated **Google Cloud Web application OAuth client**, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `apps/nextjs/.env.local` or server-side deployment settings. Register `http://127.0.0.1:3000/api/auth/callback/google` for local development. The production callback is the actual HTTPS `BETTER_AUTH_URL` followed by `/api/auth/callback/google`. The browser origin must match the authentication origin; do not mix `localhost` and `127.0.0.1`.

Google is the only account sign-in; without it, guest submissions with private receipts remain fully available. Google requests only `openid email profile` with online access. Existing accounts are linked only when both email addresses match and both are verified. Sign-in does not automatically claim guest submissions or grant reviewer access.

**The recorded deployment has not configured a real Google OAuth client or completed live Google authorization/callback verification.** Implementation and mocked tests do not substitute for cloud acceptance testing. See [Google sign-in setup](docs/GOOGLE-AUTH.md) for console steps, the basic-sign-in Testing exception, and publication requirements. Do not share credentials in chat or commit them.

## Granting reviewer access

First sign in on the website with a Google account with a verified email, then **stop the local development server**. Configure the root `.env.local` with the same `ARCHIVE_DATA_MODE` and optional `SOUTHVIEW_DATA_DIR` as the website, then run:

```powershell
pnpm reviewer:grant --email reviewer@example.org --confirm
pnpm dev
```

The review page is `/admin/contributions`. Ordinary sign-in does not grant reviewer privileges; the CLI grants access only to verified accounts. Add `--revoke` to revoke access, or `--allow-production` when operating in production. Local PGlite permits only one process at a time: stop the server before database or reviewer CLI operations, then restart it. Do not share a PGlite directory across instances.

## Supabase database and R2 photos

Production deployments with multiple instances use `database` mode and private object storage while preserving the same data contracts and permanent person IDs. Local mode normally does not need separate migration or seed commands.

1. Obtain the actual connection string from the Supabase project's Connect panel. Do not guess hostnames or change only a port. The application's `DATABASE_URL` can use the transaction pooler; the standard `postgres` driver is configured with `prepare: false` for compatibility.
2. Set an explicit `MIGRATION_DATABASE_URL`. Prefer a reachable direct connection; otherwise use the session-pooler connection supplied by Supabase. Migration commands do not implicitly reuse the application connection or default to its transaction pooler.
3. Create a Git-ignored `.env` at the **repository root**, containing the required server-side values:

```dotenv
# Repository-root .env: replace each complete URI; these are placeholders.
ARCHIVE_DATA_MODE=database
DATABASE_URL=postgresql://USER:PASSWORD@APPLICATION_HOST:PORT/postgres
MIGRATION_DATABASE_URL=postgresql://USER:PASSWORD@MIGRATION_HOST:PORT/postgres
```

4. Run migrations, then seed the initial archive after confirming the target database:

```powershell
pnpm db:migrate
pnpm db:seed --confirm
```

Migrations in `packages/db/migrations` run in version order and record checksums. Re-running skips applied migrations; changing an applied SQL file produces an error. Migrations and seeding use transactions. Seed inserts use `ON CONFLICT DO NOTHING`: they add missing records without overwriting edits or deleting later contributions.

Seeding always requires `--confirm`, plus `--allow-production` when `NODE_ENV=production`. Scripts cannot infer that an arbitrary database URL is production, so use separate environments and credentials and confirm the target. Do not automatically seed during application startup in database mode, deployment builds, or normal CI.

5. Configure the application in **`apps/nextjs/.env.local`** or deployment settings, and create a **private** Cloudflare R2 bucket first. See [storage setup](docs/R2-STORAGE.md) for bucket and credential instructions:

```dotenv
ARCHIVE_DATA_MODE=database
DATABASE_URL=postgresql://USER:PASSWORD@POOLER_HOST:PORT/postgres
NEXT_PUBLIC_SITE_URL=https://archive.example.org
BETTER_AUTH_URL=https://archive.example.org
BETTER_AUTH_SECRET=REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_BYTES
GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET
PHOTO_STORAGE=s3
S3_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=south-view-archive
S3_ACCESS_KEY_ID=YOUR_R2_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=YOUR_R2_SECRET_ACCESS_KEY
S3_FORCE_PATH_STYLE=true
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/positron
NEXT_PUBLIC_MAP_FONT=Noto Sans Regular
```

Replace every placeholder with valid configuration. Production database mode requires private object storage and does not fall back to a local directory. Disable both the R2 `r2.dev` URL and public custom domains; the S3 API cannot verify these console settings. S3 mode uses direct uploads with five-minute signed URLs restricted to an object and file size, followed by server validation and processing. Authorized original-file downloads use one-minute URLs. Secret access keys remain server-side. Both originals and processed images are private; only approved, non-withdrawn processed images are available through the public application. Apply a one-day expiry only to temporary `staging/` objects, never to permanent archive files. Set `TRUST_PROXY=1` only when the reverse proxy replaces untrusted `X-Forwarded-For`; otherwise requests share a conservative rate-limit bucket.

With the same S3 settings in root `.env.local`, run `pnpm storage:check` to generate two tiny test images and verify writing, reading, and deletion, including cleanup. It does not open the database, publish a contribution, or verify public-access settings. When changing storage for existing photos, migrate originals and processed images with their keys preserved; environment changes do not copy files. Existing deployments can still explicitly choose `PHOTO_STORAGE=supabase`.

The application uses server-side Next, Drizzle, and Better Auth, not Supabase Auth or the browser Data API. `archive` holds public projections; `community` holds private contacts, submissions, authentication, and reviews. Do not expose the private schema to anonymous clients. **The runtime needs business read/write privileges** for accounts, sessions, submissions, reviews, and public projections; a read-only connection is insufficient. Migration credentials also need DDL privileges. Verify actual role grants against migration RLS policies.

Never prefix server secrets with `NEXT_PUBLIC_`. The authentication origin must match the standalone site. Without HTTPS, an authentication secret, and Google OAuth credentials, production account sign-in is unavailable while guest submissions continue to work.

## Structure and interfaces

| Directory             | Responsibility                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/nextjs`         | Public pages, maps, submissions, sign-in, review, and HTTP entry points.                        |
| `packages/validators` | Domain contracts and citation, submission, and review validation.                               |
| `packages/api`        | `archive.snapshot`, `search`, `person`, and `mapFeatures`, without authentication dependencies. |
| `packages/db`         | Data modes, persistence, migrations, private workflows, and public projections.                 |
| `packages/services`   | Better Auth (Google), private photos, upload tickets, AI vetting, and the reviewer CLI.         |
| `packages/ui`         | Reusable UI primitives.                                                                         |
| `tests`               | Data, transaction, authentication, storage, and HTTP authorization tests.                       |

Next server code can call `createCaller({}).archive.snapshot()` directly. Public tRPC routes use `/api/trpc`, community routes use `/api/community`, and authentication uses `/api/auth`. The small public application filters a shared public snapshot for lists, maps, and person pages. GeoJSON coordinates always use **`[longitude, latitude]`**.

Main routes:

- `/explore`: public map and accessible list.
- `/explore?scope=atlanta`: combined Atlanta and South-View view.
- `/people/john-lewis`: permanent, directly accessible, shareable person page.
- `/places/atlanta-city-hall`: a place in its own right: what it is, its position and evidence, and everyone connected to it. Map markers select places; the panel lists the connected people and leads here with **Dig deeper**.
- `/explore?embed=1`: simplified embedded view.
- `/people/[id]?edit=1`: in-page additions, paragraph edits, edits to existing places (name, position, description), new places marked on a map, and photographs for an existing person.
- `/contribute`: one short form for a memory, fact, or photograph about anyone, in the archive or not. `?person=` pre-selects a person; the navigation link passes it from person pages. Once a person is chosen the form offers their known places and hides the new-person fields.
- `/submissions/[id]#receipt=…`: private receipt, original submission, status, and supplements.
- `/sign-in`, `/my-contributions`: optional Google sign-in and owned submissions.
- `/admin/contributions`: separately authorized staff review. Signed-in reviewers also get a **Review desk** link in the navigation.
- `/contributions/[id]`: published contribution, sources, and provider attribution.
- `/about`: collection scope and reading guidance.

Receipt tokens live in the URL **fragment**, not query parameters sent with the initial page request. The client proves access through a private request header; the database stores only a hash. A token authorizes one submission and should be kept private. Claiming a guest submission later requires both the receipt and a signed-in, verified email matching the contact.

Public credit and private contact details are stored separately. Photos are decoded, validated, and stripped of EXIF; originals remain private. Only approved processed images are publicly accessible, and withdrawal revokes that access. Original submissions, contacts, and internal notes do not enter the public archive. Reviewers can request supplements, select photos, publish independent entries, or explicitly apply person/place changes. Personal memories remain attributed narratives.

People, places, person-place relationships, materials, sources, editorial issues, and predecessor-ID mappings are modeled separately. Evidence for a historical relationship is distinct from coordinate evidence. Records without coordinates remain readable. Grave markers are attributed reference positions, not surveyed navigation points. A shared surname or predecessor household record never triggers an automatic identity merge.

## Staff review desk and AI vetting

`/admin/contributions` provides a submission queue with title/person/ID search, status and content-type filters, real status counts, and a review workspace. Staff can compare the original, edit the public draft, inspect review history, request information, approve and publish, reject with a contributor-visible reason, or withdraw a published entry. Approval opens a public-content preview before the final publication action. In-page edits arrive with their placement already applied: a paragraph edit shows the paragraph as it was beside the contributor's version and, published to the biography, replaces that paragraph in place; an addition lands after the paragraph it was written under; a place marked on the map arrives with its position filled in for confirmation. If the paragraph changed since the edit was written, publication to the biography is refused and the reviewer can keep the edit as a community entry instead. Internal notes and private contact details remain staff-only. Selected records and filters survive refresh; unsaved edits receive a navigation prompt.

**Vet** uses GPT-6 Luna (`gpt-6-luna`), medium reasoning, and required web search through one awaited OpenAI Responses request. Reports contain individual claims, verdicts, explanations, evidence links, reviewer notes, follow-up questions, limitations, and attachment coverage. Personal memories are not treated as false just because online corroboration is unavailable. Reports are stored privately, survive restarts, and become stale when new original material is added. Duplicate starts are blocked and failed checks can be retried. Human review and publication work independently of Vet.

Set the server-only `OPENAI_API_KEY` in `apps/nextjs/.env.local` or the hosting platform to enable checks. Without it, the desk explicitly shows **Not configured**. Migration `0005_vet.sql` adds the private run history, using the existing PGlite/Supabase data modes and local/S3/R2 photo storage. Places carry an optional public description (`summary`, with citations) that reviewers edit in the map place panel and contributors can propose from a person page; `pnpm db:backfill-places` fills the fixture descriptions into a database seeded before the field existed (stop a local dev server first). Public archive and contributor-receipt APIs do not return AI reports. See [AI vetting configuration, privacy, recovery, and acceptance](docs/AI-VETTING.md). The full local suite passed 119 tests, all six workspace type checks and a production build; real OpenAI calls are intentionally deferred until the key is configured.

## Deployment and maintenance

[South-View Archive](https://south-view-archive.vercel.app/explore) was deployed from local source on 2026-10-07 using Supabase and R2. Guest submissions, photos, and private receipts were verified online. The recorded deployment still needs real Google sign-in configuration for staff web review. See [Vercel deployment](docs/VERCEL.md) for resources, settings, and redeployment instructions.

A source snapshot was published to the private [GitHub repository](https://github.com/zilongpa/south-view-archive) on 2026-10-19. This does not connect GitHub to Vercel or redeploy the site. Local credentials, runtime data, uploads, and validation screenshots are excluded. The completed review desk and Luna/web-search integration were deployed on the same date, with migration `0005_vet.sql` applied and public routes verified. Live staff sign-in and model checks still require the authentication and OpenAI configuration described in [the release record](docs/VERCEL.md).

Deploy to a standard Next.js Node environment with monorepo support. Install from the root workspace and lockfile, use `apps/nextjs` as the application directory, build with `pnpm build`, and run with `pnpm start` or the hosting adapter. This is not a static export or a Sites-specific project: HTML or `public/` alone is insufficient because authentication, database, and media endpoints need a server. The application does not automatically publish or provision cloud resources.

Before public operation, confirm text, coordinate precision, media conditions, domain, and the complete website iframe chain with South-View. Complete user accessibility trials, backup/restore exercises, storage monitoring, and a contact-retention policy. Because no email is sent, reviewers who request information should expect contributors to reply only when they revisit their receipt page. Live Google OAuth, staff publication, and complete website embedding still need verification.

As the collection grows, move search, pagination, and map-viewport queries closer to the database. Human review and original-submission retention remain the current workflow. AI assistance supports research and must not replace staff publication decisions; live model behavior still needs verification after configuration.

## Sources, data, and licensing

- [Source register and editorial decisions](docs/SOURCES.md): biographical facts, coordinate methods, oral histories, rights, and open questions.
- [Domain model and expansion rules](docs/DATA_MODEL.md): citations, relationships, identity matching, and coordinate precision.
- [Community data and review](docs/COMMUNITY-DATA.md): private contacts, receipts, states, attributed publication, and withdrawal.
- [Authentication and photos](docs/COMMUNITY-SERVICES.md): Google sign-in, reviewer grants, private storage, and runtime settings.
- [AI vetting](docs/AI-VETTING.md): Luna/web search, private reports, model configuration, and validation limits.
- [Google sign-in setup](docs/GOOGLE-AUTH.md): dedicated OAuth clients, callbacks, testing, and publication steps.
- [Cloudflare R2 and S3 storage](docs/R2-STORAGE.md): private buckets, credentials, connection checks, providers, and photo migration.
- [Website embedding](docs/EMBEDDING.md): iframe examples, allowed parent sites, permanent links, and acceptance checks.
- [Validation record and remaining limits](docs/VALIDATION.md): automated checks, browser observations, and outstanding production verification.
- [Starter and third-party notices](THIRD_PARTY_NOTICES.md): create-t3-turbo provenance and predecessor-project boundaries.
- [MIT code license](LICENSE). Historical photographs, source materials, and third-party datasets retain their own rights; the code license does not grant reproduction rights to those materials.

Upstream projects and references: [SVCMAP](https://github.com/taologan/SVCMAP), [South-View Grave Navigation](https://github.com/southviewgravenavigation-coder/South-View-Grave-Navigation), [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo), [Supabase Drizzle guide](https://supabase.com/docs/guides/database/drizzle), [Better Auth](https://better-auth.com/docs), [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/), and [OpenFreeMap](https://openfreemap.org/).
