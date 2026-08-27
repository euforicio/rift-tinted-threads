import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  buildOrderRank,
  mergeVisibleOrder,
  moveId,
  moveIdByOffset,
  orderKey,
} from "./manual-order";
import { createThreadComparator } from "./sort";
import { buildListSections, dragScopeById, rootRowIds } from "./list-view";
import { DEFAULT_LIST_SETTINGS } from "./settings";

function thread(
  overrides: Partial<PluginSidebarThread> & Pick<PluginSidebarThread, "id">,
): PluginSidebarThread {
  return {
    projectId: "proj_a",
    title: overrides.id,
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 100,
    updatedAt: 100,
    lastReadAt: null,
    latestAttentionAt: 100,
    ...overrides,
  };
}

test("moveId places a row before or after its target without mutating input", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(moveId(ids, "d", "b", "before"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveId(ids, "a", "c", "after"), ["b", "c", "a", "d"]);
  assert.deepEqual(ids, ["a", "b", "c", "d"]);
});

test("moveId is a no-op for unknown or self targets", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveId(ids, "a", "a", "before"), ids);
  assert.deepEqual(moveId(ids, "a", "z", "before"), ids);
  assert.deepEqual(moveId(ids, "z", "b", "before"), ids);
});

test("moveIdByOffset steps a row one slot and clamps at the ends", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveIdByOffset(ids, "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveIdByOffset(ids, "b", 1), ["a", "c", "b"]);
  assert.deepEqual(moveIdByOffset(ids, "a", -1), ids);
  assert.deepEqual(moveIdByOffset(ids, "c", 1), ids);
});

test("mergeVisibleOrder reorders only the visible slice", () => {
  const base = ["a", "b", "c", "d", "e"];
  // Reorder just the {b,d} slice; a, c, e keep their slots.
  assert.deepEqual(mergeVisibleOrder(base, ["d", "b"]), [
    "a",
    "d",
    "c",
    "b",
    "e",
  ]);
});

test("buildOrderRank ignores duplicate ids after the first", () => {
  const rank = buildOrderRank(["a", "b", "a", "c"]);
  assert.equal(rank.get("a"), 0);
  assert.equal(rank.get("b"), 1);
  assert.equal(rank.get("c"), 3);
  assert.equal(buildOrderRank(null).size, 0);
});

test("manual comparator follows saved order and floats new rows to the top", () => {
  const rank = buildOrderRank(["b", "a"]);
  const compare = createThreadComparator("manual", rank);
  const a = thread({ id: "a", createdAt: 100 });
  const b = thread({ id: "b", createdAt: 200 });
  const fresh = thread({ id: "fresh", createdAt: 999 });
  const sorted = [a, fresh, b].sort(compare).map((t) => t.id);
  // fresh (unranked, newest) leads; then the saved order b, a.
  assert.deepEqual(sorted, ["fresh", "b", "a"]);
});

test("manual sort keeps pinned rows first via the list comparator", () => {
  const threads = [
    thread({ id: "u1", createdAt: 100 }),
    thread({ id: "p1", isPinned: true, createdAt: 90 }),
    thread({ id: "u2", createdAt: 80 }),
  ];
  const sections = buildListSections(
    threads,
    [{ id: "proj_a", name: "Alpha", isPersonal: false }],
    { ...DEFAULT_LIST_SETTINGS, sortBy: "manual", groupBy: "none" },
    "",
    buildOrderRank(["u2", "u1"]),
  );
  const ids = sections.flatMap((s) => s.rows.map((r) => r.thread.id));
  assert.deepEqual(ids, ["p1", "u2", "u1"]);
});

test("dragScopeById scopes rows to their section and pin block", () => {
  const threads = [
    thread({ id: "p1", isPinned: true, createdAt: 400 }),
    thread({ id: "u1", createdAt: 300 }),
    thread({ id: "u2", createdAt: 200 }),
  ];
  const sections = buildListSections(
    threads,
    [{ id: "proj_a", name: "Alpha", isPersonal: false }],
    { ...DEFAULT_LIST_SETTINGS, sortBy: "manual", groupBy: "none" },
    "",
    buildOrderRank([]),
  );
  const scope = dragScopeById(sections);
  // Pins and unpinned rows live in separate scopes even in one flat section.
  assert.deepEqual(scope.get("p1"), ["p1"]);
  assert.deepEqual(scope.get("u1")?.slice().sort(), ["u1", "u2"]);
  assert.deepEqual(rootRowIds(sections).slice().sort(), ["p1", "u1", "u2"]);
});

test("orderKey distinguishes different orders", () => {
  assert.notEqual(orderKey(["a", "b"]), orderKey(["b", "a"]));
  assert.equal(orderKey(["a", "b"]), orderKey(["a", "b"]));
});
