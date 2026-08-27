export type DropPlacement = "before" | "after";

/** Stable string key for an id order, for cheap equality checks. */
export function orderKey(ids: readonly string[]): string {
  return ids.join("\0");
}

/** A lookup from thread id to its slot in a manual order. */
export function buildOrderRank(
  orderedIds: readonly string[] | null | undefined,
): Map<string, number> {
  const rank = new Map<string, number>();
  if (!orderedIds) return rank;
  orderedIds.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  return rank;
}

/** Move one id relative to another without mutating the source order. */
export function moveId(
  ids: readonly string[],
  movingId: string,
  targetId: string,
  placement: DropPlacement,
): string[] {
  if (
    movingId === targetId ||
    !ids.includes(movingId) ||
    !ids.includes(targetId)
  ) {
    return [...ids];
  }

  const withoutMoving = ids.filter((id) => id !== movingId);
  const targetIndex = withoutMoving.indexOf(targetId);
  const insertionIndex = placement === "after" ? targetIndex + 1 : targetIndex;
  return [
    ...withoutMoving.slice(0, insertionIndex),
    movingId,
    ...withoutMoving.slice(insertionIndex),
  ];
}

/** Move one id by a keyboard-sized step within its own list. */
export function moveIdByOffset(
  ids: readonly string[],
  movingId: string,
  offset: -1 | 1,
): string[] {
  const currentIndex = ids.indexOf(movingId);
  const targetIndex = currentIndex + offset;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ids.length) {
    return [...ids];
  }
  return moveId(
    ids,
    movingId,
    ids[targetIndex]!,
    offset < 0 ? "before" : "after",
  );
}

/**
 * Fold a reordered visible slice back into the full order, leaving every id
 * outside the slice in its original slot. A scoped drag (one project group, or
 * the pinned block) then never scrambles rows the user could not see.
 */
export function mergeVisibleOrder(
  baseIds: readonly string[],
  visibleIds: readonly string[],
): string[] {
  const visibleSet = new Set(visibleIds);
  let visibleIndex = 0;
  return baseIds.map((id) =>
    visibleSet.has(id) ? (visibleIds[visibleIndex++] ?? id) : id,
  );
}
