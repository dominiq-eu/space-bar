import { useEffect, useState } from "preact/hooks"
import { Effect, Fiber, Stream } from "effect"
import {
  DragState,
  DragType,
  initialDragState,
} from "../services/drag-drop-service/index.ts"
import { useServices } from "../components/ServiceContext.tsx"
import type { Tab, TabGroup } from "../services/state-service/types.ts"

export const useDragDropService = () => {
  const { dragDropService } = useServices()
  const [dragState, setDragState] = useState<DragState>(initialDragState)

  useEffect(() => {
    const fiber = Effect.runFork(
      Stream.runForEach(
        dragDropService.dragState.changes,
        (state) => Effect.sync(() => setDragState(state)),
      ),
    )
    return () => {
      Effect.runSync(Fiber.interrupt(fiber))
    }
  }, [dragDropService])

  const startDrag = (type: DragType, item: Tab | TabGroup) => {
    Effect.runPromise(dragDropService.startDrag(type, item))
  }

  const endDrag = () => {
    Effect.runPromise(dragDropService.endDrag)
  }

  const handleDropOnGroup = (
    targetGroupId: number,
    onComplete?: () => void,
  ) => {
    Effect.runPromise(dragDropService.handleDropOnGroup(targetGroupId)).then(
      () => onComplete && onComplete(),
    )
  }

  const handleDropOnWindow = (
    targetWindowId: number,
    onComplete?: () => void,
  ) => {
    Effect.runPromise(dragDropService.handleDropOnWindow(targetWindowId)).then(
      () => onComplete && onComplete(),
    )
  }

  return {
    dragState,
    startDrag,
    endDrag,
    handleDropOnGroup,
    handleDropOnWindow,
  }
}
