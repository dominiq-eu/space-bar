import { useEffect, useState } from "preact/hooks"
import { Effect, Fiber, Stream } from "effect"
import { useServices } from "../components/service-context.tsx"

export const useSyncService = () => {
  const { syncService } = useServices()
  const [windowWorkspaceMap, setWindowWorkspaceMap] = useState<
    Record<number, string>
  >({})

  useEffect(() => {
    const fiber = Effect.runFork(
      Stream.runForEach(
        syncService.windowWorkspaceMap.changes,
        (map) => Effect.sync(() => setWindowWorkspaceMap(map)),
      ),
    )
    return () => {
      Effect.runSync(Fiber.interrupt(fiber))
    }
  }, [syncService])

  const linkWindow = (windowId: number, workspaceId: string) => {
    Effect.runPromise(syncService.linkWindow(windowId, workspaceId))
  }

  const syncIfLinked = (tabId?: number, windowId?: number) => {
    Effect.runPromise(syncService.syncIfLinked(tabId, windowId))
  }

  return {
    windowWorkspaceMap,
    linkWindow,
    syncIfLinked,
  }
}
