import type { PluginSidebarProject, PluginSidebarThread } from "@riftlabs/plugin-sdk/app";
import { createListComparator } from "./sort";
import type { ListSettings } from "./settings";
import { threadTitle } from "./thread-title";

export type ThreadRowModel = {
  thread: PluginSidebarThread;
  depth: number;
  isArchivedChild: boolean;
  /** Direct child threads nested under this row in the current view. */
  childThreadCount: number;
  /** True when this row's children are hidden by a user collapse. */
  isCollapsed: boolean;
};

export type ListSection =
  | {
      kind: "pinned";
      title: "Pinned";
      rows: ThreadRowModel[];
    }
  | {
      kind: "project";
      projectId: string;
      projectName: string;
      rows: ThreadRowModel[];
    }
  | {
      kind: "flat";
      title: string | null;
      rows: ThreadRowModel[];
    };

export function matchesSearch(
  thread: PluginSidebarThread,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return threadTitle(thread).toLowerCase().includes(normalized);
}

export function visibleThreadIds(
  threads: readonly PluginSidebarThread[],
  showArchivedChildren: boolean,
): Set<string> {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const visible = new Set(
    threads.filter((thread) => !thread.isArchived).map((thread) => thread.id),
  );

  if (!showArchivedChildren) {
    return visible;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const thread of threads) {
      if (!thread.isArchived || visible.has(thread.id)) continue;
      const parentId = thread.parentThreadId;
      if (parentId && visible.has(parentId)) {
        visible.add(thread.id);
        changed = true;
      }
    }
  }

  for (const id of visible) {
    const thread = byId.get(id);
    if (thread?.isArchived && !thread.parentThreadId) {
      visible.delete(id);
    }
    if (thread?.isArchived && thread.parentThreadId && !visible.has(thread.parentThreadId)) {
      visible.delete(id);
    }
  }

  return visible;
}

export function filterVisibleThreads(
  threads: readonly PluginSidebarThread[],
  settings: Pick<ListSettings, "showArchivedChildren">,
  searchQuery: string,
): PluginSidebarThread[] {
  const ids = visibleThreadIds(threads, settings.showArchivedChildren);
  return threads.filter(
    (thread) => ids.has(thread.id) && matchesSearch(thread, searchQuery),
  );
}

/** Pinned-at-top rows stay flat — no parent/child nesting in the bookmark strip. */
export function flatThreadRows(
  threads: readonly PluginSidebarThread[],
  compareThreads: (
    left: PluginSidebarThread,
    right: PluginSidebarThread,
  ) => number,
): ThreadRowModel[] {
  return [...threads]
    .sort(compareThreads)
    .map((thread) => ({
      thread,
      depth: 0,
      isArchivedChild: thread.isArchived,
      childThreadCount: 0,
      isCollapsed: false,
    }));
}

export function nestedThreadRows(
  threads: readonly PluginSidebarThread[],
  compareThreads: (
    left: PluginSidebarThread,
    right: PluginSidebarThread,
  ) => number,
  collapsedIds?: ReadonlySet<string>,
): ThreadRowModel[] {
  const threadIds = new Set(threads.map((thread) => thread.id));
  const childrenByParent = new Map<string, PluginSidebarThread[]>();
  const roots: PluginSidebarThread[] = [];

  for (const thread of threads) {
    const parentId = thread.parentThreadId;
    if (parentId && threadIds.has(parentId)) {
      const children = childrenByParent.get(parentId) ?? [];
      children.push(thread);
      childrenByParent.set(parentId, children);
    } else {
      roots.push(thread);
    }
  }

  for (const children of childrenByParent.values()) {
    children.sort(compareThreads);
  }
  roots.sort(compareThreads);

  const rows: ThreadRowModel[] = [];
  const seen = new Set<string>();

  function visit(thread: PluginSidebarThread, depth: number) {
    if (seen.has(thread.id)) return;
    seen.add(thread.id);
    const children = childrenByParent.get(thread.id) ?? [];
    const collapsed = children.length > 0 && (collapsedIds?.has(thread.id) ?? false);
    rows.push({
      thread,
      depth,
      isArchivedChild: thread.isArchived,
      childThreadCount: children.length,
      isCollapsed: collapsed,
    });
    if (collapsed) return;
    for (const child of children) {
      visit(child, depth + 1);
    }
  }

  for (const root of roots) {
    visit(root, 0);
  }

  return rows;
}

