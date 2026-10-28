import type { PersonProfile, ProfileSource } from '@southview/validators';
import {
  parseProfileMarkdown,
  safeProfileHref,
  tokenizeProfileInline,
} from '../lib/profile-markdown';
import './profile.css';

export function profileMediaUrl(mediaId: string) {
  return `/api/profiles/media/${encodeURIComponent(mediaId)}`;
}
function SourceMarks({
  ids,
  sources,
  anchorPrefix = '',
}: {
  ids: string[];
  sources: ProfileSource[];
  anchorPrefix?: string;
}) {
  return (
    <span className="profile-citations">
      {ids.map((id) => {
        const number = sources.findIndex((source) => source.id === id) + 1;
        return number ? (
          <a
            key={id}
            href={`#${encodeURIComponent(anchorPrefix + 'source-' + id)}`}
            title={sources[number - 1]!.title}
          >
            [{number}]
          </a>
        ) : null;
      })}
    </span>
  );
}
function Inline({
  text,
  sources,
  anchorPrefix = '',
}: {
  text: string;
  sources: ProfileSource[];
  anchorPrefix?: string;
}) {
  return tokenizeProfileInline(text).map((part, i) => {
    if (part.kind === 'citation')
      return (
        <SourceMarks key={i} ids={[part.value]} sources={sources} anchorPrefix={anchorPrefix} />
      );
    if (part.kind === 'link')
      return (
        <a key={i} href={part.href} rel="noopener noreferrer">
          {part.value}
        </a>
      );
    if (part.kind === 'strong') return <strong key={i}>{part.value}</strong>;
    if (part.kind === 'emphasis') return <em key={i}>{part.value}</em>;
    if (part.kind === 'code') return <code key={i}>{part.value}</code>;
    return part.value;
  });
}
export function ProfileBody({
  body,
  sources,
  anchorPrefix = '',
}: {
  body: string;
  sources: ProfileSource[];
  anchorPrefix?: string;
}) {
  return (
    <div className="profile-prose">
      {parseProfileMarkdown(body).map((block, i) => {
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List key={i}>
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inline text={item} sources={sources} anchorPrefix={anchorPrefix} />
                </li>
              ))}
            </List>
          );
        }
        if (block.kind === 'heading') {
          const Heading = `h${block.level}` as 'h2' | 'h3' | 'h4';
          return (
            <Heading key={i}>
              <Inline text={block.text} sources={sources} anchorPrefix={anchorPrefix} />
            </Heading>
          );
        }
        if (block.kind === 'quote')
          return (
            <blockquote key={i}>
              <Inline text={block.text} sources={sources} anchorPrefix={anchorPrefix} />
            </blockquote>
          );
        return (
          <p key={i}>
            <Inline text={block.text} sources={sources} anchorPrefix={anchorPrefix} />
          </p>
        );
      })}
    </div>
  );
}
export function ProfileView({
  profile,
  personId,
  mediaUrls = {},
  anchorPrefix = '',
  publicCredit,
}: {
  profile: PersonProfile;
  personId?: string;
  publicCredit?: string;
  mediaUrls?: Record<string, string>;
  anchorPrefix?: string;
}) {
  const portrait = profile.portrait;
  const portraitUrl = portrait?.mediaId
    ? (mediaUrls[portrait.mediaId] ?? profileMediaUrl(portrait.mediaId))
    : safeProfileHref(portrait?.url);
  return (
    <article className="profile-view" data-person-id={personId}>
      <header className="profile-header">
        <h1>{profile.name || 'Person profile'}</h1>
        {(profile.birthYear !== undefined || profile.deathYear !== undefined) && (
          <p className="profile-years">
            {profile.birthYear ?? '?'} – {profile.deathYear ?? '?'}
          </p>
        )}
        {profile.tags.length > 0 && (
          <ul className="profile-tags">
            {profile.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
        {publicCredit && <p className="profile-evidence">Profile contributor: {publicCredit}</p>}
      </header>
      {portrait && portraitUrl && (
        <figure id={`${anchorPrefix}photo-portrait`} className="profile-portrait">
          <img src={portraitUrl} alt={portrait.alt} />
          <figcaption>
            {portrait.credit}
            <br />
            {portrait.rights}
            <SourceMarks
              ids={portrait.sourceIds}
              sources={profile.sources}
              anchorPrefix={anchorPrefix}
            />
          </figcaption>
        </figure>
      )}
      <section id={`${anchorPrefix}biography`} aria-label="Biography">
        <ProfileBody
          body={profile.bodyMarkdown}
          sources={profile.sources}
          anchorPrefix={anchorPrefix}
        />
        <p className="profile-evidence">
          Body sources{' '}
          <SourceMarks
            ids={profile.bodySourceIds}
            sources={profile.sources}
            anchorPrefix={anchorPrefix}
          />
        </p>
      </section>
      {profile.locations.length > 0 && (
        <section className="profile-section" id={`${anchorPrefix}places`}>
          <h2>Connected places</h2>
          {profile.locations.map((location) => (
            <article className="profile-location" key={location.id}>
              <h3>{location.name}</h3>
              <p>
                <strong>{location.label}</strong>
              </p>
              <p>
                {location.description}{' '}
                <SourceMarks
                  ids={location.sourceIds}
                  sources={profile.sources}
                  anchorPrefix={anchorPrefix}
                />
              </p>
              {location.address && <p>{location.address}</p>}
              <p className="profile-evidence">
                {location.scope === 'cemetery' ? 'South-View Cemetery' : 'Atlanta'}
                {personId && location.coordinates && (
                  <>
                    {' · '}
                    <a
                      href={`/explore?scope=${location.scope}&person=${encodeURIComponent(personId)}&place=${encodeURIComponent(`${personId}:${location.id}`)}`}
                    >
                      View on map
                    </a>
                  </>
                )}
              </p>
            </article>
          ))}
        </section>
      )}
      <section className="profile-section" id={`${anchorPrefix}sources`}>
        <h2>Sources and evidence</h2>
        <ol className="profile-sources">
          {profile.sources.map((source) => {
            const href = source.mediaId
              ? (mediaUrls[source.mediaId] ?? profileMediaUrl(source.mediaId))
              : safeProfileHref(source.url);
            return (
              <li key={source.id} id={`${anchorPrefix}source-${source.id}`}>
                <strong>
                  {href ? (
                    <a href={href} rel="noopener noreferrer">
                      {source.title}
                    </a>
                  ) : (
                    source.title
                  )}
                </strong>
                <p>
                  {[
                    source.kind === 'memory' ? 'Firsthand recollection' : null,
                    source.creator,
                    source.locator,
                    source.rights,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            );
          })}
        </ol>
      </section>
    </article>
  );
}
