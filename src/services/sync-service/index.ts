import { Context, Effect, Layer, SubscriptionRef } from "effect"
import { BrowserApiService } from "../browser-api-service/index.ts"
import type { WindowId, WorkspaceId } from "../state-service/types.ts"
import {
  cleanupWindowWorkspaceMap,
  getWindowWorkspaceMap,
  getWorkspaceForWindow,
  linkWindowToWorkspace,
  STORAGE_KEY_WINDOW_WORKSPACE_MAP,
} from "../storage-service/index.ts"
import {
  getBookmarksBar,
  getIsLoadingWorkspace,
  syncWorkspace,
} from "../workspaces-service/index.ts"
import { isSome } from "../../utils/type-conversions.ts"

// --- Service Interface ---

export interface SyncService {
  readonly windowWorkspaceMap: SubscriptionRef.SubscriptionRef<
    Record<number, string>
  >
  readonly linkWindow: (
    windowId: number,
    workspaceId: string,
  ) => Effect.Effect<void>
  readonly syncIfLinked: (
    tabId?: number,
    windowId?: number,
  ) => Effect.Effect<void>
}

export const SyncService = Context.GenericTag<SyncService>("SyncService")

// --- Implementation ---

const make = Effect.gen(function* () {
  const browserApi = yield* BrowserApiService

  const windowWorkspaceMap = yield* SubscriptionRef.make<
    Record<number, string>
  >(
    {},
  )

  const loadWindowWorkspaceMap = (): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      const map = yield* getWindowWorkspaceMap().pipe(
        Effect.map((stringMap) => {
          // Convert string keys to number keys
          const result: Record<number, string> = {}
          for (const [key, value] of Object.entries(stringMap)) {
            result[Number(key)] = value
          }
          return result
        }),
        Effect.catchAll(() => Effect.succeed({})),
      )
      yield* SubscriptionRef.set(windowWorkspaceMap, map)
    })

  // Initial load
  yield* loadWindowWorkspaceMap()

  // Storage Listener using BrowserApiService
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const onStorageChanged = browserApi.events.onStorageChanged((changes) => {
        if (changes[STORAGE_KEY_WINDOW_WORKSPACE_MAP]) {
          Effect.runFork(loadWindowWorkspaceMap())
        }
      })
      return onStorageChanged
    }),
    (cleanup) => Effect.sync(() => cleanup()),
  )

  // Cleanup Listener (runs once on startup)
  yield* Effect.promise(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        // Pass the Effect itself, not the result
        yield* cleanupWindowWorkspaceMap(getBookmarksBar)
      }),
    )
  )

  const linkWindow = (
    windowId: number,
    workspaceId: string,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* linkWindowToWorkspace(
        windowId as WindowId,
        workspaceId as WorkspaceId,
      )
      yield* loadWindowWorkspaceMap()
      yield* syncIfLinked(undefined, windowId)
    }).pipe(Effect.catchAll((error) => Effect.logError(error)))

  const syncIfLinked = (
    tabId?: number,
    windowId?: number,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (getIsLoadingWorkspace()) {
        return
      }

      let targetWindowId: number | undefined = windowId

      if (targetWindowId === undefined && tabId !== undefined) {
        const tab = yield* browserApi.tabs.get(tabId).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
        )
        targetWindowId = tab?.windowId
      }

      if (targetWindowId !== undefined) {
        const workspaceIdOption = yield* getWorkspaceForWindow(
          targetWindowId as WindowId,
        )
        if (isSome(workspaceIdOption)) {
          yield* Effect.promise(() =>
            syncWorkspace(targetWindowId!, workspaceIdOption.value)
          )
        }
      }
    }).pipe(Effect.catchAll((error) => Effect.logError(error)))

  return {
    windowWorkspaceMap,
    linkWindow,
    syncIfLinked,
  }
})

export const SyncServiceLive = Layer.scoped(SyncService, make)
