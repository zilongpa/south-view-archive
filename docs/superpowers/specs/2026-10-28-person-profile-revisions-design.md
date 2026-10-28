# Person profiles and replacement submissions

Status: approved and implemented locally on 2026-10-28. See the implementation verification record; deployment remains separate.

## Intent and confirmed decisions

Replace the separate biography/contribution/material editing paths with one editable, sourced person profile. Every submission proposes the complete next public profile, including its connected locations.

User decisions:

- All records are real; no test-record field or enum.
- Stories searches person profiles only, using free text, name, tags, and connected places.
- Coordinate-quality notes and raw coordinates belong with map data, not the biography or public profile preview.
- Memories and community stories belong in the editable person body.
- No saved drafts or autosave. Unsubmitted work may be lost when a tab closes or reloads.
- Rejected proposals may be deleted instead of retained.
- Approval replaces the existing person's public profile, or creates a new person.
- Text and portrait require sources or supporting evidence; locations also carry evidence.
- Staff review remains the publication authority; agentic review assists review.

The choices labeled recommendations below are implementation defaults proposed by the author, not decisions already approved by the user.

## Source input clarification

The contributor and reviewer forms show body sources once, as editable source fields. Portraits and each connected location take a direct source link or evidence upload. Do not expose the full source registry as repeated checklists, require choosing source IDs, or require selecting the same location source again for coordinates. The form maintains those references internally. Existing evidence and attribution remain preserved. Location/precision notes remain internal map data and have no editable note field in this form.

## Contributor experience

1. Search by person name. Results include dates and portrait when present. Explicitly select a match or choose Create a new person; never merge solely by name.
2. Load the entire current profile and its version, or a blank profile for a new person.
3. Edit name, dates, tags, body, portrait, sources/evidence, and locations. Sources already attached to the profile remain present and editable.
4. Preview with the same renderer used by the public profile and reviewer preview.
5. Submit once; validation failures preserve the in-memory form and explain errors. Success creates a pending revision and a receipt. Closing before Submit creates no revision or person.

Recommendation: retain existing optional sign-in, guest receipt authorization, private contact, public credit preference, and permission confirmation. Keep these outside the public profile. No draft/supplement/needs-information workflow in the new editor. Reviewers can edit a proposal or reject it; contributors submit again if needed.

Form text and selected files stay in page memory until submission: no localStorage, IndexedDB, or server autosave. Warning on navigation when feasible is acceptable; reliable recovery after closing is explicitly out of scope.

## Profile payload

Use one validated PersonProfile contract shared by editing, preview, publication, discovery, map, and rendering:

- `id`: stable server-assigned person ID, unchanged by renaming or replacement.
- `name`: required display name. Recommendation: use one field rather than mandatory first/last parsing; it handles initials, suffixes, and multi-part names.
- `birthYear`, `deathYear`: optional integers; omitted means unknown; reject reversed known dates.
- `tags`: unique trimmed strings; replaces UI terminology themes while preserving existing values.
- `bodyMarkdown`: required freeform text, supporting headings, paragraphs, lists, and citation markers referring to stable profile source IDs. No required biography/story block structure.
- `portrait`: optional media reference, alt text, source IDs, creator credit, and rights/permission description. No invented placeholder portrait.
- `sources`: profile-owned evidence entries with stable ID, title/description, optional creator/date/page locator, and either an external HTTP(S) URL, an approved evidence attachment, or an attributed firsthand account.
- `locations`: complete replacement list of profile-owned locations, each with stable ID, name, relationship label/description, optional address, cemetery/Atlanta scope, optional coordinates, position precision, relationship source IDs, and coordinate source IDs.

Recommendation: embed sources and locations inside the profile JSONB rather than require separate public source/place/relationship rows for new profiles. A location describes this person's connection; editing it cannot silently change other people's profiles. This deliberately gives up a shared canonical place editor. Migration preserves old place IDs as optional legacy references; map marker IDs use person ID plus location ID. Co-located markers cluster normally; no identity matching by coordinates.

Sources remain distinct for body, portrait, relationship, and coordinates. A general body source list is sufficient; inline citations are available but not mandatory for every sentence. Require at least one body source; require portrait sources when a portrait exists and relationship evidence for each location. Coordinates need coordinate evidence and valid precision; a location may remain unmapped. Validate all source references and reject deleting a source still cited by the payload.

Firsthand memory can be a source: preserve its public author credit, mark it as a recollection in the body, and do not imply independent corroboration. Existing author/creator credits must survive migration. Private contact names are never a fallback public credit. Recommendation: published source uploads are public evidence; contact information stays in separate private fields. Clearly disclose that evidence selected for publication will be public. Reviewers can replace a sensitive file with a redacted copy before approving.

Render sanitized Markdown with raw HTML disabled and safe link handling. Do not execute embedded scripts or HTML from submissions. Arbitrary image embeds are disallowed; portrait and evidence links use controlled media references. Preserve existing inline story photos as approved attachment links in the migrated body so migration does not discard them.

