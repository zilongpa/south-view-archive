# Person Profile Replacements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Track completion here and in progress.md.

**Goal:** Replace additive contribution workflows with complete sourced profile proposals, and make Stories search only published people.
**Architecture:** Canonical published JSONB profiles, pending complete proposals, immutable accepted history. Adapt the existing map/public archive shape through a projection; keep auth, reviewer permissions, local PGlite and cloud PostgreSQL.
**Tech Stack:** TypeScript, Zod, Drizzle, PostgreSQL/PGlite, Next 16 App Router, React, existing private storage and OpenAI integration.
**Spec:** `docs/superpowers/specs/2026-10-28-person-profile-revisions-design.md`

## Global Constraints

- No test flags, contributor drafts, autosave, saved rejected content or automatic publication.
- User clarification: Stories searches people profiles only, by name, metadata tags, connected place or free text; remove content-type/editor-selection filters.
- Full replacement includes locations and sources; stable person IDs; pending proposals do not change public pages.
- Server-side authorization, exact-version checks, transactional approval, safe media ownership and retryable cleanup.
- No production data mutation, credential inspection, deployment, unrelated file changes or secret commits.
- Existing Node >=22.21, pnpm 11.19; use installed `/opt/homebrew/opt/node@22/bin`.

## Shared interfaces (binding for all tasks)

Export new contracts from `@southview/validators`, implemented in `packages/validators/src/profiles.ts`:

- `ProfileSource`: `{id,title,kind:'link'|'attachment'|'memory',url?,mediaId?,creator?,rights?,locator?}`.
- `ProfileLocation`: `{id,name,label,description,scope:'cemetery'|'atlanta',address?,coordinates:[number,number]|null,precision:'reference'|'address'|'verified'|'unmapped',sourceIds:string[],coordinateSourceIds:string[],locationNote:string}`.
- `PersonProfile`: `{name,birthYear?,deathYear?,tags:string[],bodyMarkdown,bodySourceIds:string[],sources:ProfileSource[],portrait?:{url?:string,mediaId?:string,alt,credit,rights,sourceIds:string[]},locations:ProfileLocation[]}`.
- `PublishedProfile`: `{id,version,profile:PersonProfile,updatedAt:string}`.
- `ProfileProposal`: `{id,personId:string|null,baseVersion:number|null,proposalVersion:number,profile:PersonProfile,createdAt:string,publicCredit:string, ...private metadata allowed only to authorized reviewer/owner}`.
- `ProfileSubmission`: `{requestId,receiptToken,personId:string|null,baseVersion:number|null,profile,privateName,email,publicCredit,permission:true}`.
- `profileSchema`, `profileSubmissionSchema`; proposal/profile version >=1; IDs max120; text20k; sources/locations/tags50; stable source IDs; body/portrait/relationship/coordinate evidence references validated.

DB public module `@southview/db/profiles`:

- `readPublishedProfiles(store?:Store):Promise<PublishedProfile[]>`, `getPublishedProfile(id:string,store?:Store):Promise<PublishedProfile|null>`.
- `createProfileRepository(store:Store)` returns `submit(input:ProfileSubmission,actor:Actor)`, `list(actor:Actor)`, `get(id:string,actor:Actor)`, `save(id:string,profile:PersonProfile,proposalVersion:number,baseVersion:number|null,actor:Actor)`, `approve(id:string,proposalVersion:number,actor:Actor)`, `reject(id:string,proposalVersion:number,actor:Actor)`, `history(personId:string,actor:Actor)`, `restore(personId:string,version:number,currentVersion:number,actor:Actor)`.
- submit returns `{id,personId,status:'pending'|'published',version?:number}`; accepted retries resolve through publication request metadata. approve/restore return PublishedProfile. get returns proposal or authorized published receipt result.
- Provide media registration, authorization, cleanup and Vet persistence helpers in same module; coordinate exact signatures between DB and service implementers before callers are finalized.
- `convertArchiveProfiles(data:ArchiveData):PublishedProfile[]` and `projectProfilesToArchive(profiles:PublishedProfile[],legacy?:ArchiveData):ArchiveData` for deterministic migration/fixtures/map compatibility.

HTTP `/api/profiles/[...path]`:

- GET `published`: `{profiles:PublishedProfile[]}`.
- POST `submissions`: multipart `payload` ProfileSubmission JSON and `file:<mediaId>` file fields; returns submit result. Upload only when Submit clicked.
- GET `mine`, GET `review`: `{proposals:ProfileProposal[]}`.
- GET `submissions/:id`: `{proposal?:ProfileProposal,publication?:PublishedProfile}` with receipt header/session.
- PATCH `review/:id`: `{profile,proposalVersion,baseVersion}`; returns `{proposal}`.
- POST `review/:id/approve` or `/reject`: `{proposalVersion}`; approval returns `{publication}`; reject `{deleted:true}`.
- POST `review/:id/vet`: `{proposalVersion}`; GET `review/:id/vet` returns latest `{run}` or null. Stale reports explicitly identified.
- GET `media/:id`: public only for current published reference; authorized pending preview uses receipt/session; no object keys exposed.
- GET `history/:personId` and POST `history/:personId/restore`: `{version,currentVersion}` for staff.
- GET existing `/api/community/session` remains auth/session entry point. Old community write routes retired; legacy pending read/reject transition queue remains available to staff.

