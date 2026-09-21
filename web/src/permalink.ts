/**
 * Permalinks for a single report or a single protected tree.
 *
 * The address is a query parameter rather than a path so that the static
 * assets keep answering every URL on their own: `/?report=<ULID>` and
 * `/?tree=<id>` are both the index document, and no Worker route is involved.
 * A hash would be invisible to any server-side reader, which a shared link
 * should not be.
 *
 * Nothing here touches the DOM or history, so the rules stay testable and the
 * page only has to hand over `location.search` or `location.href`.
 */

export const REPORT_PARAM = 'report';
export const TREE_PARAM = 'tree';

export type PermalinkTarget =
  | { readonly kind: 'report'; readonly id: string }
  | { readonly kind: 'tree'; readonly id: string };

/**
 * Crockford base32 without I, L, O and U, 26 characters: the shape produced by
 * the Worker's ULID generator. Lower case is accepted because a link can pass
 * through a reader that folds case, and is normalised back to upper case.
 */
const ULID = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

/** Protected tree numbers are digits, matching the shared report validation. */
const TREE_ID = /^[0-9]{1,10}$/;

function reportId(raw: string): string | null {
  const id = raw.trim().toUpperCase();
  return ULID.test(id) ? id : null;
}

function treeId(raw: string): string | null {
  const id = raw.trim();
  return TREE_ID.test(id) ? id : null;
}

/**
 * The target a query string names, or null when it names none.
 *
 * A URL carrying both parameters is answered with the report: a report is the
 * more specific thing to point at, and a card can only show one of them.
 */
export function parsePermalink(search: string): PermalinkTarget | null {
  const params = new URLSearchParams(search);

  const report = params.get(REPORT_PARAM);
  if (report !== null) {
    const id = reportId(report);
    if (id !== null) {
      return { kind: 'report', id };
    }
  }

  const tree = params.get(TREE_PARAM);
  if (tree !== null) {
    const id = treeId(tree);
    if (id !== null) {
      return { kind: 'tree', id };
    }
  }

  return null;
}

/**
 * The query string for a target, keeping every other parameter that was
 * already there. A null target removes the permalink parameters and leaves
 * the rest alone.
 */
export function permalinkSearch(target: PermalinkTarget | null, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(REPORT_PARAM);
  params.delete(TREE_PARAM);
  if (target !== null) {
    params.set(target.kind === 'report' ? REPORT_PARAM : TREE_PARAM, target.id);
  }
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/** The absolute URL to share, derived from the page the reader is on. */
export function permalinkUrl(target: PermalinkTarget, href: string): string {
  const url = new URL(href);
  url.search = permalinkSearch(target, url.search);
  return url.toString();
}