## Database design

Retain PostgreSQL/Drizzle and local PGlite. No Supabase API client or hosting change is necessary.

1. `archive.persons`: `id` primary key, `version` integer, `data` JSONB PersonProfile, created/updated timestamps. Contains only current published profiles. There is no publication-status or test-record column.
2. `community.profile_revisions`: revision ID, nullable target person ID, nullable base version, proposed profile JSONB, proposal version integer, private submitter reference/contact, receipt hash, unique submission request ID, timestamps. Every row is pending: no draft/rejected/published enum. A new-person proposal has no public person row yet.
3. `community.profile_versions`: immutable accepted snapshot keyed by person ID and version; publication time, reviewer, public author credit, and applicable review metadata. Published snapshots only, enabling recovery without retaining rejected proposals. Contacts remain private. Initial profiles become version 1.
4. Media metadata/references: adapt existing photo/storage tables for portraits and evidence files, plus ownership/reference links for pending proposals and accepted versions. Authorization is derived from those references, not guessable object keys.
5. Adapt existing private vet runs/reviewer authorization rather than create parallel systems. Vet runs belong to a pending revision and exact proposal version/hash; rejected revision deletion cascades associated reports and private proposal details.

Accepted proposals are moved into published version history and removed from the pending queue transactionally. Keep an accepted request/receipt mapping in publication metadata so retried submits and receipts resolve to the publication without duplicating it. A receipt for a deleted rejection reports that the submission is no longer available; persistent rejection reasons and rejection history are out of scope. Do not retain rejected content in application logs or durable notification payloads. Routine infrastructure backups expire according to their existing retention, not immediate purge.

## Submission and file lifecycle

Recommendation: JPEG/PNG/WebP portraits; JPEG/PNG/WebP/PDF evidence. No audio/video or office documents initially. Reuse configured private local/S3 storage. Initial limits: 20,000 body characters, 50 tags, 50 sources, 50 locations, 10 new files, 10 MiB per file, and 50 MiB total per submission; all are author choices and adjustable.

On Submit, validate the payload, reserve a short-lived submission request, upload/validate selected files, and atomically create the pending revision and its media references. This technical upload reservation is not a content draft and stores no editable person body. Check file signatures, image decoding and dimensions, enforce limits, and keep files private until publication. Strip image metadata. PDFs are evidence downloads with safe headers and never executed as page content. Existing published assets can be referenced without reuploading; validate that the references are accessible and authorized.

Failed or abandoned submission uploads expire. Retrying the same request ID with the same receipt and payload returns the existing result; mismatched reuse is rejected. An accepted request remains idempotent through its publication mapping. No promise of deduplication after a rejected request is permanently deleted.

Object storage cannot participate in a database transaction. Publication only references already validated durable objects. Rejection immediately removes authorized access and deletes the revision/report/contact links, then uses a durable cleanup queue for unreferenced object deletion. Cleanup retries after storage failures; delete only when neither another pending revision nor a published version references the file. Expire upload reservations and orphan files using a scheduled cleanup command/job, provided for local operation and hosting deployment.

## Reviewer experience and agentic review

Pending queue shows person name, new/existing person, submitter public credit, and submission time. Selecting a proposal opens the full proposed public profile. A secondary comparison shows name/metadata changes, body diff, portrait changes, added/removed locations and sources.

Reviewers may edit the proposal, run Vet, approve, or reject. Reviewer changes are explicit saves to an already-submitted proposal; this does not introduce contributor drafts. Use proposal-version checks on edits and review actions so two reviewers cannot silently overwrite each other.

Vet checks the complete proposal with emphasis on changed claims, supporting citations, identity, dates, portrait attribution, and relationship/coordinate evidence. Retain the current configured model/provider; no model migration is part of this work. Send only the evidence selected for review, not private contacts or receipt secrets. Show which files were actually read. Add a supported PDF extraction/input path; unreadable/scanned/unsupported evidence is reported as unreviewed rather than silently treated as verified. Reports become stale on any profile/evidence edit. Publication records the exact approved payload, regardless of what the AI suggested; unavailable AI does not block human review.

Recommendation: accept optional rejection feedback for the immediate reviewer action, but do not persist it after deletion. No durable rejected-status receipt, rejection email queue, or rejected-content archive.

## Atomic publication and stale edits

For an existing person:

1. Authorize reviewer; lock pending revision and current person in a transaction.
2. Verify submitted base version equals current person version and reviewer proposal version matches.
3. Validate complete payload and file/source references. Increment the person's version.
4. Replace the person's data and insert its accepted version snapshot, publication metadata, and media authorizations.
5. Remove pending revision and its temporary review rows; commit. Refresh affected public caches/search/map data.

