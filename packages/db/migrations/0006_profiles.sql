-- Canonical rows are version >=1. Version zero remains legacy until the verified converter runs.
ALTER TABLE archive.persons ADD COLUMN version integer NOT NULL DEFAULT 0 CHECK (version >= 0);
ALTER TABLE archive.persons ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE archive.persons ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE archive.profile_legacy_links (id text PRIMARY KEY, person_id text NOT NULL REFERENCES archive.persons(id), anchor text);
CREATE TABLE community.profile_requests (
 request_id text PRIMARY KEY, receipt_hash text NOT NULL, user_id text, payload_hash text,
 revision_id text, person_id text REFERENCES archive.persons(id), version integer,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 CHECK ((person_id IS NULL) = (version IS NULL))
);
CREATE TABLE community.profile_revisions (
 id text PRIMARY KEY,request_id text NOT NULL UNIQUE REFERENCES community.profile_requests(request_id),person_id text REFERENCES archive.persons(id),base_version integer,
 proposal_version integer NOT NULL DEFAULT 1 CHECK(proposal_version>=1),profile jsonb NOT NULL,
 private_name text NOT NULL,email text NOT NULL,public_credit text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((person_id IS NULL)=(base_version IS NULL))
);
CREATE TABLE community.profile_versions (
 person_id text NOT NULL REFERENCES archive.persons(id),version integer NOT NULL CHECK(version>=1),profile jsonb NOT NULL,
 reviewer_id text,public_credit text NOT NULL,request_id text,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(person_id,version)
);
CREATE TABLE community.profile_media (
 id text PRIMARY KEY,request_id text NOT NULL REFERENCES community.profile_requests(request_id),object_key text NOT NULL UNIQUE,
 content_type text NOT NULL,bytes integer NOT NULL,original_name text NOT NULL,sha256 text NOT NULL,
 cleanup_claimed_at timestamptz,ready boolean NOT NULL DEFAULT false,state text NOT NULL DEFAULT 'active' CHECK(state IN('active','queued','deleting')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community.profile_media_refs (
 media_id text NOT NULL REFERENCES community.profile_media(id),revision_id text REFERENCES community.profile_revisions(id) ON DELETE CASCADE,
 person_id text,version integer,
 FOREIGN KEY(person_id,version) REFERENCES community.profile_versions(person_id,version),
 CHECK((revision_id IS NOT NULL AND person_id IS NULL AND version IS NULL) OR (revision_id IS NULL AND person_id IS NOT NULL AND version IS NOT NULL))
);
CREATE UNIQUE INDEX profile_media_pending_unique ON community.profile_media_refs(media_id,revision_id) WHERE revision_id IS NOT NULL;
CREATE UNIQUE INDEX profile_media_accepted_unique ON community.profile_media_refs(media_id,person_id,version) WHERE person_id IS NOT NULL;
CREATE TABLE community.profile_vet_runs (
 id text PRIMARY KEY,revision_id text NOT NULL REFERENCES community.profile_revisions(id) ON DELETE CASCADE,proposal_version integer NOT NULL,
 reviewer_id text NOT NULL,status text NOT NULL CHECK(status IN('running','completed','failed')),model text NOT NULL,prompt_version text NOT NULL,input_revision text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',completed_at timestamptz,
 report jsonb,attachments jsonb NOT NULL DEFAULT '[]',sources jsonb NOT NULL DEFAULT '[]',error text
);
CREATE UNIQUE INDEX profile_vet_one_running ON community.profile_vet_runs((true)) WHERE status='running';
ALTER TABLE community.profile_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.profile_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.profile_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.profile_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.profile_media_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.profile_vet_runs ENABLE ROW LEVEL SECURITY;
