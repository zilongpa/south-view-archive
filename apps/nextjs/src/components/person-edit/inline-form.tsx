'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, ImagePlus, Trash2, X } from 'lucide-react';
import { RecordPicker } from '../record-picker';
import {
  defaultBlockTitle,
  validateBlock,
  MAX_BLOCK_PHOTOS,
  type BlockIssue,
  type EditBlock,
  type EditKind,
  type EditPhotoDraft,
  type EditSection,
} from '@/lib/person-edit';
import type { RecordOption } from '@/lib/record-options';

const prompts: Record<
  EditSection,
  { heading: string; body: string; bodyHint: string; context?: string }
> = {
  biography: {
    heading: 'Add to their story',
    body: 'What should be added?',
    bodyHint: 'Write it as you would like readers to see it. Reviewers may lightly edit.',
    context: 'How do you know this? A source, a relative, your own memory…',
  },
  places: {
    heading: 'Add a place',
    body: 'How was this place part of their life?',
    bodyHint: 'A home, a church, a workplace, a school, or where they are buried.',
    context: 'How do you know this?',
  },
  community: {
    heading: 'Add a memory or photograph',
    body: 'Your memory',
    bodyHint: 'In your own words. A memory can be personal; it does not need to be proven.',
    context: 'Your connection to this person',
  },
  portrait: {
    heading: 'Add a photograph',
    body: 'Tell us about this photograph',
    bodyHint: 'Who is in it, where it was taken, and roughly when, if you know.',
  },
};

function emptyBlock(section: EditSection, kind: EditKind, anchor?: string): EditBlock {
  return {
    id: crypto.randomUUID(),
    section,
    kind,
    anchor,
    title: '',
    body: '',
    context: '',
    placeIds: [],
    proposedPlaceName: '',
    photos: [],
  };
}