For a new person, perform the same operation with a new person ID and version 1. Warn on likely duplicates before publication but require explicit identity selection; do not merge by name. Concurrent duplicate-person approval is still a reviewer responsibility, not something unique-name constraints can safely solve.

If a base version is stale, do not publish. Show the newest current profile alongside the proposal; the reviewer explicitly reconciles changes and confirms the new base version. Clear stale Vet results. No automatic merge or blind overwrite.

Removing a location or portrait from a replacement removes it from the current page/map. Referenced files may stay private in accepted history. Restoring an older published snapshot creates a new numbered version through reviewer authorization; never decrement versions or silently change later edits.

## Existing routes and content migration

1. Inventory actual local/production data, pending submissions, references and attachment ownership before conversion; do not assume checked-in fixtures match deployed content. Back up before deployment. Never inspect or print secret values as part of the inventory.
2. Add a new forward migration; do not modify old applied SQL migrations. Build a deterministic converter usable for fixtures, local PGlite and cloud data. Preserve permanent person IDs.
3. For each person, combine summary and biography in order with stable citations. Append published memories/stories under headings with their public author credit. Convert linked archival materials to cited body links. Preserve portraits, approved photos, existing source metadata, locations and coordinate evidence. Multi-person stories are included in each associated person's initial body; they become independently editable thereafter. Preserve content without semantic deduplication in the first conversion.
4. Rejected legacy submissions are deleted with safe media cleanup. Existing unsubmitted legacy drafts are discarded under the new no-draft policy. Legacy pending/needs-information submissions remain temporarily in a private read-only transition queue: staff copies relevant content into a complete new profile proposal or rejects/deletes it. Never silently publish or drop submitted pending material.
5. Replace profile editor and review/publish paths together. Person pages, map panels, search and discovery all read current profile JSON. Preserve cemetery/Atlanta scope and coordinate precision behavior. Search includes the full body, tags and location text.
6. Keep `/stories` as a search entry point over current person bodies, returning person pages/body anchors rather than creating new independent story records. Redirect legacy contribution URLs to the associated person/section, preserve legacy material URLs where applicable, and maintain old source anchors using stored mappings. Legacy multi-person contribution links choose their original primary person. Profile edits can remove an old section; its redirect still lands on the person page.
7. Update seeds, fixtures, receipt/account pages, documentation, and tests. Retire active supplementary, standalone contribution, selected-biography-apply and contribution-withdrawal paths. Correcting/removing accepted content uses another replacement or accepted-version restore, not rollback of an individual old contribution.
8. Verify conversion and references before switching reads. Drop obsolete public content tables and legacy community workflow tables only in a later forward migration after transition queue resolution and route mapping verification. Retain reviewer/auth/rate-limit/storage infrastructure as needed.

Migration must be restartable and deterministic, preserve credits and sources, and stop on unresolved references. Existing deployment credentials and schema remain untouched during planning. Production conversion/deployment is a separate explicit operation.

## Implementation order

1. Finalize PersonProfile contract, media/source rules, fixtures converter and migration checks.
2. Implement pending revisions, accepted history, submission idempotency, media cleanup, transaction/version conflict rules, and server authorization.
3. Build one shared profile renderer and editor; wire the contributor name lookup and single-submit flow.
4. Replace reviewer workspace and adapt Vet to complete profiles and evidence uploads.
5. Switch person pages/map/discovery and legacy redirects; run conversion on a copied dataset before deployment.
6. Verify the local end-to-end flow; document migration, cleanup scheduling and rollback procedure before production cutover.

## Acceptance checks

- Closing/reloading an unsubmitted editor leaves no revision or person in the database.
- Submit existing person leaves its published page unchanged until approval; submit new person creates no public record yet.
- Submitted content includes all fields, citations, portrait and complete location list.
- One approval produces exactly one accepted version; a repeated request produces no duplicate publication.
- Concurrent reviewer changes and stale person base versions fail visibly without overwriting work.
- Replacing a profile removes omitted body sections/locations from all current public views.
- Reject deletes the proposal, report and private proposal data; exclusive files are cleaned up, shared/accepted files survive.
- Unauthorized users cannot read pending content or files, approve proposals, or retrieve unapproved evidence.
- Body, portrait and location evidence rules and safe Markdown rendering are enforced server-side.
- Approved history can be restored as a new version; AI failures/stale reports never mutate the public profile.
- Migration preserves person URLs, credits, source references, story text, approved media, and map semantics; legacy URLs resolve.
- Tests exercise transaction rollback, cleanup retries, published-media retention, source validation and snapshot conflicts. Run repository type checks, relevant tests and production build, followed by browser verification of new/existing-person flows.

## Deliberately excluded

Test/demo record flags, contributor drafts/autosave, independent new story publication, automatic AI publication, automatic name merging, real-time collaborative editing, generalized shared-place administration, audio/video uploads, saved rejected revisions, and replacing the database/provider stack.
