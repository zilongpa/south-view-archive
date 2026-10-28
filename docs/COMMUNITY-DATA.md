# Profile submissions, persistence and review

A submission is the complete proposed replacement of a person's profile. There are no contributor drafts or autosave: text and selected files remain in page memory until Submit. Rejected proposals are deleted. Published profiles remain unchanged while a proposal awaits review.

## Submission

The browser explicitly selects an existing person or chooses a new one. Existing profiles load every current field, sources and location. Submit sends the full profile and selected files as multipart data to `/api/profiles/submissions`. Server validation enforces evidence references, file signatures/sizes and ownership. Retry IDs and hashed receipt tokens prevent duplicate proposals and duplicate accepted publications. Short-lived upload reservations contain no editable profile body and expire after abandoned attempts.

Guests access their proposal using the secret receipt in a URL fragment, presented through `X-Receipt-Token`; receipt secrets are not query parameters or database plaintext. Signed-in submissions belong to their account. Matching an entered email or signing in later does not automatically transfer a guest proposal to that account. Public credit is explicitly chosen and separate from private contact.

## Staff review

`/admin/contributions` requires server-side reviewer authorization independent of ordinary sign-in. Staff sees the proposed full page, comparison, editable fields and evidence. Saving reviewer edits increments the proposal version. Optional Vet uses the complete profile and available evidence, reports file coverage and is marked outdated after changes. Human review works without AI configuration.

Approval locks and verifies the exact proposal version and the person's base version. It atomically replaces the profile and its complete location/source lists, increments the public version, inserts accepted history/media references, and removes the pending revision. New-person approval creates the first public row. Repeating an accepted request returns the same publication. An outdated base cannot overwrite newer work: staff must explicitly reconcile it first. Two reviewers cannot silently overwrite each other's proposal edits.

History is staff-only. Restoring a previous accepted snapshot creates another numbered publication rather than decrementing the current version.

## Deletion and media

Reject deletes the pending row, private contact, request details when no cleanup dependency remains, and associated AI reports. It does not create a saved rejected record or rejection notification queue. Its receipt becomes unavailable. Files referenced elsewhere are retained; exclusively unused objects enter a durable cleanup queue. Deletion workers claim objects, retry storage failures and recover interrupted claims. Accepted-version files remain available to authorized history recovery even when removed from the current public page.

Only current accepted media references authorize public file downloads. Pending evidence requires the receipt, account ownership or reviewer session. Original object keys are never returned in the API. Image metadata is stripped; PDF evidence downloads use a sandbox policy and safe response headers. Evidence selected for publication becomes public, so reviewers must remove or redact private material before approving. Private contact fields are never used as source credit.

Schedule `pnpm --filter @southview/services cleanup-profiles` hourly, using root configuration matching the server. For local PGlite, stop the web server first to avoid the one-process database lock. See [media operations](profile-media-operations.md) for limits and hosting caveats.

## Legacy transition

Old community write endpoints return 410. The session endpoint remains active; controlled legacy photo URLs remain usable only while a current profile references them. Staff can read the old pending/needs-information queue and copy its content into a complete new proposal, or reject/delete it. Cleanup purges old unsubmitted drafts and rejected rows. Accepted old publications/media remain available for conversion/history and permanent link mapping until a later verified table-retirement migration.

All new contributor and staff editing uses `/api/profiles`. Person pages, map and Stories use current canonical profiles. Existing auth, reviewer grants, SMTP/local outbox, private storage and rate limits continue to support the application.
