import { Context, Effect, Layer, SubscriptionRef } from "effect"
import { BrowserApiService } from "../browser-api-service/index.ts"
import type { Tab, TabGroup } from "../state-service/schema.ts"

// --- Types ---

export type DragType = "tab" | "group"

export interface DragState {
  isDragging: boolean
  dragType: DragType | null
  draggedItem: Tab | TabGroup | null
  draggedItemId: number | null
}

export const initialDragState: DragState = {
  isDragging: false,
  dragType: null,
  draggedItem: null,
  draggedItemId: null,
}

// --- Service Interface ---

export interface DragDropService {
  readonly dragState: SubscriptionRef.SubscriptionRef<DragState>
  readonly startDrag: (
    type: DragType,
    item: Tab | TabGroup,
  ) => Effect.Effect<void>
  readonly endDrag: Effect.Effect<void>
  readonly handleDropOnGroup: (
    targetGroupId: number,
  ) => Effect.Effect<void>
  readonly handleDropOnWindow: (
    targetWindowId: number,
  ) => Effect.Effect<void>
}

export const DragDropService = Context.GenericTag<DragDropService>(
  "DragDropService",
)

// --- Implementation ---

const make = Effect.gen(function* () {
  const browserApi = yield* BrowserApiService

  const dragState = yield* SubscriptionRef.make<DragState>(initialDragState)

  const startDrag = (type: DragType, item: Tab | TabGroup) =>
    SubscriptionRef.set(dragState, {
      isDragging: true,
      dragType: type,
      draggedItem: item,
      draggedItemId: item.id,
    })

  const endDrag = SubscriptionRef.set(dragState, initialDragState)

  const handleDropOnGroup = (targetGroupId: number) =>
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.get(dragState)
      if (!state.isDragging || !state.draggedItemId) return

      if (state.dragType === "tab") {
        yield* browserApi.tabs.group({
          tabIds: [state.draggedItemId as number],
          groupId: targetGroupId,
        }).pipe(
          Effect.tapError((error) =>
            Effect.logWarning(
              "Failed to group tab during drag-drop",
              error,
            ).pipe(
              Effect.annotateLogs({
                tabId: state.draggedItemId,
                targetGroupId,
              }),
            )
          ),
          Effect.catchAll(() => Effect.void),
        )
      }
      // Groups cannot be dropped into groups
      yield* endDrag
    })

  const handleDropOnWindow = (targetWindowId: number) =>
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.get(dragState)
      if (!state.isDragging || !state.draggedItemId) return

      if (state.dragType === "tab") {
        // Move tab to target window
        yield* browserApi.tabs.move(state.draggedItemId as number, {
          windowId: targetWindowId,
          index: -1,
        }).pipe(
          Effect.tapError((error) =>
            Effect.logWarning(
              "Failed to move tab to window during drag-drop",
              error,
            ).pipe(
              Effect.annotateLogs({
                tabId: state.draggedItemId,
                targetWindowId,
              }),
            )
          ),
          Effect.catchAll(() => Effect.void),
        )
        // Ungroup the tab
        yield* browserApi.tabs.ungroup([state.draggedItemId as number]).pipe(
          Effect.tapError((error) =>
            Effect.logWarning(
              "Failed to ungroup tab during drag-drop",
              error,
            ).pipe(
              Effect.annotateLogs({
                tabId: state.draggedItemId,
              }),
            )
          ),
          Effect.catchAll(() => Effect.void),
        )
      } else if (state.dragType === "group") {
        yield* browserApi.tabGroups.move(state.draggedItemId as number, {
          windowId: targetWindowId,
          index: -1,
        }).pipe(
          Effect.tapError((error) =>
            Effect.logWarning(
              "Failed to move tab group to window during drag-drop",
              error,
            ).pipe(
              Effect.annotateLogs({
                groupId: state.draggedItemId,
                targetWindowId,
              }),
            )
          ),
          Effect.catchAll(() => Effect.void),
        )
      }
      yield* endDrag
    })

  return {
    dragState,
    startDrag,
    endDrag,
    handleDropOnGroup,
    handleDropOnWindow,
  }
})

export const DragDropServiceLive = Layer.scoped(DragDropService, make)
