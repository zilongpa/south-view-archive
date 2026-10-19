'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Sprout,
  Trash2,
} from 'lucide-react';
import {
  submissionInputSchema,
  photoMetadataSchema,
  linkedRecordIdsSchema,
  formatEventDate,
  type EventDate,
  type SubmissionInput,
  type SubmissionRecord,
  type PhotoMetadata,
} from '@southview/validators';
import { CommunityNotice } from './community-shell';
import { StoryContextFields } from './story-context-fields';
import { restoreDraftEventDate } from '@/lib/story-context';
import {
  communityRequest,
  uploadCommunityPhoto,
  privatePhotoUrl,
  submissionReceiptUrl,
  safeCommunityNext,
  type CommunitySession,
} from '@/lib/community-client';

export type PersonOption = { id: string; name: string };
type PhotoDraft = {
  clientPhotoId: string;
  file: File | null;
  name: string;
  preview: string;
  metadata: Omit<PhotoMetadata, 'permission'> & { permission: boolean };
  uploadedId?: string;
};
type Draft = {
  kind: SubmissionInput['kind'];
  personId: string;
  proposedPersonName: string;
  title: string;
  body: string;
  context: string;
  links: string;
  anonymous: boolean;
  displayName: string;
  clientRequestId: string;
  receiptToken: string;
  sourceCreator: string;
  narrator: string;
  holdingInstitution: string;
  savedSubmissionId: string;
  relatedPersonIds: string[];
  placeIds: string[];
  eventDate: EventDate;
};
const draftKey = 'south-view-contribution-draft-v1';
const kinds: { value: SubmissionInput['kind']; title: string; text: string }[] = [
  {
    value: 'memory',
    title: 'Share a memory',
    text: 'A personal recollection, family story, or lived experience.',
  },
  {
    value: 'addition',
    title: 'Add to a story',
    text: 'A document, photograph, or another piece of the history.',
  },
  {
    value: 'correction',
    title: 'Suggest a correction',
    text: 'Help us improve a detail in an existing record.',
  },
  {
    value: 'new-person',
    title: 'Remember someone new',
    text: 'Introduce a person who is not in this collection yet.',
  },
];

