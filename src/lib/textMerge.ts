import { applyPatch, merge } from 'diff';

/**
 * Line-based three-way merge for plain-text documents (Phase 3 of the document
 * session & collaboration plan). Given a common `base` and two divergent
 * versions (`ours` = the dirty local content, `theirs` = the incoming remote
 * content), it returns the merged text when the two sides changed disjoint
 * regions, or `null` when their edits overlap and a human must reconcile them.
 *
 * This mirrors the backend's non-overlapping auto-merge (`write_note` with
 * `base_content`) on the frontend so a dirty note can absorb a clean remote
 * change without forcing the user to choose. It is intentionally format-blind
 * (operates on lines) and is injected into the note session controller as
 * `mergeRemote`; structured documents keep their own entity-level strategies.
 */
export function mergeText(base: string, ours: string, theirs: string): string | null {
  // Fast paths: if one side is unchanged from the base, the other side wins
  // outright. This avoids jsdiff quirks around trailing-newline-only deltas.
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  if (ours === theirs) return ours;

  // jsdiff signature is merge(mine, theirs, base). A conflicting hunk contains
  // line entries that are objects ({ conflict, mine, theirs }) rather than
  // plain strings; any such entry means the edits overlapped.
  const patch = merge(ours, theirs, base);
  const hasConflict = patch.hunks.some((hunk) =>
    hunk.lines.some((line) => typeof line !== 'string'),
  );
  if (hasConflict) return null;

  const applied = applyPatch(base, patch as never);
  return applied === false ? null : applied;
}