export function InlineForm({
  section,
  kind,
  anchor,
  initial,
  personName,
  places,
  onSave,
  onCancel,
}: {
  section: EditSection;
  kind: EditKind;
  anchor?: string;
  initial?: EditBlock;
  personName: string;
  places: RecordOption[];
  onSave: (block: EditBlock) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [block, setBlock] = useState<EditBlock>(() => initial ?? emptyBlock(section, kind, anchor));
  const [issues, setIssues] = useState<BlockIssue[]>([]);
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  const prompt = prompts[section];
  const issue = (field: BlockIssue['field']) =>
    issues.find((item) => item.field === field)?.message;
  const patch = (changes: Partial<EditBlock>) => {
    setBlock((current) => ({ ...current, ...changes }));
    if (issues.length) setIssues([]);
  };
  const allowPhotos = section === 'community' || section === 'portrait';
  function addPhotos(files: FileList | null) {
    if (!files) return;
    const chosen = [...files];
    if (block.photos.length + chosen.length > MAX_BLOCK_PHOTOS) {
      setIssues([{ field: 'photos', message: `Use at most ${MAX_BLOCK_PHOTOS} photographs.` }]);
      return;
    }
    const invalid = chosen.find(
      (file) =>
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 10 * 1024 * 1024,
    );
    if (invalid) {
      setIssues([
        { field: 'photos', message: `${invalid.name}: use JPEG, PNG, or WebP of 10 MB or less.` },
      ]);
      return;
    }
    patch({
      photos: [
        ...block.photos,
        ...chosen.map(
          (file): EditPhotoDraft => ({
            clientPhotoId: crypto.randomUUID(),
            file,
            name: file.name,
            preview: URL.createObjectURL(file),
            metadata: { caption: '', creator: '', rights: '', permission: false },
          }),
        ),
      ],
    });
  }
  function updatePhoto(index: number, changes: Partial<EditPhotoDraft['metadata']>) {
    patch({
      photos: block.photos.map((photo, i) =>
        i === index ? { ...photo, metadata: { ...photo.metadata, ...changes } } : photo,
      ),
    });
  }
  function removePhoto(index: number) {
    const photo = block.photos[index];
    if (photo?.file) URL.revokeObjectURL(photo.preview);
    patch({ photos: block.photos.filter((_, i) => i !== index) });
  }
  function save() {
    const found = validateBlock(block);
    if (found.length) {
      setIssues(found);
      return;
    }
    onSave(block);
  }
  return (
    <form
      className="person-edit-form"
      aria-label={kind === 'correction' ? 'Suggest a correction' : prompt.heading}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      noValidate
    >
      <div className="person-edit-form-head">
        <strong>{kind === 'correction' ? 'Suggest a correction' : prompt.heading}</strong>
        <button type="button" className="community-text-button" onClick={onCancel}>
          <X size={15} aria-hidden="true" /> Cancel
        </button>
      </div>
      {section === 'places' && (
        <div className={`community-field ${issue('place') ? 'has-error' : ''}`}>
          <RecordPicker
            label="Which place?"
            options={places}
            value={block.placeIds}
            onChange={(ids) => patch({ placeIds: ids.slice(0, 1) })}
            placeholder="Search places on the map…"
          />
          <label className="community-field" style={{ marginTop: 8 }}>
            <span>
              Or name a place not on the map yet <span className="community-hint">(optional)</span>
            </span>
            <input
              value={block.proposedPlaceName}
              onChange={(event) => patch({ proposedPlaceName: event.target.value })}
              maxLength={160}
              placeholder="Wheat Street Baptist Church, Atlanta"
            />
          </label>
          {issue('place') && (
            <small className="community-field-error" role="alert">
              {issue('place')}
            </small>
          )}
        </div>
      )}
      {allowPhotos && (
        <div className={`community-field ${issue('photos') ? 'has-error' : ''}`}>
          <span>
            Photographs{' '}
            <span className="community-hint">
              {section === 'portrait' ? '*' : '(optional, up to five)'}
            </span>
          </span>
          <label className="person-edit-upload">
            <ImagePlus size={18} aria-hidden="true" /> Choose photographs
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple={section !== 'portrait'}
              onChange={(event) => {
                addPhotos(event.target.files);
                event.target.value = '';
              }}
              disabled={block.photos.length >= MAX_BLOCK_PHOTOS}
            />
          </label>
          {block.hadPhotos && !block.photos.length && (
            <small className="community-hint">
              Photographs from your earlier draft could not be restored; choose them again.
            </small>
          )}
          {block.photos.map((photo, index) => (
            <div className="person-edit-photo" key={photo.clientPhotoId}>
              <img src={photo.preview} alt="" />
              <div className="community-fields" style={{ gap: 8 }}>
                <label className="community-field">
                  <span>Caption *</span>
                  <input
                    value={photo.metadata.caption}
                    maxLength={500}
                    placeholder="The Hill family at the South-View gate, about 1960"
                    onChange={(event) => updatePhoto(index, { caption: event.target.value })}
                  />
                </label>
                <label className="community-field">
                  <span>Photographer or creator *</span>
                  <input
                    value={photo.metadata.creator}
                    maxLength={160}
                    placeholder="Ruth Hill, or “family collection”, or “unknown”"
                    onChange={(event) => updatePhoto(index, { creator: event.target.value })}
                  />
                </label>
                <label className="community-field">
                  <span>Rights and permission *</span>
                  <input
                    value={photo.metadata.rights}
                    maxLength={1000}
                    placeholder="Owned by our family; South-View may display it online"
                    onChange={(event) => updatePhoto(index, { rights: event.target.value })}
                  />
                </label>
                <label className="community-check">
                  <input
                    type="checkbox"
                    checked={photo.metadata.permission}
                    onChange={(event) => updatePhoto(index, { permission: event.target.checked })}
                  />
                  <span>I have permission for South-View to display this photograph.</span>
                </label>
                <button
                  type="button"
                  className="community-text-button"
                  onClick={() => removePhoto(index)}
                >
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </button>
              </div>
            </div>
          ))}
          {issue('photos') && (
            <small className="community-field-error" role="alert">
              {issue('photos')}
            </small>
          )}
        </div>
      )}
      <label className={`community-field ${issue('body') ? 'has-error' : ''}`}>
        <span>
          {kind === 'correction' ? 'What is wrong, and what should it say?' : prompt.body}{' '}
          <span className="community-required">*</span>
        </span>
        <textarea
          ref={first}
          value={block.body}
          rows={section === 'biography' ? 6 : 4}
          maxLength={20000}
          onChange={(event) => patch({ body: event.target.value })}
          placeholder={
            kind === 'correction'
              ? 'The paragraph says 1898; family records give 1899 for her birth.'
              : undefined
          }
        />
        {issue('body') && (
          <small className="community-field-error" role="alert">
            {issue('body')}
          </small>
        )}
        <small>{prompt.bodyHint}</small>
      </label>
      {prompt.context && (
        <label className="community-field">
          <span>
            {prompt.context} <span className="community-hint">(optional)</span>
          </span>
          <input
            value={block.context}
            maxLength={4000}
            onChange={(event) => patch({ context: event.target.value })}
            placeholder="She was my great-aunt; my mother told me this at family reunions."
          />
        </label>
      )}
      <label className={`community-field ${issue('title') ? 'has-error' : ''}`} htmlFor={`${id}-t`}>
        <span>
          Short title <span className="community-hint">(optional)</span>
        </span>
        <input
          id={`${id}-t`}
          value={block.title}
          maxLength={160}
          onChange={(event) => patch({ title: event.target.value })}
          placeholder={defaultBlockTitle(block, personName)}
        />
        {issue('title') && (
          <small className="community-field-error" role="alert">
            {issue('title')}
          </small>
        )}
      </label>
      <div className="community-actions" style={{ marginTop: 4 }}>
        <button className="community-primary" type="submit">
          {initial ? 'Save changes' : 'Add to page'} <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