function projectThreadGroups(
  threads: readonly PluginSidebarThread[],
  projectNameById: ReadonlyMap<string, string>,
  projectOrder: readonly string[],
  compareThreads: (
    left: PluginSidebarThread,
    right: PluginSidebarThread,
  ) => number,
  collapsedIds?: ReadonlySet<string>,
): ListSection[] {
  const threadsByProject = new Map<string, PluginSidebarThread[]>();

  for (const thread of threads) {
    const projectThreads = threadsByProject.get(thread.projectId) ?? [];
    projectThreads.push(thread);
    threadsByProject.set(thread.projectId, projectThreads);
  }

  const orderedProjectIds = [
    ...projectOrder.filter((projectId) => threadsByProject.has(projectId)),
    ...Array.from(threadsByProject.keys()).filter(
      (projectId) => !projectOrder.includes(projectId),
    ),
  ];

  return orderedProjectIds.map((projectId) => ({
    kind: "project" as const,
    projectId,
    projectName: projectNameById.get(projectId) ?? projectId,
    rows: nestedThreadRows(
      threadsByProject.get(projectId) ?? [],
      compareThreads,
      collapsedIds,
    ),
  }));
}

export function buildListSections(
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
  settings: ListSettings,
  searchQuery: string,
  orderRank?: ReadonlyMap<string, number>,
  collapsedIds?: ReadonlySet<string>,
): ListSection[] {
  const visible = filterVisibleThreads(threads, settings, searchQuery);
  const compareThreads = createListComparator(
    settings.sortBy,
    settings.pinnedPlacement,
    orderRank,
  );
  const projectNameById = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  const projectOrder = projects.map((project) => project.id);

  if (settings.pinnedPlacement === "at-top") {
    const pinned = visible.filter((thread) => thread.isPinned);
    const unpinned = visible.filter((thread) => !thread.isPinned);
    const sections: ListSection[] = [];

    if (pinned.length > 0) {
      sections.push({
        kind: "pinned",
        title: "Pinned",
        rows: flatThreadRows(pinned, compareThreads),
      });
    }

    if (settings.groupBy === "project") {
      sections.push(
        ...projectThreadGroups(
          unpinned,
          projectNameById,
          projectOrder,
          compareThreads,
          collapsedIds,
        ),
      );
    } else if (unpinned.length > 0) {
      sections.push({
        kind: "flat",
        title: pinned.length > 0 ? "Threads" : null,
        rows: nestedThreadRows(unpinned, compareThreads, collapsedIds),
      });
    }

    return sections.filter((section) => section.rows.length > 0);
  }

  if (settings.groupBy === "project") {
    return projectThreadGroups(
      visible,
      projectNameById,
      projectOrder,
      compareThreads,
      collapsedIds,
    ).filter((section) => section.rows.length > 0);
  }

  const rows = nestedThreadRows(visible, compareThreads, collapsedIds);
  return rows.length > 0 ? [{ kind: "flat", title: null, rows }] : [];
}

export function totalRowCount(sections: readonly ListSection[]): number {
  return sections.reduce((count, section) => count + section.rows.length, 0);
}

/** Every reorderable (depth-0) row id, in current display order. */
export function rootRowIds(sections: readonly ListSection[]): string[] {
  const ids: string[] = [];
  for (const section of sections) {
    for (const row of section.rows) {
      if (row.depth === 0) ids.push(row.thread.id);
    }
  }
  return ids;
}

/**
 * Map each reorderable row to the sibling ids it may reorder among: same
 * section, same pinned state. Scoping to the pinned block keeps a drag from
 * silently interleaving pins with unpinned rows (which the comparator would
 * only snap back).
 */
export function dragScopeById(
  sections: readonly ListSection[],
): Map<string, string[]> {
  const scopeById = new Map<string, string[]>();
  for (const section of sections) {
    const roots = section.rows.filter((row) => row.depth === 0);
    const pinned = roots
      .filter((row) => row.thread.isPinned)
      .map((row) => row.thread.id);
    const unpinned = roots
      .filter((row) => !row.thread.isPinned)
      .map((row) => row.thread.id);
    for (const row of roots) {
      scopeById.set(row.thread.id, row.thread.isPinned ? pinned : unpinned);
    }
  }
  return scopeById;
}
