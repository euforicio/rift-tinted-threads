import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  mergeVisibleOrder,
  moveId,
  moveIdByOffset,
  orderKey,
  type DropPlacement,
} from "@/lib/manual-order";

export interface ReorderControls {
  isDragging: boolean;
  disabled: boolean;
  onPointerDown: (event: ReactPointerEvent) => void;
  onKeyDown: (event: ReactKeyboardEvent) => void;
}

export interface ReorderDragContext {
  /** Every reorderable row id in current display order. */
  baseRootIds: readonly string[];
  /** Row id → the sibling ids it may reorder among (its section + pin block). */
  scopeById: ReadonlyMap<string, readonly string[]>;
}

interface DragState {
  movingId: string;
  ids: string[];
}

/** Vertical travel before a press turns into a drag (px). */
const ENGAGE_THRESHOLD = 6;

/**
 * Swallow the click that a mouse-up fires after a drag, so releasing a row does
 * not also navigate to it.
 */
function suppressNextClick(threadId: string): void {
  let timeout = 0;
  const suppress = (event: MouseEvent) => {
    const clickedThreadId =
      event.target instanceof Element
        ? event.target
            .closest("[data-sidebar-thread-id]")
            ?.getAttribute("data-sidebar-thread-id")
        : null;
    if (clickedThreadId !== threadId) return;
    event.preventDefault();
    event.stopPropagation();
    window.removeEventListener("click", suppress, true);
    window.clearTimeout(timeout);
  };
  window.addEventListener("click", suppress, true);
  timeout = window.setTimeout(
    () => window.removeEventListener("click", suppress, true),
    300,
  );
}

export interface ReorderDrag {
  /** Live merged order while dragging, or null when idle. */
  dragOrderIds: string[] | null;
  controlsFor(threadId: string): ReorderControls;
}

/**
 * Pointer- and keyboard-driven row reordering. Dragging re-sorts the list live
 * under the cursor; releasing persists the new order through `reorder`.
 */
export function useReorderDrag(options: {
  enabled: boolean;
  isReordering: boolean;
  context: ReorderDragContext;
  reorder: (ids: readonly string[]) => Promise<boolean>;
}): ReorderDrag {
  const { enabled, isReordering, context, reorder } = options;

  const contextRef = useRef(context);
  contextRef.current = context;
  const reorderRef = useRef(reorder);
  reorderRef.current = reorder;
  const activeRef = useRef(enabled && !isReordering);
  activeRef.current = enabled && !isReordering;

  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;
  const cancelRef = useRef<(() => void) | null>(null);

  // Cancel any in-progress drag if the list unmounts mid-gesture.
  useEffect(() => () => cancelRef.current?.(), []);

  const dragOrderIds = useMemo(() => {
    if (!dragState) return null;
    return mergeVisibleOrder(contextRef.current.baseRootIds, dragState.ids);
  }, [dragState]);

  const startDrag = useCallback(
    (event: ReactPointerEvent, movingId: string) => {
      if (!activeRef.current || event.button !== 0) return;
      const scope = contextRef.current.scopeById.get(movingId);
      if (!scope || scope.length < 2) return;

      const scopeIds = [...scope];
      cancelRef.current?.();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let engaged = false;
      let finished = false;
      let previousUserSelect = "";
      let previousCursor = "";

      function cleanup() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        window.removeEventListener("keydown", onKeyDown);
        if (engaged) {
          document.body.style.userSelect = previousUserSelect;
          document.body.style.cursor = previousCursor;
        }
        if (cancelRef.current === cancel) cancelRef.current = null;
      }

      function cancel() {
        if (finished) return;
        finished = true;
        cleanup();
        if (engaged) {
          dragStateRef.current = null;
          setDragState(null);
        }
      }

      function engage() {
        engaged = true;
        previousUserSelect = document.body.style.userSelect;
        previousCursor = document.body.style.cursor;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        const next: DragState = { movingId, ids: scopeIds };
        dragStateRef.current = next;
        setDragState(next);
      }

      function reorderAt(clientX: number, clientY: number) {
        const hit = document.elementFromPoint(clientX, clientY);
        const rowEl =
          hit instanceof Element
            ? hit.closest("[data-sidebar-thread-id]")
            : null;
        const targetId = rowEl?.getAttribute("data-sidebar-thread-id");
        const current = dragStateRef.current;
        if (
          !rowEl ||
          !targetId ||
          !scopeIds.includes(targetId) ||
          !current ||
          current.movingId === targetId
        ) {
          return;
        }
        const rect = rowEl.getBoundingClientRect();
        const placement: DropPlacement =
          clientY < rect.top + rect.height / 2 ? "before" : "after";
        const ids = moveId(current.ids, current.movingId, targetId, placement);
        if (orderKey(ids) === orderKey(current.ids)) return;
        const next: DragState = { ...current, ids };
        dragStateRef.current = next;
        setDragState(next);
      }

      function onPointerMove(moveEvent: PointerEvent) {
        if (finished || moveEvent.pointerId !== pointerId) return;
        if (!engaged) {
          const deltaX = moveEvent.clientX - startX;
          const deltaY = moveEvent.clientY - startY;
          if (
            Math.abs(deltaY) < ENGAGE_THRESHOLD ||
            Math.abs(deltaY) <= Math.abs(deltaX)
          ) {
            return;
          }
          engage();
        }
        moveEvent.preventDefault();
        reorderAt(moveEvent.clientX, moveEvent.clientY);
      }

      function onPointerUp(upEvent: PointerEvent) {
        if (finished || upEvent.pointerId !== pointerId) return;
        const current = dragStateRef.current;
        finished = true;
        cleanup();
        if (!engaged || !current) return;
        dragStateRef.current = null;
        setDragState(null);
        suppressNextClick(current.movingId);
        const globalIds = mergeVisibleOrder(
          contextRef.current.baseRootIds,
          current.ids,
        );
        void reorderRef.current(globalIds);
      }

      function onPointerCancel(cancelEvent: PointerEvent) {
        if (cancelEvent.pointerId === pointerId) cancel();
      }

      function onKeyDown(keyEvent: KeyboardEvent) {
        if (keyEvent.key === "Escape") cancel();
      }

      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      window.addEventListener("keydown", onKeyDown);
      cancelRef.current = cancel;
    },
    [],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent, threadId: string) => {
      if (!activeRef.current || !event.altKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const scope = contextRef.current.scopeById.get(threadId);
      if (!scope || scope.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      const ids = moveIdByOffset(
        [...scope],
        threadId,
        event.key === "ArrowUp" ? -1 : 1,
      );
      const globalIds = mergeVisibleOrder(contextRef.current.baseRootIds, ids);
      void reorderRef.current(globalIds);
    },
    [],
  );

  const controlsFor = useCallback(
    (threadId: string): ReorderControls => ({
      disabled: !enabled || isReordering,
      isDragging: dragState?.movingId === threadId,
      onPointerDown: (event) => startDrag(event, threadId),
      onKeyDown: (event) => handleKeyDown(event, threadId),
    }),
    [dragState, enabled, handleKeyDown, isReordering, startDrag],
  );

  return { dragOrderIds, controlsFor };
}
