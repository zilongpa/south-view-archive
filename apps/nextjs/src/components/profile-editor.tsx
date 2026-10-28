'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  profileSubmissionSchema,
  type PersonProfile,
  type ProfileLocation,
  type ProfileSource,
  type PublishedProfile,
} from '@southview/validators';
import {
  communityRequest,
  submissionReceiptUrl,
  type CommunitySession,
} from '../lib/community-client';
import {
  emptyProfile,
  newProfileId,
  profileMultipart,
  profileRequest,
  useProfileMedia,
} from '../lib/profile-client';
import { CommunityNotice } from './community-shell';
import { ProfileView, profileMediaUrl } from './profile-view';
import { safeProfileHref } from '../lib/profile-markdown';
import { prepareProfileAttempt } from '../lib/profile-preview';
import {
  addBodySource,
  pruneEvidenceSources,
  evidenceSources,
  removeEvidence,
  setDirectEvidence,
  type EvidenceTarget,
} from '../lib/profile-evidence';
import './profile.css';

type ProfileFieldsProps = {
  profile: PersonProfile;
  onChange: (profile: PersonProfile) => void;
  files: Record<string, File>;
  onFilesChange: (files: Record<string, File>) => void;
};
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="community-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function DirectEvidence({
  profile,
  target,
  onChange,
  files,
  upload,
}: {
  profile: PersonProfile;
  target: Exclude<EvidenceTarget, 'body'>;
  onChange: (profile: PersonProfile) => void;
  files: Record<string, File>;
  upload: (file: File | undefined, done: (id: string) => void) => void;
}) {
  const sources = evidenceSources(profile, target);
  const label = target === 'portrait' ? 'Image source link' : 'Location source link';
  return (
    <div className="profile-direct-evidence">
      {(sources.length ? sources : [undefined]).map((source, index) => (
        <div key={source?.id ?? 'new'} className="community-fields">
          <Field label={label} hint="Paste a source link, or upload supporting evidence below.">
            <input
              inputMode="url"
              value={source?.url ?? ''}
              placeholder="https://…"
              onChange={(event) =>
                onChange(
                  setDirectEvidence(
                    profile,
                    target,
                    source?.id,
                    { url: event.target.value },
                    newProfileId,
                  ),
                )
              }
            />
          </Field>
          <Field
            label={target === 'portrait' ? 'Image source evidence' : 'Location source evidence'}
            hint={
              source?.mediaId
                ? `Attached: ${files[source.mediaId]?.name ?? source.title}`
                : 'Optional image or PDF instead of a link.'
            }
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(event) => {
                const file = event.target.files?.[0];
                upload(file, (mediaId) =>
                  onChange(
                    setDirectEvidence(
                      profile,
                      target,
                      source?.id,
                      { mediaId, fileName: file?.name },
                      newProfileId,
                    ),
                  ),
                );
              }}
            />
          </Field>
          {source && (
            <button
              type="button"
              className="community-text-button"
              aria-label={`Remove ${target === 'portrait' ? 'image' : 'location'} source ${index + 1}`}
              onClick={() => onChange(removeEvidence(profile, target, source.id))}
            >
              Remove source
            </button>
          )}
        </div>
      ))}
      {sources.length > 0 && (
        <button
          type="button"
          className="community-text-button"
          onClick={() =>
            onChange(setDirectEvidence(profile, target, undefined, { url: '' }, newProfileId))
          }
        >
          Add another source
        </button>
      )}
    </div>
  );
}
export function ProfileFields({ profile, onChange, files, onFilesChange }: ProfileFieldsProps) {
  const [fileError, setFileError] = useState('');
  const update = (patch: Partial<PersonProfile>) => onChange({ ...profile, ...patch });
  const sourceUpdate = (id: string, patch: Partial<ProfileSource>) =>
    update({
      sources: profile.sources.map((source) =>
        source.id === id ? { ...source, ...patch } : source,
      ),
    });
  const locationUpdate = (id: string, patch: Partial<ProfileLocation>) =>
    update({
      locations: profile.locations.map((location) => {
        if (location.id !== id) return location;
        const next = { ...location, ...patch };
        return {
          ...next,
          coordinateSourceIds: next.coordinates
            ? next.coordinateSourceIds.length
              ? next.coordinateSourceIds
              : next.sourceIds
            : [],
        };
      }),
    });
  const setFile = (file: File | undefined, done: (id: string) => void) => {
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) ||
      !file.size ||
      file.size > 10 * 1024 * 1024
    ) {
      setFileError('Choose a JPEG, PNG, WebP or PDF file no larger than 10 MiB.');
      return;
    }
    setFileError('');
    const id = newProfileId();
    onFilesChange({ ...files, [id]: file });
    done(id);
  };
  return (
    <div className="profile-fields">
      {fileError && <CommunityNotice kind="error">{fileError}</CommunityNotice>}
      <section className="community-section">
        <h2>Person and biography</h2>
        <div className="community-fields">
          <Field label="Display name">
            <input
              required
              maxLength={160}
              value={profile.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </Field>
          <Field label="Other names" hint="Separate aliases with commas.">
            <input
              value={(profile.aliases ?? []).join(', ')}
              onChange={(e) =>
                update({ aliases: e.target.value.split(',').map((name) => name.trimStart()) })
              }
              onBlur={() =>
                update({
                  aliases: (profile.aliases ?? []).map((name) => name.trim()).filter(Boolean),
                })
              }
            />
          </Field>
          <div className="community-two-columns">
            <Field label="Birth year">
              <input
                type="number"
                value={profile.birthYear ?? ''}
                onChange={(e) =>
                  update({ birthYear: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Death year">
              <input
                type="number"
                value={profile.deathYear ?? ''}
                onChange={(e) =>
                  update({ deathYear: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <Field label="Tags" hint="Separate tags with commas.">
            <input
              value={profile.tags.join(', ')}
              onChange={(e) =>
                update({ tags: e.target.value.split(',').map((tag) => tag.trimStart()) })
              }
              onBlur={() =>
                update({
                  tags: [...new Set(profile.tags.map((tag) => tag.trim()).filter(Boolean))],
                })
              }
            />
          </Field>
          <Field
            label="Profile body"
            hint="Use headings, paragraphs, lists, bold text, and links. Add the sources for this text below. Mark personal memories as recollections and preserve the author’s public credit."
          >
            <textarea
              required
              rows={16}
              maxLength={20000}
              value={profile.bodyMarkdown}
              onChange={(e) => update({ bodyMarkdown: e.target.value })}
            />
          </Field>
        </div>
      </section>
      <section className="community-section">
        <h2>Sources for the text</h2>
        <p className="community-section-note">
          Selected evidence becomes public if the profile is approved. Remove private information
          before choosing files. Images and PDFs are supported; up to 10 files, 10 MiB each, 50 MiB
          total.
        </p>
        {evidenceSources(profile, 'body').map((source, index) => (
          <fieldset className="profile-edit-entry" key={source.id}>
            <legend>Source {index + 1}</legend>
            <div className="community-fields">
              <Field label="Source title">
                <input
                  required
                  value={source.title}
                  onChange={(e) => sourceUpdate(source.id, { title: e.target.value })}
                />
              </Field>
              <Field label="Source type">
                <select
                  value={source.kind}
                  onChange={(e) =>
                    sourceUpdate(source.id, {
                      kind: e.target.value as ProfileSource['kind'],
                      url: undefined,
                      mediaId: undefined,
                    })
                  }
                >
                  <option value="link">External link</option>
                  <option value="attachment">Evidence file</option>
                  <option value="memory">Firsthand recollection</option>
                </select>
              </Field>
              {source.kind === 'link' && (
                <Field label="Source URL">
                  <input
                    type="url"
                    value={source.url ?? ''}
                    onChange={(e) => sourceUpdate(source.id, { url: e.target.value })}
                  />
                </Field>
              )}
              {source.kind === 'attachment' && (
                <>
                  <Field
                    label="Evidence file"
                    hint={
                      source.mediaId
                        ? `Attached: ${files[source.mediaId]?.name ?? 'existing evidence file'}`
                        : 'Choose JPEG, PNG, WebP or PDF.'
                    }
                  >
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={(e) =>
                        setFile(e.target.files?.[0], (mediaId) =>
                          sourceUpdate(source.id, { mediaId }),
                        )
                      }
                    />
                  </Field>
                  {source.url && (
                    <Field label="Existing evidence URL">
                      <input
                        value={source.url}
                        onChange={(e) => sourceUpdate(source.id, { url: e.target.value })}
                      />
                    </Field>
                  )}
                </>
              )}
              <Field
                label={
                  source.kind === 'memory'
                    ? 'Public author or narrator credit'
                    : 'Author or creator'
                }
              >
                <input
                  value={source.creator ?? ''}
                  onChange={(e) => sourceUpdate(source.id, { creator: e.target.value })}
                />
              </Field>
              <Field label="Page, date or collection locator">
                <input
                  value={source.locator ?? ''}
                  onChange={(e) => sourceUpdate(source.id, { locator: e.target.value })}
                />
              </Field>
              <Field label="Rights or permission">
                <input
                  value={source.rights ?? ''}
                  onChange={(e) => sourceUpdate(source.id, { rights: e.target.value })}
                />
              </Field>
              <button
                type="button"
                className="community-text-button"
                onClick={() => onChange(removeEvidence(profile, 'body', source.id))}
              >
                Remove source
              </button>
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          className="community-secondary"
          onClick={() =>
            onChange(addBodySource(profile, { id: newProfileId(), title: '', kind: 'link' }))
          }
        >
          Add source
        </button>
      </section>
      <section className="community-section">
        <h2>Portrait</h2>
        {!profile.portrait ? (
          <button
            type="button"
            className="community-secondary"
            onClick={() => update({ portrait: { alt: '', credit: '', rights: '', sourceIds: [] } })}
          >
            Add portrait
          </button>
        ) : (
          <div className="community-fields">
            <Field
              label="Portrait image"
              hint={
                profile.portrait.mediaId
                  ? `Attached: ${files[profile.portrait.mediaId]?.name ?? 'existing portrait'}`
                  : 'Choose JPEG, PNG or WebP.'
              }
            >
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) =>
                  setFile(e.target.files?.[0], (mediaId) =>
                    update({ portrait: { ...profile.portrait!, mediaId, url: undefined } }),
                  )
                }
              />
            </Field>
            <Field label="Image URL" hint="Use an existing approved image or upload a file above.">
              <input
                inputMode="url"
                value={profile.portrait.url ?? ''}
                onChange={(e) =>
                  update({
                    portrait: { ...profile.portrait!, url: e.target.value, mediaId: undefined },
                  })
                }
              />
            </Field>
            {(['alt', 'credit', 'rights'] as const).map((key) => (
              <Field
                key={key}
                label={
                  {
                    alt: 'Image description',
                    credit: 'Creator credit',
                    rights: 'Rights or permission',
                  }[key]
                }
              >
                <input
                  value={profile.portrait![key]}
                  onChange={(e) =>
                    update({ portrait: { ...profile.portrait!, [key]: e.target.value } })
                  }
                />
              </Field>
            ))}
            <DirectEvidence
              profile={profile}
              target="portrait"
              onChange={onChange}
              files={files}
              upload={setFile}
            />
            <button
              type="button"
              className="community-text-button"
              onClick={() => onChange(pruneEvidenceSources({ ...profile, portrait: undefined }))}
            >
              Remove portrait
            </button>
          </div>
        )}
      </section>
      <section className="community-section">
        <h2>Connected locations</h2>
        <p className="community-section-note">
          This is the complete list for this person. Removing a location removes it from the
          published profile and map after approval.
        </p>
        {profile.locations.map((location, index) => (
          <fieldset className="profile-edit-entry" key={location.id}>
            <legend>Location {index + 1}</legend>
            <div className="community-fields">
              {(['name', 'label', 'description', 'address'] as const).map((key) => (
                <Field
                  key={key}
                  label={
                    {
                      name: 'Place name',
                      label: 'Connection label',
                      description: 'Connection description',
                      address: 'Address',
                    }[key]
                  }
                >
                  <input
                    value={location[key] ?? ''}
                    onChange={(e) => locationUpdate(location.id, { [key]: e.target.value })}
                  />
                </Field>
              ))}
              <Field label="Map scope">
                <select
                  value={location.scope}
                  onChange={(e) =>
                    locationUpdate(location.id, {
                      scope: e.target.value as ProfileLocation['scope'],
                    })
                  }
                >
                  <option value="cemetery">South-View Cemetery</option>
                  <option value="atlanta">Atlanta</option>
                </select>
              </Field>
              <Field label="Position precision">
                <select
                  value={location.precision}
                  onChange={(e) =>
                    locationUpdate(location.id, {
                      precision: e.target.value as ProfileLocation['precision'],
                      ...(e.target.value === 'unmapped' ? { coordinates: null } : {}),
                    })
                  }
                >
                  <option value="unmapped">Unmapped</option>
                  <option value="reference">Reference point</option>
                  <option value="address">Address</option>
                  <option value="verified">Verified position</option>
                </select>
              </Field>
              {location.precision !== 'unmapped' && (
                <div className="community-two-columns">
                  <Field label="Longitude">
                    <input
                      type="number"
                      step="any"
                      min={-180}
                      max={180}
                      value={location.coordinates?.[0] ?? ''}
                      onChange={(e) =>
                        locationUpdate(location.id, {
                          coordinates: [Number(e.target.value), location.coordinates?.[1] ?? 0],
                        })
                      }
                    />
                  </Field>
                  <Field label="Latitude">
                    <input
                      type="number"
                      step="any"
                      min={-90}
                      max={90}
                      value={location.coordinates?.[1] ?? ''}
                      onChange={(e) =>
                        locationUpdate(location.id, {
                          coordinates: [location.coordinates?.[0] ?? 0, Number(e.target.value)],
                        })
                      }
                    />
                  </Field>
                </div>
              )}
              <DirectEvidence
                profile={profile}
                target={{ locationId: location.id }}
                onChange={onChange}
                files={files}
                upload={setFile}
              />
              <button
                type="button"
                className="community-text-button"
                onClick={() =>
                  onChange(
                    pruneEvidenceSources({
                      ...profile,
                      locations: profile.locations.filter((item) => item.id !== location.id),
                    }),
                  )
                }
              >
                Remove location
              </button>
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          className="community-secondary"
          onClick={() =>
            update({
              locations: [
                ...profile.locations,
                {
                  id: newProfileId(),
                  name: '',
                  label: '',
                  description: '',
                  scope: 'cemetery',
                  coordinates: null,
                  precision: 'unmapped',
                  sourceIds: [],
                  coordinateSourceIds: [],
                  locationNote: '',
                },
              ],
            })
          }
        >
          Add location
        </button>
      </section>
    </div>
  );
}
export function ProfileEditor({ initialPersonId }: { initialPersonId?: string }) {
  const [published, setPublished] = useState<PublishedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<CommunitySession | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [profile, setProfile] = useState<PersonProfile>(emptyProfile);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [preview, setPreview] = useState(false);
  const [privateName, setPrivateName] = useState('');
  const [email, setEmail] = useState('');
  const [publicCredit, setPublicCredit] = useState('');
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const request = useRef({ id: '', token: '', signature: '' });
  const unsavedChanges = useRef(dirty);
  unsavedChanges.current = dirty;
  const mediaUrls = useProfileMedia(profile, files);
  useEffect(() => {
    let active = true;
    void Promise.all([
      profileRequest<{ profiles: PublishedProfile[] }>('published'),
      communityRequest<CommunitySession>('/session'),
    ])
      .then(([data, access]) => {
        if (!active) return;
        setPublished(data.profiles);
        setSession(access);
        setPrivateName(access.user?.name ?? '');
        setEmail(access.user?.email ?? '');
        const initial = data.profiles.find((item) => item.id === initialPersonId);
        if (initial) {
          setChoice(initial.id);
          setProfile(structuredClone(initial.profile));
        }
      })
      .catch((failure) => setError(failure.message))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialPersonId]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!unsavedChanges.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const select = (id: string) => {
    if (dirty && !window.confirm('Discard your unsubmitted profile changes?')) return;
    setChoice(id);
    setProfile(
      id === 'new'
        ? { ...emptyProfile(), name: search }
        : structuredClone(published.find((item) => item.id === id)!.profile),
    );
    setFiles({});
    setDirty(false);
    setPreview(false);
    setError('');
  };
  const change = (next: PersonProfile) => {
    setProfile(next);
    setDirty(true);
  };
  async function submit() {
    setError('');
    const base = published.find((item) => item.id === choice);
    const details = {
      personId: base?.id ?? null,
      baseVersion: base?.version ?? null,
      profile,
      privateName,
      email,
      publicCredit,
      permission,
    };
    const attempt = prepareProfileAttempt(details, files, request.current, newProfileId);
    request.current = attempt.request;
    if (attempt.details.profile !== profile) {
      setProfile(attempt.details.profile);
      setFiles(attempt.files);
    }
    const payload = {
      ...attempt.details,
      requestId: attempt.request.id,
      receiptToken: attempt.request.token,
    };
    const valid = profileSubmissionSchema.safeParse(payload);
    if (!valid.success) {
      setError(
        valid.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      );
      return;
    }
    setBusy(true);
    try {
      const result = await profileRequest<{ id: string }>('submissions', {
        method: 'POST',
        body: profileMultipart(valid.data, attempt.files, attempt.details.profile),
      });
      // The unload event can fire before React removes the dirty-state listener.
      unsavedChanges.current = false;
      setDirty(false);
      window.location.assign(submissionReceiptUrl(result.id, attempt.request.token));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'The profile could not be submitted. Your changes remain on this page.',
      );
      setBusy(false);
    }
  }
  if (loading) return <p role="status">Loading published people…</p>;
  return (
    <div className="profile-editor">
      {error && (
        <CommunityNotice title="Please check your profile" kind="error">
          <p className="profile-error">{error}</p>
        </CommunityNotice>
      )}
      <section className="community-section">
        <h2>Choose a person</h2>
        <p className="community-section-note">
          Select a published person to propose a complete replacement, or explicitly create a new
          person. Names are never merged automatically.
        </p>
        <Field label="Find a person by name">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <div className="profile-person-results">
          {published
            .filter((item) => item.profile.name.toLowerCase().includes(search.toLowerCase()))
            .slice(0, 12)
            .map((item) => (
              <button
                type="button"
                aria-pressed={choice === item.id}
                key={item.id}
                onClick={() => select(item.id)}
              >
                <>
                  {item.profile.portrait && (
                    <img
                      className="profile-person-thumbnail"
                      alt=""
                      src={
                        item.profile.portrait.mediaId
                          ? profileMediaUrl(item.profile.portrait.mediaId)
                          : safeProfileHref(item.profile.portrait.url)
                      }
                    />
                  )}
                  <strong>{item.profile.name}</strong>
                </>
                <span>
                  {item.profile.birthYear ?? '?'} – {item.profile.deathYear ?? '?'}
                </span>
              </button>
            ))}
        </div>
        <button
          type="button"
          className="community-secondary"
          aria-pressed={choice === 'new'}
          onClick={() => select('new')}
        >
          Create a new person
        </button>
      </section>
      {choice && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="profile-editor-status">
            <p>
              <strong>
                {choice === 'new'
                  ? 'New person proposal'
                  : `Complete replacement of ${published.find((item) => item.id === choice)?.profile.name}`}
              </strong>
              <br />
              Changes and files stay on this page until you submit. Closing or reloading loses
              unsubmitted work.
            </p>
            <button
              type="button"
              className="community-secondary"
              onClick={() => setPreview(!preview)}
            >
              {preview ? 'Continue editing' : 'Preview profile'}
            </button>
          </div>
          {preview ? (
            <div className="profile-preview">
              <p className="community-hint">Public profile preview</p>
              <ProfileView profile={profile} mediaUrls={mediaUrls} publicCredit={publicCredit} />
            </div>
          ) : (
            <ProfileFields
              profile={profile}
              onChange={change}
              files={files}
              onFilesChange={(next) => {
                setFiles(next);
                setDirty(true);
              }}
            />
          )}
          <section className="community-section">
            <h2>Your details and permission</h2>
            <p className="community-section-note">
              Your name and email are private. Public credit is your choice and is never copied from
              your contact name.
            </p>
            {!session?.user && (
              <p className="community-hint">
                <Link href="/sign-in?next=/contribute">Sign in</Link> to follow submissions in your
                account, or continue as a guest and keep your receipt link.
              </p>
            )}
            <div className="community-fields">
              <Field label="Private contact name">
                <input
                  required
                  value={privateName}
                  onChange={(e) => setPrivateName(e.target.value)}
                />
              </Field>
              <Field label="Private email">
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field
                label="Public contributor credit"
                hint="Enter the credit to publish with this proposal; use Anonymous if preferred."
              >
                <input
                  required
                  value={publicCredit}
                  onChange={(e) => setPublicCredit(e.target.value)}
                />
              </Field>
              <label className="community-check">
                <input
                  required
                  type="checkbox"
                  checked={permission}
                  onChange={(e) => setPermission(e.target.checked)}
                />
                <span>
                  I have permission to share this text and evidence for public publication, and
                  understand that archive reviewers decide what is published.
                </span>
              </label>
            </div>
          </section>
          <div className="community-actions">
            <button
              type="button"
              className="community-secondary"
              onClick={() => setPreview(!preview)}
            >
              {preview ? 'Continue editing' : 'Preview profile'}
            </button>
            <button type="submit" disabled={busy} className="community-primary">
              {busy ? 'Submitting profile…' : 'Submit profile for review'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
