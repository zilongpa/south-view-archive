# Profile media cleanup

Run `pnpm --filter @southview/services cleanup-profiles` hourly with the same archive database and private storage environment as the application. Configure the hosting scheduler separately; this repository command does not install a scheduler or read deployment credentials.

The worker expires unsubmitted upload reservations after 24 hours, claims unreferenced objects, deletes them from storage, and removes their metadata. It covers profile files and queued retired-workflow objects. Files referenced by pending proposals or any accepted version survive cleanup, including history-only files. Public downloads require a reference from the current accepted profile; authorized private previews use a receipt or session.

Storage deletion failures leave durable work for the next run; the command prints only `{deleted,failed}` counts and exits unsuccessfully if any deletion failed. A worker interrupted after claiming files has its claims reclaimed after ten minutes. Claims prevent new references from attaching during deletion; concurrent workers can share the cloud database safely. Storage deletion is idempotent.

Local PGlite allows one process to own its data directory. Stop the local development server before running this standalone command against that same local database, then restart the server. This constraint does not apply to a PostgreSQL deployment.

The multipart route enforces application limits in memory. The hosting proxy must also accept these body sizes: deployments with a smaller request-body ceiling (including a 4.5 MiB serverless ceiling) will reject larger requests before this handler. Configure a compatible hosting route/body limit before offering the full 50 MiB allowance; this change does not provision hosting or reintroduce pre-submit uploads.

Uploads happen only on Submit or an explicit staff save. Each request accepts ten new files, 10 MiB per file, 50 MiB total. Supported images are decoded, bounded and converted to metadata-free JPEG; PDF evidence is signature checked and served as a download with restrictive headers. PDF files cannot be portraits. Object keys stay private.

Vet uses the existing `gpt-6-luna` Responses provider, medium reasoning and required web search. It receives the complete public proposal, current profile for comparison, and selected native PDF/image bytes. It receives no contact fields or receipt secrets. The manifest records provided, unavailable and unsupported evidence; provided means bytes were supplied, not that the AI successfully read them. URL-only legacy images/documents are explicitly marked unsupported as file input, while safe external source links remain available for web research. Unreadable or scanned material must be reported as unreviewed. Reports are advisory and never publish content. Real provider/network behavior must be verified in a separately authorized deployment smoke check.
