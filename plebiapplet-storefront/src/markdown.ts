/**
 * Minimal markdown renderer for listing descriptions.
 *
 * Output is built as DOM nodes, so raw HTML in listing content is rendered as
 * literal text and can never execute (SPEC 8, 11). Links are handed to NAP-LINK
 * and images to NAP-RESOURCE; nothing here navigates or fetches on its own.
 */
import { el } from './dom';

/** Callbacks that route markdown's outbound references to the right NAP. */
export interface MarkdownHandlers {
  /** Called when the reader activates a link. */
  onLink: (url: string) => void;
  /** Called to fill an image host through the resource pipeline. */
  mountImage: (host: HTMLElement, url: string, alt: string) => void;
}

const INLINE = /(!?\[[^\]\n]*\]\([^)\s]+\))|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(`[^`\n]+`)/;
const LINK_PARTS = /^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/;

function linkUrl(raw: string): string | null {
  return /^https?:\/\//i.test(raw.trim()) ? raw.trim() : null;
}

function imageUrl(raw: string): string | null {
  return /^(https?|blossom|nostr):/i.test(raw.trim()) ? raw.trim() : null;
}

function renderInline(text: string, handlers: MarkdownHandlers): Node[] {
  const nodes: Node[] = [];
  let rest = text;

  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match || match.index === undefined) break;
    if (match.index > 0) nodes.push(document.createTextNode(rest.slice(0, match.index)));
    const token = match[0];
    rest = rest.slice(match.index + token.length);

    const link = LINK_PARTS.exec(token);
    if (link) {
      const [, bang, label, target] = link;
      if (bang === '!') {
        const url = imageUrl(target);
        const host = el('span', { class: 'md-image' });
        if (url) handlers.mountImage(host, url, label || 'image');
        else host.textContent = label;
        nodes.push(host);
      } else {
        const url = linkUrl(target);
        if (url) {
          nodes.push(
            el('button', {
              class: 'md-link',
              type: 'button',
              text: label || url,
              title: url,
              on: { click: () => handlers.onLink(url) },
            }),
          );
        } else {
          nodes.push(document.createTextNode(label || target));
        }
      }
      continue;
    }

    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(el('strong', { text: token.slice(2, -2) }));
    } else if (token.startsWith('`')) {
      nodes.push(el('code', { text: token.slice(1, -1) }));
    } else {
      nodes.push(el('em', { text: token.slice(1, -1) }));
    }
  }

  if (rest.length > 0) nodes.push(document.createTextNode(rest));
  return nodes;
}

function flushList(
  fragment: DocumentFragment,
  items: string[],
  ordered: boolean,
  handlers: MarkdownHandlers,
): void {
  if (items.length === 0) return;
  const list = el(ordered ? 'ol' : 'ul', { class: 'md-list' });
  for (const item of items) list.append(el('li', {}, renderInline(item, handlers)));
  fragment.append(list);
  items.length = 0;
}

function flushParagraph(
  fragment: DocumentFragment,
  lines: string[],
  handlers: MarkdownHandlers,
): void {
  if (lines.length === 0) return;
  fragment.append(el('p', { class: 'md-p' }, renderInline(lines.join(' '), handlers)));
  lines.length = 0;
}

/** Render markdown source into a detached fragment of safe DOM nodes. */
export function renderMarkdown(source: string, handlers: MarkdownHandlers): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const paragraph: string[] = [];
  const listItems: string[] = [];
  let listOrdered = false;
  let codeLines: string[] | null = null;

  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');

    if (line.trim().startsWith('```')) {
      if (codeLines) {
        fragment.append(el('pre', { class: 'md-code' }, [el('code', { text: codeLines.join('\n') })]));
        codeLines = null;
      } else {
        flushParagraph(fragment, paragraph, handlers);
        flushList(fragment, listItems, listOrdered, handlers);
        codeLines = [];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(rawLine);
      continue;
    }

    if (line.trim() === '') {
      flushParagraph(fragment, paragraph, handlers);
      flushList(fragment, listItems, listOrdered, handlers);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(fragment, paragraph, handlers);
      flushList(fragment, listItems, listOrdered, handlers);
      const level = Math.min(6, Math.max(3, heading[1].length + 2));
      const tag = `h${level}` as 'h3' | 'h4' | 'h5' | 'h6';
      fragment.append(el(tag, { class: 'md-h' }, renderInline(heading[2], handlers)));
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushParagraph(fragment, paragraph, handlers);
      flushList(fragment, listItems, listOrdered, handlers);
      fragment.append(el('hr', { class: 'md-hr' }));
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph(fragment, paragraph, handlers);
      flushList(fragment, listItems, listOrdered, handlers);
      fragment.append(el('blockquote', { class: 'md-quote' }, renderInline(quote[1], handlers)));
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph(fragment, paragraph, handlers);
      const ordered = Boolean(numbered);
      if (ordered !== listOrdered) {
        flushList(fragment, listItems, listOrdered, handlers);
        listOrdered = ordered;
      }
      listItems.push((bullet ?? numbered)![1]);
      continue;
    }

    flushList(fragment, listItems, listOrdered, handlers);
    paragraph.push(line.trim());
  }

  if (codeLines) {
    fragment.append(el('pre', { class: 'md-code' }, [el('code', { text: codeLines.join('\n') })]));
  }
  flushParagraph(fragment, paragraph, handlers);
  flushList(fragment, listItems, listOrdered, handlers);
  return fragment;
}
