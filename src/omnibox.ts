import type { BoardRowView } from './view';

export interface OmniboxSuggestion {
  content: string;
  description: string;
}

/** The omnibox renders a small XML dialect, so text from Amazon must be escaped. */
export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function matches(row: BoardRowView, query: string): boolean {
  if (!query) return true;
  const haystack = [row.code, row.domain, row.account, row.status].join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** One line per marketplace, for `amz` in the address bar. Selecting one opens that marketplace. */
export function omniboxSuggestions(rows: BoardRowView[], query: string): OmniboxSuggestion[] {
  return rows
    .filter((row) => matches(row, query.trim()))
    .map((row) => {
      const who = row.account ? `  ${escapeXml(row.account)}` : '';
      const when = row.time ? `  <dim>checked ${row.time}</dim>` : '';
      return {
        content: row.domain,
        description: `<match>${row.code}</match>  <url>${row.domain}</url>  ${escapeXml(row.status)}${who}${when}`,
      };
    });
}
