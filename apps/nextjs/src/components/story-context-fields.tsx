'use client';
import { useId } from 'react';
import type { EventDate } from '@southview/validators';

export type StoryContext = { relatedPersonIds: string[]; placeIds: string[]; eventDate: EventDate };
export function StoryContextFields({
  people,
  places,
  primaryPersonId,
  value,
  onChange,
}: {
  people: { id: string; name: string }[];
  places: { id: string; name: string }[];
  primaryPersonId: string;
  value: StoryContext;
  onChange: (next: StoryContext) => void;
}) {
  const id = useId();
  const toggle = (field: 'relatedPersonIds' | 'placeIds', item: string) =>
    onChange({
      ...value,
      [field]: value[field].includes(item)
        ? value[field].filter((v) => v !== item)
        : [...value[field], item],
    });
  const date = value.eventDate;
  return (
    <div className="story-context-fields">
      <fieldset>
        <legend>
          Other people in this story <span className="community-hint">(optional)</span>
        </legend>
        <div className="story-context-options">
          {people
            .filter((person) => person.id !== primaryPersonId)
            .map((person) => (
              <label key={person.id}>
                <input
                  type="checkbox"
                  checked={value.relatedPersonIds.includes(person.id)}
                  onChange={() => toggle('relatedPersonIds', person.id)}
                />
                {person.name}
              </label>
            ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>
          Places mentioned <span className="community-hint">(optional)</span>
        </legend>
        <div className="story-context-options">
          {places.map((place) => (
            <label key={place.id}>
              <input
                type="checkbox"
                checked={value.placeIds.includes(place.id)}
                onChange={() => toggle('placeIds', place.id)}
              />
              {place.name}
            </label>
          ))}
        </div>
        <p className="community-hint">
          Choose places this material is about. Reviewers confirm these links; they do not establish
          a precise location.
        </p>
      </fieldset>
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
