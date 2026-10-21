'use client';
import { useId } from 'react';
import type { EventDate } from '@southview/validators';
import type { RecordOption } from '@/lib/record-options';
import { RecordPicker } from './record-picker';

export type StoryContext = { relatedPersonIds: string[]; placeIds: string[]; eventDate: EventDate };
export function StoryContextFields({
  people,
  places,
  primaryPersonId,
  value,
  onChange,
}: {
  people: RecordOption[];
  places: RecordOption[];
  primaryPersonId: string;
  value: StoryContext;
  onChange: (next: StoryContext) => void;
}) {
  const id = useId();
  const date = value.eventDate;
  return (
    <div className="story-context-fields">
      <RecordPicker
        label="Other people in this story (optional)"
        multiple
        placeholder="Search names or alternate names…"
        options={people.filter((person) => person.id !== primaryPersonId)}
        value={value.relatedPersonIds.filter((key) => key !== primaryPersonId)}
        onChange={(ids) => onChange({ ...value, relatedPersonIds: ids })}
      />
      <div>
        <RecordPicker
          label="Places mentioned (optional)"
          multiple
          placeholder="Search places…"
          options={places}
          value={value.placeIds}
          onChange={(ids) => onChange({ ...value, placeIds: ids })}
        />
        <p className="community-hint">
          Choose places this material is about. Reviewers confirm these links; they do not establish
          a precise location.
        </p>
      </div>
      <fieldset>
        <legend>When did the event or memory take place?</legend>
        <label className="community-field" htmlFor={`${id}-kind`}>
          <span>Date certainty</span>
          <select
            id={`${id}-kind`}
            value={date.kind}
            onChange={(event) => {
              const kind = event.target.value as EventDate['kind'];
              const year =
                date.kind === 'year' || date.kind === 'approximate'
                  ? date.year
                  : date.kind === 'range'
                    ? date.startYear
                    : 0;
              onChange({
                ...value,
                eventDate:
                  kind === 'unknown'
                    ? { kind }
                    : kind === 'range'
                      ? {
                          kind,
                          startYear: year,
                          endYear: date.kind === 'range' ? date.endYear : year,
                        }
                      : { kind, year },
              });
            }}
          >
            <option value="unknown">I don’t know the date</option>
            <option value="year">Known year</option>
            <option value="approximate">Around a year</option>
            <option value="range">A range of years</option>
          </select>
        </label>
        {date.kind !== 'unknown' && (
          <div className="community-two-columns" style={{ marginTop: 14 }}>
            <label className="community-field">
              <span>{date.kind === 'range' ? 'First year' : 'Year'}</span>
              <input
                type="number"
                min={1}
                max={9999}
                step={1}
                required
                value={(date.kind === 'range' ? date.startYear : date.year) || ''}
                onChange={(event) =>
                  onChange({
                    ...value,
                    eventDate:
                      date.kind === 'range'
                        ? { ...date, startYear: Number(event.target.value) }
                        : { ...date, year: Number(event.target.value) },
                  })
                }
              />
            </label>
            {date.kind === 'range' && (
              <label className="community-field">
                <span>Last year</span>
                <input
                  type="number"
                  min={date.startYear || 1}
                  max={9999}
                  step={1}
                  required
                  value={date.endYear || ''}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      eventDate: { ...date, endYear: Number(event.target.value) },
                    })
                  }
                />
              </label>
            )}
          </div>
        )}
        <p className="community-hint" style={{ marginTop: 10 }}>
          This is when the story happened, separate from when it is submitted or published. An
          approximate or unknown date is welcome.
        </p>
      </fieldset>
    </div>
  );
}
