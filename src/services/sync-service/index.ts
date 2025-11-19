import { Context, Effect, Layer, SubscriptionRef } from "effect"
import type { WindowId, WorkspaceId } from "../state-service/types.ts"
import {
  cleanupWindowWorkspaceMap,
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
  const windowWorkspaceMap = yield* SubscriptionRef.make<
    Record<number, string>
  >(
    {},
  )

  const loadWindowWorkspaceMap = Effect.async<void, never>((resume) => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      const map = result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {}
      Effect.runSync(SubscriptionRef.set(windowWorkspaceMap, map))
      resume(Effect.void)
    })
  })

  // Initial load
  yield* loadWindowWorkspaceMap

  // Storage Listener
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const onStorageChanged = (
        changes: Record<string, chrome.storage.StorageChange>,
      ) => {
        if (changes[STORAGE_KEY_WINDOW_WORKSPACE_MAP]) {
          Effect.runFork(loadWindowWorkspaceMap)
        }
      }
      chrome.storage.onChanged.addListener(onStorageChanged)
      return onStorageChanged
    }),
    (listener) =>
      Effect.sync(() => chrome.storage.onChanged.removeListener(listener)),
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
      yield* loadWindowWorkspaceMap
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
        const tab = yield* Effect.async<chrome.tabs.Tab, never>((resume) => {
          chrome.tabs.get(tabId, (tab) => resume(Effect.succeed(tab)))
        })
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
