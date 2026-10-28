'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  profileSchema,
  type PersonProfile,
  type ProfileProposal,
  type PublishedProfile,
  type SubmissionRecord,
  type VetRun,
} from '@southview/validators';
import {
  communityRequest,
  CommunityRequestError,
  type CommunitySession,
} from '../lib/community-client';
import { profileMultipart, profileRequest, useProfileMedia } from '../lib/profile-client';
import { safeProfileHref } from '../lib/profile-markdown';
import { CommunityNotice } from './community-shell';
import { ProfileFields } from './profile-editor';
import { ProfileView } from './profile-view';
import './profile.css';

type ProfileRun = VetRun & { proposalVersion?: number };
function VetReport({
  run,
  dirty,
  proposalVersion,
}: {
  run: ProfileRun | null;
  dirty: boolean;
  proposalVersion: number;
}) {
  if (!run)
    return (
      <p>
        No AI report for this proposal. Review the profile and its evidence manually, or run Vet.
      </p>
    );
  const stale =
    dirty ||
    run.outdated ||
    (run.proposalVersion !== undefined && run.proposalVersion !== proposalVersion);
  return (
    <div className="profile-vet">
      <p>
        <strong>{stale ? 'Outdated report' : `AI check ${run.status}`}</strong> · {run.model} ·{' '}
        {new Date(run.startedAt).toLocaleString()}
      </p>
      {stale && (
        <CommunityNotice>
          The profile changed after this report. Save the proposal and run Vet again.
        </CommunityNotice>
      )}
      {run.error && <CommunityNotice kind="error">{run.error}</CommunityNotice>}
      <h3>Evidence coverage</h3>
      {run.attachments.length ? (
        <ul>
          {run.attachments.map((file) => (
            <li key={file.id}>
              {file.label}: <strong>{file.status}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p>No uploaded attachments were provided to the model.</p>
      )}
      {run.report && (
        <>
          <p>{run.report.summary}</p>
          {run.report.spam_flag && (
            <CommunityNotice kind="error">
              The check flagged possible spam. A reviewer must assess this flag.
            </CommunityNotice>
          )}
          <div className="profile-vet-claims">
            {run.report.claims.map((claim, index) => (
              <article key={index}>
                <h4>{claim.claim_text}</h4>
                <p>
                  <strong>{claim.verdict}</strong> — {claim.explanation}
                </p>
                {claim.reviewer_note && <p>{claim.reviewer_note}</p>}
                <ul>
                  {claim.evidence.map((evidence, i) => (
                    <li key={i}>
                      {safeProfileHref(evidence.url ?? undefined) ? (
                        <a
                          href={safeProfileHref(evidence.url ?? undefined)}
                          rel="noopener noreferrer"
                        >
                          {evidence.title}
                        </a>
                      ) : (
                        evidence.title
                      )}{' '}
                      ({evidence.source_type}) — {evidence.relevance}
                      {evidence.submission_ref && `; ${evidence.submission_ref}`}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          {run.report.follow_up_questions.length > 0 && (
            <>
              <h3>Questions to resolve during review</h3>
              <ul>
                {run.report.follow_up_questions.map((question, i) => (
                  <li key={i}>{question}</li>
                ))}
              </ul>
            </>
          )}
          {run.report.limitations.length > 0 && (
            <>
              <h3>Limitations</h3>
              <ul>
                {run.report.limitations.map((limitation, i) => (
                  <li key={i}>{limitation}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {run.sources.length > 0 && (
        <>
          <h3>Retrieved sources</h3>
          <ul>
            {run.sources.map((source, i) => (
              <li key={i}>
                {safeProfileHref(source.url) ? (
                  <a href={safeProfileHref(source.url)} rel="noopener noreferrer">
                    {source.title}
                  </a>
                ) : (
                  source.title
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="community-hint">
        AI reports assist review. They do not approve, edit or publish a profile, and unread
        evidence is not corroboration.
      </p>
    </div>
  );
}
function ReviewProposal({
  proposal,
  published,
  onUpdate,
  onRemove,
  onPublication,
  onDirtyChange,
}: {
  proposal: ProfileProposal;
  published: PublishedProfile[];
  onUpdate: (proposal: ProfileProposal) => void;
  onRemove: (id: string) => void;
  onPublication: (profile: PublishedProfile) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [profile, setProfile] = useState<PersonProfile>(() => structuredClone(proposal.profile));
  const [files, setFiles] = useState<Record<string, File>>({});
  const [baseVersion, setBaseVersion] = useState(proposal.baseVersion);
  const [proposalVersion, setProposalVersion] = useState(proposal.proposalVersion);
  const [mode, setMode] = useState<'preview' | 'edit' | 'compare'>('preview');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [run, setRun] = useState<ProfileRun | null>(null);
  const [conflict, setConflict] = useState<ProfileProposal | null>(null);
  const [latest, setLatest] = useState<PublishedProfile | null>(null);
  const [history, setHistory] = useState<PublishedProfile[] | null>(null);
  const current = latest ?? published.find((item) => item.id === proposal.personId) ?? null;
  const dirty =
    JSON.stringify(profile) !== JSON.stringify(proposal.profile) ||
    baseVersion !== proposal.baseVersion ||
    Object.keys(files).length > 0;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const stale = !!current && current.version !== baseVersion;
  const mediaUrls = useProfileMedia(profile, files);
  useEffect(() => {
    void profileRequest<{ run: ProfileRun | null }>(`review/${encodeURIComponent(proposal.id)}/vet`)
      .then((data) => setRun(data.run))
      .catch(() => {});
  }, [proposal.id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function reconcile(failure: unknown) {
    setError(failure instanceof Error ? failure.message : 'The review action failed.');
    if (failure instanceof CommunityRequestError && failure.status === 409) {
      const [list, publications] = await Promise.all([
        profileRequest<{ proposals: ProfileProposal[] }>('review'),
        profileRequest<{ profiles: PublishedProfile[] }>('published'),
      ]);
      setConflict(list.proposals.find((item) => item.id === proposal.id) ?? null);
      setLatest(publications.profiles.find((item) => item.id === proposal.personId) ?? null);
      if (!list.proposals.some((item) => item.id === proposal.id)) {
        setError('This proposal is no longer pending. Refresh the queue to see its current state.');
      }
      setMode('compare');
    }
  }
  async function save() {
    setError('');
    setNotice('');
    const valid = profileSchema.safeParse(profile);
    if (!valid.success) {
      setError(
        valid.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      );
      return;
    }
    setBusy('save');
    try {
      const result = await profileRequest<{ proposal: ProfileProposal }>(
        `review/${encodeURIComponent(proposal.id)}`,
        {
          method: 'PATCH',
          body: profileMultipart(
            { profile: valid.data, proposalVersion, baseVersion },
            files,
            profile,
          ),
        },
      );
      onUpdate(result.proposal);
      setProfile(result.proposal.profile);
      setProposalVersion(result.proposal.proposalVersion);
      setBaseVersion(result.proposal.baseVersion);
      setFiles({});
      setConflict(null);
      setNotice('Proposal saved. The public profile has not changed.');
      if (run) setRun({ ...run, outdated: true });
    } catch (failure) {
      await reconcile(failure);
    } finally {
      setBusy('');
    }
  }
  async function action(kind: 'approve' | 'reject' | 'vet') {
    if (
      kind === 'reject' &&
      !window.confirm(
        'Delete this pending proposal and its private review information? This cannot be undone.',
      )
    )
      return;
    if (
      kind === 'approve' &&
      !window.confirm(
        'Publish this complete profile? It replaces the current profile and its locations.',
      )
    )
      return;
    setError('');
    setNotice('');
    setBusy(kind);
    try {
      const result = await profileRequest<{ publication?: PublishedProfile; run?: ProfileRun }>(
        `review/${encodeURIComponent(proposal.id)}/${kind}`,
        { method: 'POST', body: JSON.stringify({ proposalVersion }) },
      );
      if (kind === 'vet') {
        setRun(result.run ?? null);
        setNotice('AI check completed. Review the evidence coverage and limitations.');
      } else {
        if (result.publication) onPublication(result.publication);
        onRemove(proposal.id);
      }
    } catch (failure) {
      await reconcile(failure);
    } finally {
      setBusy('');
    }
  }
  async function loadHistory() {
    if (!proposal.personId) return;
    setBusy('history');
    try {
      setHistory(
        (
          await profileRequest<{ versions: PublishedProfile[] }>(
            `history/${encodeURIComponent(proposal.personId)}`,
          )
        ).versions,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'History could not be loaded.');
    } finally {
      setBusy('');
    }
  }
  async function restore(version: number) {
    if (
      !current ||
      !window.confirm(
        `Publish accepted version ${version} as a new version? The pending proposal will then need reconciliation.`,
      )
    )
      return;
    setBusy('restore');
    try {
      const result = await profileRequest<{ publication: PublishedProfile }>(
        `history/${encodeURIComponent(current.id)}/restore`,
        { method: 'POST', body: JSON.stringify({ version, currentVersion: current.version }) },
      );
      setLatest(result.publication);
      onPublication(result.publication);
      setNotice(
        `Version ${version} restored as version ${result.publication.version}. Reconcile this pending proposal before approval.`,
      );
      setHistory(null);
    } catch (failure) {
      await reconcile(failure);
    } finally {
      setBusy('');
    }
  }
  const changed = (
    [
      'name',
      'aliases',
      'birthYear',
      'deathYear',
      'tags',
      'bodyMarkdown',
      'bodySourceIds',
      'portrait',
      'sources',
      'locations',
    ] as const
  ).filter((key) => JSON.stringify(current?.profile[key]) !== JSON.stringify(profile[key]));
  return (
    <div className="profile-review-detail">
      <header className="profile-review-heading">
        <h2>{profile.name}</h2>
        <p>
          Proposal version {proposalVersion} ·{' '}
          {proposal.personId ? `Based on published version ${baseVersion}` : 'New person'} ·
          Submitted {new Date(proposal.createdAt).toLocaleDateString()}
        </p>
        <p>Public credit: {proposal.publicCredit}</p>
        {(proposal.privateName || proposal.email) && (
          <details>
            <summary>Private contact</summary>
            <p>
              {proposal.privateName} · {proposal.email}
            </p>
          </details>
        )}
      </header>
      {error && (
        <CommunityNotice kind="error">
          <p className="profile-error">{error}</p>
        </CommunityNotice>
      )}
      {notice && <CommunityNotice kind="success">{notice}</CommunityNotice>}
      {!proposal.personId &&
        published.some(
          (item) => item.profile.name.toLowerCase() === profile.name.toLowerCase(),
        ) && (
          <CommunityNotice title="Possible duplicate person">
            A published person has this name. Verify identity before approving. This proposal will
            create a separate person.
          </CommunityNotice>
        )}
      {(stale || conflict) && (
        <div className="profile-conflict">
          <h3>Reconcile before publishing</h3>
          <p>
            {stale
              ? `The published person is now version ${current!.version}. Compare the complete profiles, reconcile every field, then confirm the new base version.`
              : 'Another reviewer saved this proposal. Compare their latest changes with your local work.'}
          </p>
          {conflict && (
            <details>
              <summary>Newest saved proposal, version {conflict.proposalVersion}</summary>
              <ProfileView
                profile={conflict.profile}
                anchorPrefix="conflict-"
                publicCredit={conflict.publicCredit}
              />
            </details>
          )}
          <div className="community-actions">
            {conflict && (
              <button
                type="button"
                className="community-secondary"
                onClick={() => {
                  setProfile(structuredClone(conflict.profile));
                  setProposalVersion(conflict.proposalVersion);
                  setBaseVersion(conflict.baseVersion);
                  setFiles({});
                  onUpdate(conflict);
                  setConflict(null);
                  setError('');
                }}
              >
                Load newest proposal
              </button>
            )}
            <button
              type="button"
              className="community-secondary"
              onClick={() => {
                if (conflict) {
                  setProposalVersion(conflict.proposalVersion);
                  onUpdate(conflict);
                }
                if (current) setBaseVersion(current.version);
                setConflict(null);
                setError('');
                setNotice(
                  'Reconciliation confirmed. Save your complete profile before publishing.',
                );
              }}
            >
              I reconciled all fields; keep my edits against the newest versions
            </button>
          </div>
        </div>
      )}
      <div className="profile-tabs" aria-label="Review view">
        {(['preview', 'edit', 'compare'] as const).map((tab) => (
          <button type="button" aria-pressed={mode === tab} key={tab} onClick={() => setMode(tab)}>
            {tab === 'preview'
              ? 'Proposed profile'
              : tab === 'edit'
                ? 'Edit complete profile'
                : 'Compare with published'}
          </button>
        ))}
      </div>
      {mode === 'edit' ? (
        <ProfileFields
          profile={profile}
          onChange={setProfile}
          files={files}
          onFilesChange={setFiles}
        />
      ) : mode === 'compare' ? (
        <>
          <p className="community-hint">
            Changed fields: {changed.join(', ') || 'none'}. Omitted content and locations will be
            removed on approval.
          </p>
          <div className="profile-compare">
            <section>
              <h3>Current published profile{current ? ` · version ${current.version}` : ''}</h3>
              {current ? (
                <ProfileView
                  profile={current.profile}
                  personId={current.id}
                  anchorPrefix="published-"
                  publicCredit={current.publicCredit}
                />
              ) : (
                <p>No published profile yet.</p>
              )}
            </section>
            <section>
              <h3>Complete proposed profile</h3>
              <ProfileView
                profile={profile}
                mediaUrls={mediaUrls}
                anchorPrefix="proposed-"
                publicCredit={proposal.publicCredit}
              />
            </section>
          </div>
        </>
      ) : (
        <ProfileView
          profile={profile}
          mediaUrls={mediaUrls}
          anchorPrefix="proposed-"
          publicCredit={proposal.publicCredit}
        />
      )}
      <div className="profile-review-actions">
        <p>
          {dirty
            ? 'Unsaved review edits. Save before running Vet or approving.'
            : 'All review edits saved.'}
        </p>
        <div className="community-actions">
          <button
            type="button"
            className="community-secondary"
            disabled={!!busy || !dirty || !!conflict || stale}
            onClick={() => void save()}
          >
            {busy === 'save' ? 'Saving…' : 'Save proposal changes'}
          </button>
          <button
            type="button"
            className="community-secondary"
            disabled={!!busy || dirty || !!conflict}
            onClick={() => void action('vet')}
          >
            {busy === 'vet' ? 'Running Vet…' : 'Run AI check (Vet)'}
          </button>
          <button
            type="button"
            className="community-primary"
            disabled={!!busy || dirty || stale || !!conflict}
            onClick={() => void action('approve')}
          >
            {busy === 'approve' ? 'Publishing…' : 'Approve and publish profile'}
          </button>
          <button
            type="button"
            className="community-danger"
            disabled={!!busy}
            onClick={() => void action('reject')}
          >
            {busy === 'reject' ? 'Deleting…' : 'Delete proposal'}
          </button>
        </div>
      </div>
      <section className="community-section">
        <h2>AI review report</h2>
        <VetReport run={run} dirty={dirty} proposalVersion={proposalVersion} />
        {run?.status === 'running' && (
          <button
            type="button"
            className="community-secondary"
            onClick={() =>
              void profileRequest<{ run: ProfileRun | null }>(
                `review/${encodeURIComponent(proposal.id)}/vet`,
              )
                .then((data) => setRun(data.run))
                .catch((failure) => setError(failure.message))
            }
          >
            Refresh AI check
          </button>
        )}
      </section>
      {proposal.personId && (
        <section className="community-section">
          <h2>Accepted version history</h2>
          <p className="community-section-note">
            Restoring an accepted snapshot publishes a new numbered version. It does not discard
            this pending proposal.
          </p>
          <button
            type="button"
            disabled={!!busy}
            className="community-secondary"
            onClick={() => void loadHistory()}
          >
            Load accepted versions
          </button>
          {history?.map((version) => (
            <details className="profile-history" key={version.version}>
              <summary>
                Version {version.version} · {new Date(version.updatedAt).toLocaleString()}
              </summary>
              <ProfileView
                profile={version.profile}
                anchorPrefix={`history-${version.version}-`}
                publicCredit={version.publicCredit}
              />
              <button
                type="button"
                disabled={!!busy || version.version === current?.version}
                className="community-secondary"
                onClick={() => void restore(version.version)}
              >
                Restore this accepted profile as a new version
              </button>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
function AcceptedProfileHistory({
  published,
  onPublication,
}: {
  published: PublishedProfile[];
  onPublication: (profile: PublishedProfile) => void;
}) {
  const [personId, setPersonId] = useState('');
  const [versions, setVersions] = useState<PublishedProfile[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const current = published.find((item) => item.id === personId);
  async function load() {
    if (!personId) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      setVersions(
        (
          await profileRequest<{ versions: PublishedProfile[] }>(
            `history/${encodeURIComponent(personId)}`,
          )
        ).versions,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Accepted history could not be loaded.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function restore(version: number) {
    if (
      !current ||
      !window.confirm(
        `Publish accepted version ${version} of ${current.profile.name} as a new numbered version?`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const { publication } = await profileRequest<{ publication: PublishedProfile }>(
        `history/${encodeURIComponent(current.id)}/restore`,
        { method: 'POST', body: JSON.stringify({ version, currentVersion: current.version }) },
      );
      onPublication(publication);
      setVersions([]);
      setNotice(`Published restored profile as version ${publication.version}.`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'The profile could not be restored. Refresh the queue and compare the current version before trying again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="community-section">
      <h2>Published profile history</h2>
      <p className="community-section-note">
        Review or restore an accepted profile even when it has no pending proposal. Restoring
        publishes a new version and may make pending proposals stale.
      </p>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      {notice && <CommunityNotice kind="success">{notice}</CommunityNotice>}
      <label className="community-field">
        <span>Published person</span>
        <select
          value={personId}
          onChange={(e) => {
            setPersonId(e.target.value);
            setVersions([]);
            setNotice('');
          }}
        >
          <option value="">Choose a person</option>
          {published.map((item) => (
            <option value={item.id} key={item.id}>
              {item.profile.name} · version {item.version}
            </option>
          ))}
        </select>
      </label>
      <div className="community-actions">
        <button
          type="button"
          className="community-secondary"
          disabled={!personId || busy}
          onClick={() => void load()}
        >
          {busy ? 'Loading…' : 'Load accepted history'}
        </button>
      </div>
      {versions.map((version) => (
        <details className="profile-history" key={version.version}>
          <summary>
            Version {version.version} · {new Date(version.updatedAt).toLocaleString()}
          </summary>
          <ProfileView
            profile={version.profile}
            anchorPrefix={`accepted-${version.version}-`}
            publicCredit={version.publicCredit}
          />
          <button
            type="button"
            className="community-secondary"
            disabled={busy || version.version === current?.version}
            onClick={() => void restore(version.version)}
          >
            Restore this accepted profile as a new version
          </button>
        </details>
      ))}
    </section>
  );
}

export function ProfileReview() {
  const dirtyReview = useRef(false);
  const [session, setSession] = useState<CommunitySession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [items, setItems] = useState<ProfileProposal[]>([]);
  const [published, setPublished] = useState<PublishedProfile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<SubmissionRecord[]>([]);
  async function load() {
    setLoading(true);
    setError('');
    try {
      const access = await communityRequest<CommunitySession>('/session');
      setSession(access);
      if (access.reviewer) {
        const [queue, publications, old] = await Promise.all([
          profileRequest<{ proposals: ProfileProposal[] }>('review'),
          profileRequest<{ profiles: PublishedProfile[] }>('published'),
          communityRequest<{ submissions: SubmissionRecord[] }>('/review'),
        ]);
        setItems(queue.proposals);
        setPublished(publications.profiles);
        setLegacy(
          old.submissions.filter((item) => ['pending', 'needs-information'].includes(item.status)),
        );
        const requested = new URLSearchParams(window.location.search).get('submission');
        setSelected((id) =>
          queue.proposals.some((item) => item.id === (id ?? requested))
            ? (id ?? requested)
            : (queue.proposals[0]?.id ?? null),
        );
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'The review queue could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const proposal = items.find((item) => item.id === selected);
  const publish = (publication: PublishedProfile) =>
    setPublished((current) => [
      ...current.filter((item) => item.id !== publication.id),
      publication,
    ]);
  if (loading) return <p role="status">Opening profile review…</p>;
  if (!session?.reviewer)
    return (
      <CommunityNotice title="Reviewer access required">
        <p>Sign in with an archive reviewer account to review complete profile proposals.</p>
        <Link href="/sign-in?next=/admin/contributions">Sign in</Link>
        {error && <p>{error}</p>}
      </CommunityNotice>
    );
  return (
    <div>
      <header className="profile-review-title">
        <div>
          <h1>Profile review</h1>
          <p>
            {items.length} pending complete {items.length === 1 ? 'profile' : 'profiles'}
          </p>
        </div>
        <button
          type="button"
          className="community-secondary"
          onClick={() => {
            if (
              dirtyReview.current &&
              !window.confirm('Refresh the queue? Any unsaved review edits will be lost.')
            )
              return;
            void load();
          }}
        >
          Refresh queue
        </button>
      </header>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      {notice && <CommunityNotice kind="success">{notice}</CommunityNotice>}
      <div className="profile-review-layout">
        <aside className="profile-review-queue" aria-label="Pending proposals">
          {items.length ? (
            items.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={selected === item.id}
                onClick={() => {
                  if (
                    item.id !== selected &&
                    dirtyReview.current &&
                    !window.confirm('Open this proposal? Any unsaved review edits will be lost.')
                  )
                    return;
                  setSelected(item.id);
                }}
              >
                <strong>{item.profile.name}</strong>
                <span>
                  {item.personId ? 'Replacement profile' : 'New person'} · v{item.proposalVersion}
                </span>
                <small>{new Date(item.createdAt).toLocaleDateString()}</small>
              </button>
            ))
          ) : (
            <p>No pending profile proposals.</p>
          )}
        </aside>
        <div>
          {proposal ? (
            <ReviewProposal
              key={proposal.id}
              proposal={proposal}
              published={published}
              onUpdate={(next) =>
                setItems((current) => current.map((item) => (item.id === next.id ? next : item)))
              }
              onRemove={(id) => {
                setItems((current) => current.filter((item) => item.id !== id));
                setSelected(null);
                setNotice('The proposal left the pending queue.');
              }}
              onPublication={publish}
              onDirtyChange={(dirty) => {
                dirtyReview.current = dirty;
              }}
            />
          ) : (
            <p>Select a profile to review.</p>
          )}
        </div>
      </div>
      <AcceptedProfileHistory published={published} onPublication={publish} />
      <section className="community-section">
        <h2>Legacy transition queue</h2>
        <p className="community-section-note">
          Earlier submissions are read-only. Copy relevant material into a complete profile proposal
          and review it there, or delete the old submission.
        </p>
        {legacy.length ? (
          legacy.map((item) => (
            <details key={item.id} className="profile-history">
              <summary>
                {item.input.proposedPersonName || item.input.title || item.id} · {item.status}
              </summary>
              <pre className="profile-legacy-content">
                {JSON.stringify(
                  {
                    ...item.input,
                    supplements: item.supplements,
                    uploadedEvidence: item.photos.map(({ id, caption, creator, rights }) => ({
                      id,
                      caption,
                      creator,
                      rights,
                    })),
                  },
                  null,
                  2,
                )}
              </pre>
              {item.supplements.length > 0 && (
                <section className="profile-legacy-supplements">
                  <h3>Additional details previously supplied</h3>
                  {item.supplements.map((supplement) => (
                    <article key={supplement.id}>
                      <p className="community-hint">
                        {new Date(supplement.createdAt).toLocaleString()}
                      </p>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{supplement.body}</p>
                    </article>
                  ))}
                </section>
              )}
              {item.photos.length > 0 && (
                <section className="profile-legacy-photos">
                  <h3>Uploaded evidence</h3>
                  <p className="community-hint">
                    Download any evidence you need to preserve, then select it in the complete
                    profile editor. Keep its caption, creator credit and rights statement.
                  </p>
                  {item.photos.map((photo) => {
                    const path = `/api/community/submissions/${encodeURIComponent(item.id)}/photos/${encodeURIComponent(photo.id)}`;
                    return (
                      <figure key={photo.id}>
                        <a href={path} target="_blank" rel="noopener noreferrer">
                          <img src={path} alt={photo.caption} loading="lazy" />
                        </a>
                        <figcaption>
                          <p>{photo.caption}</p>
                          <p>Creator: {photo.creator}</p>
                          <p>Rights: {photo.rights}</p>
                          <a className="community-text-button" href={`${path}?original=1`} download>
                            Download original evidence
                          </a>
                        </figcaption>
                      </figure>
                    );
                  })}
                </section>
              )}
              <Link
                className="community-secondary"
                href={`/contribute${item.input.personId ? `?person=${encodeURIComponent(item.input.personId)}` : ''}`}
              >
                Open complete profile editor
              </Link>
              <button
                type="button"
                className="community-danger"
                onClick={() => {
                  if (!window.confirm('Permanently delete this legacy submission?')) return;
                  void communityRequest(`/review/${encodeURIComponent(item.id)}`, {
                    method: 'POST',
                    body: JSON.stringify({ action: 'reject' }),
                  })
                    .then(() =>
                      setLegacy((current) => current.filter((entry) => entry.id !== item.id)),
                    )
                    .catch((failure) => setError(failure.message));
                }}
              >
                Delete legacy submission
              </button>
            </details>
          ))
        ) : (
          <p>No earlier submissions awaiting transition.</p>
        )}
      </section>
    </div>
  );
}