export function ContributionForm({
  people,
  places,
  initialPersonId,
}: {
  people: PersonOption[];
  places: PersonOption[];
  initialPersonId?: string;
}) {
  const [draft, setDraft] = useState<Draft>({
    kind: 'memory',
    personId: initialPersonId ?? '',
    proposedPersonName: '',
    title: '',
    body: '',
    context: '',
    links: '',
    anonymous: false,
    displayName: '',
    clientRequestId: '',
    receiptToken: '',
    sourceCreator: '',
    narrator: '',
    holdingInstitution: '',
    savedSubmissionId: '',
    relatedPersonIds: [],
    placeIds: [],
    eventDate: { kind: 'unknown' },
  });
  const [privateName, setPrivateName] = useState('');
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState(false);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [phase, setPhase] = useState<'write' | 'preview' | 'sending'>('write');
  const [error, setError] = useState('');
  const [storageReady, setStorageReady] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [restored, setRestored] = useState(false);
  const [session, setSession] = useState<CommunitySession | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const imageUrls = useRef(new Set<string>());
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  async function restoreSavedPhotos(record: SubmissionRecord, receiptToken: string) {
    setSubmissionId(record.id);
    const missing = record.photos.filter(
      (photo) => !photos.some((item) => item.clientPhotoId === photo.id),
    );
    setPhotos((previous) =>
      previous.map((photo) =>
        record.photos.some((saved) => saved.id === photo.clientPhotoId)
          ? { ...photo, uploadedId: photo.clientPhotoId }
          : photo,
      ),
    );
    const recovered = await Promise.all(
      missing.map(async (photo) => {
        const preview = await privatePhotoUrl(record.id, photo.id, receiptToken);
        imageUrls.current.add(preview);
        return {
          clientPhotoId: photo.id,
          uploadedId: photo.id,
          file: null,
          name: 'Previously uploaded photograph',
          preview,
          metadata: {
            caption: photo.caption,
            creator: photo.creator,
            rights: photo.rights,
            permission: true,
          },
        } satisfies PhotoDraft;
      }),
    );
    setPhotos((previous) => [
      ...previous,
      ...recovered.filter(
        (photo) => !previous.some((item) => item.clientPhotoId === photo.clientPhotoId),
      ),
    ]);
    return recovered.length;
  }

  async function recoverSavedDraft(id: string, receiptToken: string) {
    setRecovering(true);
    setRecoveryBlocked(false);
    try {
      const result = await communityRequest<{ submission: SubmissionRecord }>(
        `/submissions/${encodeURIComponent(id)}`,
        {},
        receiptToken,
      );
      if (result.submission.status !== 'draft') {
        sessionStorage.removeItem(draftKey);
        window.location.assign(submissionReceiptUrl(id, receiptToken));
        return;
      }
      await restoreSavedPhotos(result.submission, receiptToken);
    } catch (failure) {
      setRecoveryBlocked(true);
      setError(
        failure instanceof Error
          ? failure.message
          : 'Your saved photographs could not be recovered. Please retry before submitting.',
      );
    } finally {
      setRecovering(false);
    }
  }

  useEffect(() => {
    try {
      const value = sessionStorage.getItem(draftKey);
      if (value) {
        const saved: unknown = JSON.parse(value);
        if (saved && typeof saved === 'object') {
          const candidate = saved as Partial<Draft>;
          const strings = [
            'personId',
            'proposedPersonName',
            'title',
            'body',
            'context',
            'links',
            'displayName',
            'sourceCreator',
            'narrator',
            'holdingInstitution',
            'savedSubmissionId',
          ] as const;
          setDraft((previous) => ({
            ...previous,
            ...Object.fromEntries(
              strings
                .filter((key) => typeof candidate[key] === 'string')
                .map((key) => [key, candidate[key]]),
            ),
            kind: kinds.some((kind) => kind.value === candidate.kind) ? candidate.kind! : 'memory',
            anonymous: candidate.anonymous === true,
            relatedPersonIds: linkedRecordIdsSchema.catch([]).parse(candidate.relatedPersonIds),
            placeIds: linkedRecordIdsSchema.catch([]).parse(candidate.placeIds),
            eventDate: restoreDraftEventDate(candidate.eventDate),
            clientRequestId:
              typeof candidate.clientRequestId === 'string'
                ? candidate.clientRequestId
                : crypto.randomUUID(),
            receiptToken:
              typeof candidate.receiptToken === 'string'
                ? candidate.receiptToken
                : crypto.randomUUID() + crypto.randomUUID(),
          }));
          setRestored(true);
          if (candidate.savedSubmissionId && candidate.receiptToken)
            void recoverSavedDraft(candidate.savedSubmissionId, candidate.receiptToken);
        }
      } else
        setDraft((previous) => ({
          ...previous,
          clientRequestId: crypto.randomUUID(),
          receiptToken: crypto.randomUUID() + crypto.randomUUID(),
        }));
    } catch {
      setDraft((previous) => ({
        ...previous,
        clientRequestId: crypto.randomUUID(),
        receiptToken: crypto.randomUUID() + crypto.randomUUID(),
      }));
    }
    setStorageReady(true);
    communityRequest<CommunitySession>('/session')
      .then(setSession)
      .catch(() => {});
    const urls = imageUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem(draftKey, JSON.stringify(draft));
        setDraftSaved(true);
      } catch {
        setDraftSaved(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [draft, storageReady]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDraftSaved(false);
  }
  function inputValue(): SubmissionInput {
    return {
      ...draft,
      personId: draft.kind === 'new-person' || !draft.personId ? null : draft.personId,
      proposedPersonName:
        draft.kind === 'new-person' || !draft.personId ? draft.proposedPersonName : '',
      privateName,
      email: email.trim(),
      permission: true,
      links: draft.links
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf('|');
          return separator < 0
            ? { title: line, url: line }
            : { title: line.slice(0, separator).trim(), url: line.slice(separator + 1).trim() };
        }),
    };
  }
  function validate() {
    if (photos.length > 5) {
      setError('Choose no more than five photographs, including any recovered from your draft.');
      return null;
    }
    const result = submissionInputSchema.safeParse(inputValue());
    if (!result.success) {
      setError(result.error.issues.map((issue) => issue.message).join(' '));
      return null;
    }
    for (const photo of photos) {
      const checked = photoMetadataSchema.safeParse(photo.metadata);
      if (!checked.success) {
        setError(`Please complete the caption, creator, rights, and permission for ${photo.name}.`);
        return null;
      }
    }
    return result.data;
  }
  function addPhotos(files: FileList | null) {
    if (!files) return;
    const selected = [...files];
    if (photos.length + selected.length > 5) {
      setError('You can include up to five photographs. Remove one before adding another.');
      return;
    }
    const invalid = selected.find(
      (file) =>
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 10 * 1024 * 1024,
    );
    if (invalid) {
      setError(
        `${invalid.name} could not be added. Choose JPEG, PNG, or WebP files of 10 MB or less. Your other photographs and text are still here.`,
      );
      return;
    }
    setError('');
    setPhotos((previous) => [
      ...previous,
      ...selected.map((file) => {
        const preview = URL.createObjectURL(file);
        imageUrls.current.add(preview);
        return {
          clientPhotoId: crypto.randomUUID(),
          file,
          name: file.name,
          preview,
          metadata: { caption: '', creator: '', rights: '', permission: false },
        };
      }),
    ]);
  }
  function updatePhoto(index: number, patch: Partial<PhotoDraft['metadata']>) {
    setPhotos((previous) =>
      previous.map((photo, i) =>
        i === index ? { ...photo, metadata: { ...photo.metadata, ...patch } } : photo,
      ),
    );
  }
  async function removePhoto(index: number) {
    const photo = photos[index];
    if (!photo) return;
    setPhotoBusy(true);
    setError('');
    try {
      if (photo.uploadedId && submissionId)
        await communityRequest(
          `/submissions/${encodeURIComponent(submissionId)}/photos/${encodeURIComponent(photo.uploadedId)}`,
          { method: 'DELETE' },
          draft.receiptToken,
        );
      URL.revokeObjectURL(photo.preview);
      imageUrls.current.delete(photo.preview);
      setPhotos((previous) => previous.filter((item) => item.preview !== photo.preview));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'The photograph could not be removed. Please try again.',
      );
    } finally {
      setPhotoBusy(false);
    }
  }
  function preview(event: FormEvent) {
    event.preventDefault();
    if (recovering || recoveryBlocked) {
      setError('Please recover your saved photographs before reviewing this contribution.');
      return;
    }
    setError('');
    if (!validate()) return;
    setPhase('preview');
    requestAnimationFrame(() => {
      previewHeading.current?.focus();
      previewHeading.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }
  async function submit() {
    const input = validate();
    if (!input) {
      setPhase('write');
      return;
    }
    if (!permission) {
      setError(
        'Please confirm that reviewers may review this contribution and publish it with your chosen credit.',
      );
      return;
    }
    setPhase('sending');
    setError('');
    try {
      setProgress('Saving your contribution…');
      const created = submissionId
        ? { id: submissionId }
        : await communityRequest<{ id: string }>('/submissions', {
            method: 'POST',
            body: JSON.stringify({ input, receiptToken: draft.receiptToken }),
          });
      setSubmissionId(created.id);
      change('savedSubmissionId', created.id);
      try {
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({ ...draft, savedSubmissionId: created.id }),
        );
      } catch {
        /* Receipt remains in memory when storage is disabled. */
      }
      const saved = await communityRequest<{ submission: SubmissionRecord }>(
        `/submissions/${encodeURIComponent(created.id)}`,
        {},
        draft.receiptToken,
      );
      if (saved.submission.status !== 'draft') {
        try {
          sessionStorage.removeItem(draftKey);
        } catch {
          /* Draft storage may be disabled. */
        }
        window.location.assign(submissionReceiptUrl(created.id, draft.receiptToken));
        return;
      }
      const recoveredCount = await restoreSavedPhotos(saved.submission, draft.receiptToken);
      if (recoveredCount > 0) {
        setPhase('preview');
        setPermission(false);
        setError(
          'Previously uploaded photographs have been restored to the preview. Please check all photographs and confirm again before sending.',
        );
        return;
      }
      await communityRequest(
        `/submissions/${encodeURIComponent(created.id)}`,
        { method: 'PATCH', body: JSON.stringify({ input }) },
        draft.receiptToken,
      );
      for (const [index, photo] of photos.entries()) {
        if (photo.uploadedId) continue;
        if (!photo.file) throw new Error('A photograph is missing. Please choose it again.');
        setProgress(`Uploading photograph ${index + 1} of ${photos.length}…`);
        const uploaded = await uploadCommunityPhoto(
          created.id,
          photo.file,
          photo.clientPhotoId,
          photoMetadataSchema.parse(photo.metadata),
          draft.receiptToken,
        );
        photo.uploadedId = uploaded.photo.id;
        setPhotos((previous) =>
          previous.map((item) =>
            item.preview === photo.preview ? { ...item, uploadedId: uploaded.photo.id } : item,
          ),
        );
      }
      setProgress('Submitting for review…');
      await communityRequest(
        `/submissions/${encodeURIComponent(created.id)}/submit`,
        { method: 'POST' },
        draft.receiptToken,
      );
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* Draft storage may be disabled. */
      }
      window.location.assign(submissionReceiptUrl(created.id, draft.receiptToken));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'We could not send your contribution. Your text and photographs are still here; please try again.',
      );
      setPhase('preview');
    }
  }

  const personName =
    draft.kind === 'new-person' || !draft.personId
      ? draft.proposedPersonName
      : (people.find((person) => person.id === draft.personId)?.name ?? draft.proposedPersonName);
  const signInNext = safeCommunityNext(
    draft.kind !== 'new-person' && draft.personId
      ? `/contribute?person=${encodeURIComponent(draft.personId)}`
      : '/contribute',
  );
  return (
    <div className="community-grid">
      <div>
        <div ref={errorRef} tabIndex={-1}>
          {error && (
            <CommunityNotice kind="error" title="Your contribution has not been submitted">
              {error}
            </CommunityNotice>
          )}
        </div>
        {session?.mode === 'fixture' && (
          <CommunityNotice title="This archive is in read-only mode">
            You can prepare your story here, but submissions are not available until contribution
            storage is configured.
          </CommunityNotice>
        )}
        {restored && phase === 'write' && (
          <CommunityNotice title="Your draft text is here">
            We restored your text from this browser tab. Please re-enter your private contact
            details. Uploaded photographs are recovered from your private draft; files not yet
            uploaded must be chosen again.
          </CommunityNotice>
        )}
        {recovering && (
          <div className="community-loading" role="status">
            <LoaderCircle className="community-spinner" size={20} /> Recovering your saved
            photographs…
          </div>
        )}
        {recoveryBlocked && draft.savedSubmissionId && (
          <CommunityNotice title="Check the saved draft before continuing">
            <p>
              Your saved photographs could not be displayed. Sending is paused so no image is
              included without appearing in your preview.
            </p>
            <div className="community-actions">
              <button
                className="community-secondary"
                onClick={() => recoverSavedDraft(draft.savedSubmissionId, draft.receiptToken)}
              >
                Retry recovery
              </button>
              <Link
                className="community-text-button"
                href={submissionReceiptUrl(draft.savedSubmissionId, draft.receiptToken)}
              >
                Open private draft receipt
              </Link>
            </div>
          </CommunityNotice>
        )}
        {phase === 'write' ? (
          <form className="community-form" onSubmit={preview}>
            <section className="community-section">
              <div className="community-section-heading">
                <span className="community-step">01</span>
                <h2>What would you like to share?</h2>
              </div>
              <div className="community-choice-grid">
                {kinds.map((kind) => (
                  <label className="community-choice" key={kind.value}>
                    <input
                      type="radio"
                      name="contribution-kind"
                      value={kind.value}
                      checked={draft.kind === kind.value}
                      onChange={() => change('kind', kind.value)}
                    />
                    <span>
                      <strong>{kind.title}</strong>
                      <small>{kind.text}</small>
                    </span>
                  </label>
                ))}
              </div>
            </section>
            <section className="community-section">
              <div className="community-section-heading">
                <span className="community-step">02</span>
                <h2>A person. A story. A connection.</h2>
              </div>
              <div className="community-fields">
                {draft.kind !== 'new-person' && (
                  <label className="community-field">
                    <span>Who is this about?</span>
                    <select
                      value={draft.personId}
                      onChange={(event) => change('personId', event.target.value)}
                    >
                      <option value="">Someone not listed here</option>
                      {people.map((person) => (
                        <option value={person.id} key={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {(draft.kind === 'new-person' || !draft.personId) && (
                  <label className="community-field">
                    <span>
                      Person’s name <span className="community-required">*</span>
                    </span>
                    <input
                      value={draft.proposedPersonName}
                      onChange={(event) => change('proposedPersonName', event.target.value)}
                      required
                      maxLength={160}
                    />
                    <small>
                      Use the name you know. Reviewers can help with name variations and
                      identification.
                    </small>
                  </label>
                )}
                <label className="community-field">
                  <span>
                    Give your contribution a title <span className="community-required">*</span>
                  </span>
                  <input
                    value={draft.title}
                    onChange={(event) => change('title', event.target.value)}
                    required
                    minLength={3}
                    maxLength={160}
                    placeholder="A few words to introduce your story"
                  />
                </label>
                <label className="community-field">
                  <span>
                    {draft.kind === 'correction'
                      ? 'What needs correcting, and what should it say?'
                      : 'Your story or contribution'}{' '}
                    <span className="community-required">*</span>
                  </span>
                  <textarea
                    value={draft.body}
                    onChange={(event) => change('body', event.target.value)}
                    required
                    minLength={20}
                    maxLength={20000}
                    rows={9}
                    placeholder="Tell it in your own words. What do you remember, or what would you like others to know?"
                  />
                  <small>
                    {draft.body.length.toLocaleString()} / 20,000 characters. Personal recollections
                    are welcome as recollections.
                  </small>
                </label>
                <label className="community-field">
                  <span>How do you know this story?</span>
                  <textarea
                    value={draft.context}
                    onChange={(event) => change('context', event.target.value)}
                    maxLength={4000}
                    rows={3}
                    placeholder="Your connection to this person, how you learned this, or where the material came from."
                  />
                  <small>
                    This context helps readers understand the perspective behind the contribution.
                    It may be shown publicly.
                  </small>
                </label>
                <details className="story-context-details">
                  <summary>
                    Connect this story to people, places, and a time{' '}
                    <span className="community-hint">(optional)</span>
                  </summary>
                  <StoryContextFields
                    people={people}
                    places={places}
                    primaryPersonId={draft.kind === 'new-person' ? '' : draft.personId}
                    value={draft}
                    onChange={(context) => {
                      setDraft((previous) => ({ ...previous, ...context }));
                      setDraftSaved(false);
                    }}
                  />
                </details>
                <div className="community-two-columns">
                  <label className="community-field">
                    <span>Original author or creator (if different)</span>
                    <input
                      value={draft.sourceCreator}
                      onChange={(event) => change('sourceCreator', event.target.value)}
                      maxLength={200}
                    />
                    <small>Who originally wrote, created, or recorded this material?</small>
                  </label>
                  <label className="community-field">
                    <span>Narrator or person remembering</span>
                    <input
                      value={draft.narrator}
                      onChange={(event) => change('narrator', event.target.value)}
                      maxLength={200}
                    />
                    <small>For an account told by somebody other than you.</small>
                  </label>
                </div>
                <label className="community-field">
                  <span>Holding institution or collection</span>
                  <input
                    value={draft.holdingInstitution}
                    onChange={(event) => change('holdingInstitution', event.target.value)}
                    maxLength={200}
                    placeholder="Library, archive, or family collection, if applicable"
                  />
                </label>
                <label className="community-field">
                  <span>
                    Related sources or links <span className="community-hint">(optional)</span>
                  </span>
                  <textarea
                    value={draft.links}
                    onChange={(event) => change('links', event.target.value)}
                    rows={3}
                    placeholder={
                      'Collection or document title | https://example.org/record\nOne source per line'
                    }
                  />
                  <small>
                    Up to 10 links. A memory does not need a written source to be submitted as a
                    memory.
                  </small>
                </label>
              </div>
            </section>
            <section className="community-section">
              <div className="community-section-heading">
                <span className="community-step">03</span>
                <h2>Photographs, with their story</h2>
              </div>
              <p className="community-section-note">
                Optional. Up to five JPEG, PNG, or WebP images, no more than 10 MB each.
              </p>
              <div className="community-upload">
                <ImagePlus size={30} strokeWidth={1.3} />
                <strong>A face, a place, a moment remembered.</strong>
                <p className="community-hint">
                  Include only photographs you have permission to share.
                </p>
                <input
                  aria-label="Choose photographs"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) => {
                    addPhotos(event.target.files);
                    event.target.value = '';
                  }}
                  disabled={photos.length >= 5 || recovering || recoveryBlocked}
                />
              </div>
              <div className="community-photo-list">
                {photos.map((photo, index) => (
                  <div className="community-photo" key={photo.preview}>
                    <img src={photo.preview} alt={`Your selected photograph ${index + 1}`} />
                    <div className="community-photo-meta">
                      <strong>{photo.name}</strong>
                      {photo.uploadedId && (
                        <p className="community-hint">
                          Saved to your private draft. Remove and add it again to change its caption
                          or permissions.
                        </p>
                      )}
                      <label className="community-field">
                        <span>Caption *</span>
                        <input
                          disabled={Boolean(photo.uploadedId)}
                          value={photo.metadata.caption}
                          onChange={(event) => updatePhoto(index, { caption: event.target.value })}
                          required
                          maxLength={500}
                        />
                      </label>
                      <label className="community-field">
                        <span>Photographer or creator *</span>
                        <input
                          disabled={Boolean(photo.uploadedId)}
                          value={photo.metadata.creator}
                          onChange={(event) => updatePhoto(index, { creator: event.target.value })}
                          required
                          maxLength={160}
                          placeholder="Name, family collection, or unknown"
                        />
                      </label>
                      <label className="community-field">
                        <span>Rights and permission *</span>
                        <input
                          disabled={Boolean(photo.uploadedId)}
                          value={photo.metadata.rights}
                          onChange={(event) => updatePhoto(index, { rights: event.target.value })}
                          required
                          maxLength={1000}
                          placeholder="Who owns it, and how may it be used?"
                        />
                      </label>
                      <label className="community-check" style={{ marginTop: 14 }}>
                        <input
                          disabled={Boolean(photo.uploadedId)}
                          type="checkbox"
                          checked={photo.metadata.permission}
                          onChange={(event) =>
                            updatePhoto(index, { permission: event.target.checked })
                          }
                          required
                        />
                        <span>I have permission for South-View to display this photograph.</span>
                      </label>
                      <button
                        className="community-text-button"
                        type="button"
                        disabled={photoBusy}
                        onClick={() => removePhoto(index)}
                      >
                        <Trash2 size={14} aria-hidden="true" /> Remove photograph
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="community-section">
              <div className="community-section-heading">
                <span className="community-step">04</span>
                <h2>How should we credit you?</h2>
              </div>
              <div className="community-fields">
                <div className="community-two-columns">
                  <label className="community-field">
                    <span>
                      Your name <span className="community-required">*</span>
                    </span>
                    <input
                      value={privateName}
                      onChange={(event) => setPrivateName(event.target.value)}
                      required
                      minLength={2}
                      maxLength={160}
                      autoComplete="name"
                    />
                    <small>Private. Used by the review team.</small>
                  </label>
                  <label className="community-field">
                    <span>
                      Email address <span className="community-required">*</span>
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      autoComplete="email"
                    />
                    <small>Private. For your receipt and review updates.</small>
                  </label>
                </div>
                <label className="community-check">
                  <input
                    type="checkbox"
                    checked={draft.anonymous}
                    onChange={(event) => change('anonymous', event.target.checked)}
                  />
                  <span>
                    Publish my contribution anonymously.
                    <small>Reviewers can still contact you privately about the contribution.</small>
                  </span>
                </label>
                {!draft.anonymous && (
                  <label className="community-field">
                    <span>
                      Public display name <span className="community-required">*</span>
                    </span>
                    <input
                      value={draft.displayName}
                      onChange={(event) => change('displayName', event.target.value)}
                      required
                      maxLength={160}
                      placeholder="The name readers will see"
                    />
                    <small>Only this name appears in the public contributor credit.</small>
                  </label>
                )}
              </div>
            </section>
            <div className="community-actions">
              <button className="community-primary" type="submit">
                Review my contribution <ArrowRight size={17} />
              </button>
              <span className="community-draft">
                {draftSaved && <Check size={14} />}
                {draftSaved
                  ? 'Draft text saved in this tab'
                  : 'Your contact details and photos stay unsaved'}
              </span>
            </div>
          </form>
        ) : (
          <div className="community-preview">
            <p className="community-preview-label">Review before you send</p>
            <h2 ref={previewHeading} tabIndex={-1}>
              {draft.title}
            </h2>
            <div className="community-review-line">
              <strong>About</strong>
              {personName}
            </div>
            <div className="community-review-line">
              <strong>Contribution type</strong>
              {kinds.find((kind) => kind.value === draft.kind)?.title}
            </div>
            <p className="community-body">{draft.body}</p>
            <div className="community-review-line">
              <strong>Event date</strong>
              {formatEventDate(draft.eventDate)}
            </div>
            {draft.relatedPersonIds.length > 0 && (
              <div className="community-review-line">
                <strong>Other people mentioned</strong>
                {people
                  .filter(
                    (person) =>
                      draft.relatedPersonIds.includes(person.id) &&
                      (draft.kind === 'new-person' || person.id !== draft.personId),
                  )
                  .map((person) => person.name)
                  .join('; ')}
              </div>
            )}
            {draft.placeIds.length > 0 && (
              <div className="community-review-line">
                <strong>Places mentioned</strong>
                {places
                  .filter((place) => draft.placeIds.includes(place.id))
                  .map((place) => place.name)
                  .join('; ')}
              </div>
            )}
            {draft.context && (
              <div className="community-review-line">
                <strong>Context</strong>
                {draft.context}
              </div>
            )}
            {draft.links && (
              <div className="community-review-line">
                <strong>Related sources</strong>
                {draft.links}
              </div>
            )}
            {draft.sourceCreator && (
              <div className="community-review-line">
                <strong>Original author or creator</strong>
                {draft.sourceCreator}
              </div>
            )}
            {draft.narrator && (
              <div className="community-review-line">
                <strong>Narrator</strong>
                {draft.narrator}
              </div>
            )}
            {draft.holdingInstitution && (
              <div className="community-review-line">
                <strong>Holding institution or collection</strong>
                {draft.holdingInstitution}
              </div>
            )}
            <div className="community-review-line">
              <strong>Public credit</strong>
              {draft.anonymous ? 'Anonymous contributor' : draft.displayName}
            </div>
            <div className="community-review-line">
              <strong>Photographs</strong>
              {photos.length} included, each with its caption and rights information
            </div>
            {photos.length > 0 && (
              <div className="community-gallery">
                {photos.map((photo) => (
                  <figure key={photo.preview}>
                    <img src={photo.preview} alt={photo.metadata.caption} />
                    <figcaption>
                      <strong>{photo.metadata.caption}</strong>
                      <br />
                      Creator: {photo.metadata.creator}
                      <br />
                      Rights: {photo.metadata.rights}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            <div className="community-review-line">
              <strong>Private contact</strong>
              {privateName} · {email}
            </div>
            <label className="community-check" style={{ marginTop: 25 }}>
              <input
                type="checkbox"
                checked={permission}
                onChange={(event) => setPermission(event.target.checked)}
              />
              <span>
                I give South-View permission to review this contribution and display the approved
                text and photographs with the public credit shown above.
                <small>
                  Archive reviewers check every contribution before it becomes public. Your private
                  name and email address will not be displayed.
                </small>
              </span>
            </label>
            <div className="community-actions">
              <button
                className="community-primary"
                type="button"
                disabled={
                  phase === 'sending' ||
                  !permission ||
                  photoBusy ||
                  recovering ||
                  recoveryBlocked ||
                  session?.mode === 'fixture'
                }
                onClick={submit}
              >
                {phase === 'sending' ? (
                  <>
                    <LoaderCircle size={17} className="community-spinner" />{' '}
                    {progress || 'Sending your contribution…'}
                  </>
                ) : (
                  <>
                    Send for review <ArrowRight size={17} />
                  </>
                )}
              </button>
              <button
                className="community-secondary"
                type="button"
                disabled={phase === 'sending'}
                onClick={() => {
                  setPhase('write');
                  setError('');
                }}
              >
                <ArrowLeft size={16} /> Keep editing
              </button>
            </div>
          </div>
        )}
      </div>
      <aside className="community-sidebar">
        <div className="community-aside-card">
          <Sprout size={28} strokeWidth={1.2} />
          <h2>History grows through people.</h2>
          <p>
            A family photograph. A story told at the kitchen table. A detail that deserves to be
            remembered.
          </p>
          <ol>
            <li>Share what you know, in your own words.</li>
            <li>Reviewers may ask for more context.</li>
            <li>Approved contributions join the archive with clear credit.</li>
          </ol>
        </div>
        <div className="community-aside-card">
          <LockKeyhole size={23} strokeWidth={1.3} />
          <h2>Your story, your credit.</h2>
          <p>
            Your contact details stay private. You can use a public display name or be credited
            anonymously.
          </p>
        </div>
        <p className="community-aside-note">
          No account is required.{' '}
          <Link href={`/sign-in?next=${encodeURIComponent(signInNext)}`}>Sign in</Link> if you would
          like to keep your contributions together.
        </p>
        <p className="community-aside-note" style={{ marginTop: 18 }}>
          <BookOpen size={16} aria-hidden="true" /> Memories retain their context. They are not
          presented as independently documented facts.
        </p>
      </aside>
    </div>
  );
}
