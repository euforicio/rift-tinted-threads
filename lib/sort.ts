import type { PluginSidebarThread } from "@riftlabs/plugin-sdk/app";
import { threadTitle } from "./thread-title";
import type { SortBy } from "./settings";

export type ThreadComparator = (
  left: PluginSidebarThread,
  right: PluginSidebarThread,
) => number;

function compareById(left: PluginSidebarThread, right: PluginSidebarThread): number {
  return left.id.localeCompare(right.id);
}

export function createThreadComparator(
  sortBy: SortBy,
  orderRank?: ReadonlyMap<string, number>,
): ThreadComparator {
  switch (sortBy) {
    case "updated":
      return (left, right) =>
        right.updatedAt - left.updatedAt || compareById(left, right);
    case "attention":
      return (left, right) =>
        right.latestAttentionAt - left.latestAttentionAt ||
        compareById(left, right);
    case "manual":
      return (left, right) => {
        const leftRank = orderRank?.get(left.id);
        const rightRank = orderRank?.get(right.id);
        // Rows absent from the saved order are freshly created: float them to
        // the top (newest first) so they're easy to find and drag into place.
        if (leftRank === undefined && rightRank === undefined) {
          return right.createdAt - left.createdAt || compareById(left, right);
        }
        if (leftRank === undefined) return -1;
        if (rightRank === undefined) return 1;
        return leftRank - rightRank || compareById(left, right);
      };
    case "alpha":
      return (left, right) => {
        const titleDelta = threadTitle(left)
          .localeCompare(threadTitle(right), undefined, {
            sensitivity: "base",
          });
        return titleDelta !== 0 ? titleDelta : compareById(left, right);
      };
    case "created":
    default:
      return (left, right) =>
        right.createdAt - left.createdAt || compareById(left, right);
  }
}

export function createListComparator(
  sortBy: SortBy,
  pinnedPlacement: "in-group" | "at-top",
  orderRank?: ReadonlyMap<string, number>,
): ThreadComparator {
  const sortThreads = createThreadComparator(sortBy, orderRank);
  if (pinnedPlacement !== "in-group") {
    return sortThreads;
  }
  return (left, right) => {
    if (left.isPinned !== right.isPinned) {
      return left.isPinned ? -1 : 1;
    }
    return sortThreads(left, right);
  };
}
