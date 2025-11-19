import { Context, Effect, Layer, SubscriptionRef } from "effect"
import type { Tab, TabGroup } from "../state-service/types.ts"

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
        yield* Effect.promise(() =>
          new Promise<void>((resolve) => {
            chrome.tabs.group(
              {
                tabIds: state.draggedItemId as number,
                groupId: targetGroupId,
              },
              () => resolve(),
            )
          })
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
        yield* Effect.promise(() =>
          new Promise<void>((resolve) => {
            chrome.tabs.move(
              state.draggedItemId as number,
              { windowId: targetWindowId, index: -1 },
              () => resolve(),
            )
          })
        )
        yield* Effect.promise(() =>
          new Promise<void>((resolve) => {
            chrome.tabs.ungroup(state.draggedItemId as number, () => resolve())
          })
        )
      } else if (state.dragType === "group") {
        yield* Effect.promise(() =>
          new Promise<void>((resolve) => {
            chrome.tabGroups.move(
              state.draggedItemId as number,
              { windowId: targetWindowId, index: -1 },
              () => resolve(),
            )
          })
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
