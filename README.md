# South-View · A Living Archive

A sourced archive of people connected to South-View Cemetery and Atlanta, built with Next.js App Router, TypeScript, pnpm/Turbo, PostgreSQL/PGlite, and MapLibre.

Each person has one complete editable profile: name, optional life years, tags, a Markdown body, optional portrait, sources/evidence, and connected locations. Biographies, personal recollections, and community stories share that body with their attribution preserved. **Stories searches people profiles** by free text, name, tag, or connected place. The map reads the same current published profiles.

## Run locally

Requires **Node.js 22.21+** and **pnpm 11.19.x**. From this repository root:

```sh
pnpm install --frozen-lockfile
cp -n .env.example apps/nextjs/.env.local
pnpm dev
```

Open **http://127.0.0.1:3000/explore**. Use the same host for sign-in; do not mix `localhost` and `127.0.0.1`.

`ARCHIVE_DATA_MODE=local` creates a persistent local PGlite database, applies forward migrations, and imports the initial collection once. No external database, map key, or OpenAI key is required. OpenFreeMap needs internet access. `dev` and `build` prepare matching MapLibre worker assets automatically.

Private database files, development sign-in codes, and local attachments live under `.southview/`, ignored by Git. Development `MAIL_MODE=local` writes JSON messages to `.southview/outbox/` instead of sending email. Never serve that directory through `public/`. `SOUTHVIEW_DATA_DIR` overrides the private root.

## Editing and review

1. Open `/contribute`, search for a person, and explicitly select an existing profile or create a new person.
2. Edit the whole profile, including its sources and locations. Edit sources for the text once; enter a direct source link or upload for the portrait and each location. Link evidence or select image/PDF files. Nothing is saved or uploaded until Submit; closing or refreshing loses unfinished work.
3. Preview the proposed page, then submit. The current public page stays unchanged while staff reviews the proposal. Guest contributors receive a private receipt link; optional sign-in associates a submission with their account.
4. At `/admin/contributions`, staff compares the proposed page with the current profile, edits it if needed, optionally runs Vet, and approves or deletes it.
5. Approval replaces the full profile and saves an accepted version. Rejection deletes the pending proposal, private details and reports; unused files enter retryable cleanup. A deleted submission's receipt becomes unavailable.

There are no test-record flags, contributor drafts, autosave, supplements, or separate new story publication paths. A changed name keeps its existing person ID and URL. Two editors cannot silently overwrite each other's approved changes: stale proposals require explicit reconciliation with the latest published version. Staff can restore an accepted version as a new publication.

Text requires evidence; portraits require evidence, creator credit and rights information. Each location needs relationship evidence; mapped coordinates need their own evidence. Raw coordinates and coordinate-quality notes stay with map data rather than appearing in the biography or public profile preview. Firsthand recollections qualify as attributed evidence without pretending to be independent corroboration. Approved evidence uploads are public, so redact private information before publication.

## Staff access and optional AI review

Sign in first using a local email code or configured Google account. Ordinary sign-in does not grant reviewer privileges. **Stop the local server** before running the grant script, since local PGlite permits one process at a time:

```sh
pnpm reviewer:grant --email reviewer@example.org --confirm
pnpm dev
```

The CLI reads root `.env.local`/`.env`, rather than `apps/nextjs/.env.local`; configure the same data mode and optional data directory in both. Use `--revoke` to revoke access. Production operations also require the script's explicit production option.

Set server-only `OPENAI_API_KEY` to enable advisory review using the existing configured model and web research. Vet reviews the complete proposed profile and selected uploaded evidence; its report lists attachment coverage and becomes stale after edits. URL-only documents/images are explicitly listed as not supplied as file bytes. AI failures do not block staff review, and AI never publishes automatically. No live model request is made by tests. See [AI configuration](docs/AI-VETTING.md) and [profile media operations](docs/profile-media-operations.md).

Google sign-in remains optional. See [Google setup](docs/GOOGLE-AUTH.md); deployed email codes require SMTP. `pnpm start` runs production behavior, so use `pnpm dev` for local email-code demonstrations.

## Storage and cleanup

JPEG, PNG and WebP images and PDF evidence are supported. Portraits must be images. Images are decoded and stripped of metadata; PDF downloads use safe headers. Initial limits: 10 new files per submission, 10 MiB per file, 50 MiB total. Your hosting proxy may impose a smaller request limit; the new multipart route does not bypass that limit.

Schedule cleanup hourly with the same root configuration and storage credentials as the application:

```sh
pnpm --filter @southview/services cleanup-profiles
```

Stop the local server first when using the same PGlite directory. The worker retries failed file deletion, expires abandoned upload reservations after 24 hours, and removes discarded legacy drafts/rejections. Files referenced by another pending proposal or accepted version are retained. Read [operations and hosting limits](docs/profile-media-operations.md).

## Database and migration

The canonical data model uses:

- `archive.persons`: current profile JSONB and version, one published row per person.
- `community.profile_revisions`: pending complete replacement proposals only.
- `community.profile_versions`: accepted immutable snapshots and publication credit.
- Private request/receipt, media-reference, cleanup, and Vet records supporting those workflows.

[The domain model](docs/DATA_MODEL.md) and [submission persistence](docs/COMMUNITY-DATA.md) describe the implementation. Existing separate archive tables remain temporarily for conversion and legacy links, rather than being destructively dropped during rollout.

Migration `0006_profiles.sql` adds the new structures. On the first canonical read, version-zero legacy people are converted transactionally once. Existing biographies, stories, materials, sources and locations are folded into profiles. Later reads never merge old content back into accepted replacements. Exact coordinate-note fragments from the earlier converter are repaired with version checks while authored prose and immutable history remain preserved. Old contribution URLs redirect to their original primary person's page. Existing pending submissions remain in a private read-only staff transition queue to copy into a complete proposal or delete.

Local mode applies schema migrations automatically. For deployed PostgreSQL/Supabase, back up and validate a database copy first, configure the separate root migration connection, and apply the forward migration **before** running the new code:

```sh
pnpm db:migrate
```

`ARCHIVE_DATA_MODE=database` requires server-only `DATABASE_URL`; migration scripts separately require `MIGRATION_DATABASE_URL`. Neither credential belongs in browser variables or Git. Database mode never silently falls back to local data. Seeding is insert-only, requires `--confirm`, and should not run automatically in production. Hosting/deployment and production conversion are separate operator actions.

## Verification and project references

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`pnpm check` runs type checks, tests, and the production build. Tests use isolated stores/files and mocked external providers. The archive requires a Node server; it is not a static export.

- [Approved profile design](docs/superpowers/specs/2026-10-28-person-profile-revisions-design.md) and [implementation plan](docs/superpowers/plans/2026-10-28-person-profile-revisions.md)
- [Historical sources](docs/SOURCES.md), [R2 storage setup](docs/R2-STORAGE.md), [deployment notes](docs/VERCEL.md), [embedding](docs/EMBEDDING.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md) and [MIT code license](LICENSE). Source materials and historical photographs retain their original rights.