## Review Focus

- Existing profile deletion/removal must not resurrect legacy biography/source/location content in projections.
- Two submissions and two reviewers must not erase each other's changes; exact version/lock tests.
- Rejected/abandoned media cleanup must never delete files used by pending or accepted versions.
- Conversion must preserve attributed stories, approved media and linked materials without duplicate content on every read.
- Search results must contain only people and include matching full body/tag/name/location fields.

## Task 1: Canonical contracts, conversion and persistence

Owner: domain/database implementer. Files: new validators/profiles.ts, db/profiles.ts, forward migration 0006_profiles.sql, profile-conversion.ts, schema.ts, database.ts, package exports, domain/persistence tests.

- [x] Write failing schema/conversion tests and run them (missing exports expected).
- [x] Implement shared contracts, deterministic conversion and map projection; preserve IDs and credits.
- [x] Write failing repository tests: pending invisibility, new/existing approval, source validation, idempotency, reviewer/receipt authorization, stale base/proposal conflicts, rejection deletion, accepted restore.
- [x] Implement tables/repository, accepted history, cleanup/Vet helper contracts; run tests green.
- [x] Wire canonical reads without legacy resurrection; keep historical tables only for migration and transition.

## Task 2: HTTP, media and agentic review

Owner: service implementer. Files: new services/profile-service.ts, profile-vet.ts, route api/profiles/[...path]/route.ts, storage-contract/storage type updates, cleanup script, HTTP/service tests.

- [x] Write failing multipart upload/evidence, authorization and review endpoint tests.
- [x] Implement one-submit uploads, type/size/content checks, private/public media authorization, durable cleanup and abandoned upload expiry.
- [x] Implement endpoints against shared repository; preserve exact-version conflict behavior and idempotency.
- [x] Adapt existing model/provider to full profiles and evidence, reports stale on edits, PDFs supported with explicit coverage.
- [x] Run tests green and document cleanup scheduling; never send real model requests or email during tests.

## Task 3: Shared profile editor, preview and review UI

Owner: UI implementer. Files: new profile-editor/profile-view/profile-review/profile-receipt components, CSS, contribute/admin/submissions/my-contributions pages; UI interaction tests where meaningful.

- [x] Build shared safe Markdown/profile renderer, used in public and both previews.
- [x] Replace form with explicit person lookup/new-person selection; all fields editable; files stay in memory until Submit; Preview and Submit only.
- [x] Replace reviewer UI with full proposal, comparison, editable fields, save/Vet/approve/delete; display conflict reconciliation and report coverage.
- [x] Replace receipt/account pages with pending/accepted/deleted states; no drafts or supplements.
- [x] Read installed Next docs before writing Next code; typecheck and browser-check forms.

## Task 4: Public profiles, Stories, compatibility and integration

Owner: primary agent. Files: public person route/component, stories page/state, validators profile-search, API discovery, explorer detail renderer, legacy redirects, docs, integration tests.

- [x] Write failing people-only search tests: name/tags/locations/full body, combined filters, relevance/recent sorting and pagination.
- [x] Implement profile search and Stories UI, preserve supported URL search state and return links.
- [x] Render canonical public profile with shared view; map detail uses projection including full body; disable legacy write entry points and map legacy contribution URLs.
- [x] Integrate all tasks, verify migration twice/restart, cleanup and cold local run. Run all tests, typecheck and build; browser-check existing/new submissions and review/public views.
- [x] Independent code review, repair material findings with regression tests, deliver exact evidence and remaining deployment limits.

## Execution ledger

Baseline: 121 tests passed before changes; branch `codex/person-profile-revisions`. Existing user changes: next-env.d.ts, untracked south-view-production.env and approved design document. Work in current checkout on dedicated branch to keep IDE paths usable; no production configuration is read. Implementers own disjoint files; shared contracts above bind consumers, with changes communicated before edits. No commit/push/deploy until verification; never include the production env file.

Final verification (2026-10-28): all four tasks complete. 161/161 tests, six workspace type checks and production build pass. Independent review found and repairs covered edited upload retries, managed-media URL ownership/retention, legacy attachment access, public contributor credit and alternate citation references. Browser checks used an isolated data directory and port3100: selected-person full editor/preview; new-person submit/receipt without unload dialog; pending invisibility; staff approval/public credit; stale-base reconciliation; rejection returning404; mobile profile search without horizontal overflow. No production migration/deployment or live AI call performed.

User correction: map-coordinate issues are no longer copied into biographies. Provenance-scoped exact correction creates a new accepted version for already-converted current content, increments affected pending proposal versions, retains immutable originals and corrects history/restore presentation. Authored prose remains intact. Coordinate fields and notes remain available to map projection/editor only. Regression tests and browser display assertions pass.

Rulings: Retain historical SQL tables and legacy-only test helpers during conversion/transition as approved in the design. Keep local server3000 untouched; use optional SOUTHVIEW_NEXT_DIST_DIR to isolate verification output. Production credentials were never read. Hosting multipart limits and scheduled cleanup remain deployment configuration; live provider calls remain untested.
