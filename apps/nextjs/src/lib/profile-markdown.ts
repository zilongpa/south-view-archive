/** Small, deliberately non-HTML Markdown grammar shared by every profile view. */
export function safeProfileHref(value?: string): string | undefined {
  if (!value || /[\u0000-\u0020\\]/.test(value)) return;
  if ((value.startsWith('/') && !value.startsWith('//')) || value.startsWith('#')) return value;
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol)) return url.href;
  } catch {
    /* Render unsafe destinations as text. */
  }
}
export type ProfileBlock =
  | { kind: 'heading'; level: 2 | 3 | 4; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string };
export function parseProfileMarkdown(body: string): ProfileBlock[] {
  const result: ProfileBlock[] = [];
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!.trim();
    if (!line) {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      result.push({
        kind: 'heading',
        level: Math.min(4, Math.max(2, heading[1]!.length)) as 2 | 3 | 4,
        text: heading[2]!,
      });
      i++;
      continue;
    }
    const list = /^(?:([-*+])|\d+\.)\s+(.+)$/.exec(line);
    if (list) {
      const ordered = !list[1];
      const items: string[] = [];
      while (i < lines.length) {
        const match = /^(?:([-*+])|\d+\.)\s+(.+)$/.exec(lines[i]!.trim());
        if (!match || !match[1] !== ordered) break;
        items.push(match[2]!);
        i++;
      }
      result.push({ kind: 'list', ordered, items });
      continue;
    }
    if (line.startsWith('> ')) {
      result.push({ kind: 'quote', text: line.slice(2) });
      i++;
      continue;
    }
    const paragraph = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/.test(lines[i]!.trim())
    )
      paragraph.push(lines[i++]!.trim());
    result.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }
  return result;
}
export type ProfileInline =
  | { kind: 'text' | 'citation' | 'strong' | 'emphasis' | 'code'; value: string }
  | { kind: 'link'; value: string; href: string };
export function tokenizeProfileInline(text: string): ProfileInline[] {
  const parts: ProfileInline[] = [];
  const pattern =
    /\[\^([^\]\n]+)\]|\[source:([^\]\n]+)\]|(!?\[([^\]\n]+)\]\(([^\s)]+)\))|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > end) parts.push({ kind: 'text', value: text.slice(end, match.index) });
    if (match[1] || match[2]) parts.push({ kind: 'citation', value: match[1] || match[2]! });
    else if (match[3]) {
      const href = safeProfileHref(match[5]);
      parts.push(
        href && !match[3].startsWith('!')
          ? { kind: 'link', value: match[4]!, href }
          : { kind: 'text', value: match[0] },
      );
    } else
      parts.push({
        kind: match[6] ? 'strong' : match[7] ? 'emphasis' : 'code',
        value: match[6] || match[7] || match[8]!,
      });
    end = match.index + match[0].length;
  }
  if (end < text.length) parts.push({ kind: 'text', value: text.slice(end) });
  return parts;
}
