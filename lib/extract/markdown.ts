import TurndownService from 'turndown';

/**
 * HTML to markdown, matching how agent-facing tooling actually converts pages:
 * ATX headings, fenced code, hyphen bullets.
 *
 * Turndown resolves a DOM implementation itself — the real one in a browser,
 * domino under Node — so this works in the side panel and in tests unchanged.
 */

let service: TurndownService | null = null;

function createService(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    hr: '---',
  });

  // Chrome strips these from the rendered DOM anyway; leaving them in would
  // inflate the agent's apparent content with code it never reads as prose.
  turndown.remove(['script', 'style', 'noscript', 'template', 'iframe']);

  addTableRule(turndown);
  return turndown;
}

/**
 * Turndown has no table support out of the box — it walks the cells and emits
 * run-on text. Pricing and spec tables are exactly the content that decides
 * whether an agent answers a question correctly, so flattening them would
 * misrepresent what the agent actually reads.
 */
function addTableRule(turndown: TurndownService): void {
  const cellText = (cell: Element): string =>
    (cell.textContent ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

  const rowCells = (row: Element): string[] =>
    Array.from(row.querySelectorAll('th, td')).map(cellText);

  turndown.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const table = node as unknown as Element;
      const rows = Array.from(table.querySelectorAll('tr'))
        .map(rowCells)
        .filter((cells) => cells.length > 0);
      if (rows.length === 0) return '';

      const width = Math.max(...rows.map((r) => r.length));
      const pad = (cells: string[]) => {
        const padded = [...cells];
        while (padded.length < width) padded.push('');
        return `| ${padded.join(' | ')} |`;
      };

      const [header, ...body] = rows;
      const lines = [pad(header ?? []), `| ${Array(width).fill('---').join(' | ')} |`];
      for (const row of body) lines.push(pad(row));
      return `\n\n${lines.join('\n')}\n\n`;
    },
  });
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  service ??= createService();
  try {
    return tidy(service.turndown(html));
  } catch (err) {
    console.warn('[ViewAsAgent] markdown conversion failed:', err);
    return '';
  }
}

/** Collapse the runs of blank lines Turndown leaves between blocks. */
function tidy(markdown: string): string {
  return markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}
