import { Effect, Option } from "effect"
import { WindowId, WorkspaceId } from "../state-service/types.ts"
import { StorageOperationFailedError } from "./errors.ts"

// Storage keys
export const STORAGE_KEY_WINDOW_WORKSPACE_MAP = "windowWorkspaceMap"

// Re-export errors
export { StorageOperationFailedError }

/**
 * Link a window to a workspace
 * A workspace can only be linked to one window at a time
 */
export const linkWindowToWorkspace = (
  windowId: WindowId,
  workspaceId: WorkspaceId,
): Effect.Effect<void, StorageOperationFailedError> =>
  Effect.async<void, StorageOperationFailedError>((resume) => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      if (chrome.runtime.lastError) {
        resume(
          Effect.fail(
            new StorageOperationFailedError({
              operation: "get",
              reason: chrome.runtime.lastError.message || "Unknown error",
              key: STORAGE_KEY_WINDOW_WORKSPACE_MAP,
            }),
          ),
        )
        return
      }

      const map: Record<string, string> =
        result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {}

      // Remove any existing link to this workspace from other windows
      // (a workspace can only be linked to one window at a time)
      for (
        const [existingWindowId, existingWorkspaceId] of Object.entries(
          map,
        )
      ) {
        if (
          existingWorkspaceId === workspaceId &&
          existingWindowId !== String(windowId)
        ) {
          delete map[existingWindowId]
        }
      }

      map[String(windowId)] = workspaceId
      chrome.storage.local.set(
        { [STORAGE_KEY_WINDOW_WORKSPACE_MAP]: map },
        () => {
          if (chrome.runtime.lastError) {
            resume(
              Effect.fail(
                new StorageOperationFailedError({
                  operation: "set",
                  reason: chrome.runtime.lastError.message || "Unknown error",
                  key: STORAGE_KEY_WINDOW_WORKSPACE_MAP,
                }),
              ),
            )
          } else {
            resume(Effect.succeed(undefined))
          }
        },
      )
    })
  })

/**
 * Remove the workspace link from a window
 */
export const unlinkWindow = (
  windowId: WindowId,
): Effect.Effect<void, StorageOperationFailedError> =>
  Effect.async<void, StorageOperationFailedError>((resume) => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      if (chrome.runtime.lastError) {
        resume(
          Effect.fail(
            new StorageOperationFailedError({
              operation: "get",
              reason: chrome.runtime.lastError.message || "Unknown error",
              key: STORAGE_KEY_WINDOW_WORKSPACE_MAP,
            }),
          ),
        )
        return
      }

      const map: Record<string, string> =
        result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {}
      delete map[String(windowId)]

      chrome.storage.local.set(
        { [STORAGE_KEY_WINDOW_WORKSPACE_MAP]: map },
        () => {
          if (chrome.runtime.lastError) {
            resume(
              Effect.fail(
                new StorageOperationFailedError({
                  operation: "set",
                  reason: chrome.runtime.lastError.message || "Unknown error",
                  key: STORAGE_KEY_WINDOW_WORKSPACE_MAP,
                }),
              ),
            )
          } else {
            resume(Effect.succeed(undefined))
          }
        },
      )
    })
  })

/**
 * Get the workspace ID linked to a window
 * Returns Option<WorkspaceId> instead of string | undefined
 */
export const getWorkspaceForWindow = (
  windowId: WindowId,
): Effect.Effect<Option.Option<WorkspaceId>, StorageOperationFailedError> =>
  Effect.async<Option.Option<WorkspaceId>, StorageOperationFailedError>(
    (resume) => {
      chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
        if (chrome.runtime.lastError) {
          resume(
            Effect.fail(
              new StorageOperationFailedError({
                operation: "get",
                reason: chrome.runtime.lastError.message || "Unknown error",
                key: STORAGE_KEY_WINDOW_WORKSPACE_MAP,
              }),
            ),
          )
          return
        }

        const map: Record<string, string> =
          result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {}
        const workspaceId = map[String(windowId)]

        resume(
          Effect.succeed(
            workspaceId
              ? Option.some(workspaceId as WorkspaceId)
              : Option.none(),
          ),
        )
      })
    },
  )

/**
 * Get all window-workspace mappings
 * Keys are stringified WindowIds, values are WorkspaceIds
 */
export const getWindowWorkspaceMap = (): Effect.Effect<
  Record<string, WorkspaceId>,
  StorageOperationFailedError
> =>
  Effect.async<Record<string, WorkspaceId>, StorageOperationFailedError>(
    (resume) => {
      chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
        if (chrome.runtime.lastError) {
          resume(
            Effect.fail(
              new StorageOperationFailedError({
                operation: "get",
                reason: chrome.runtime.lastError.message || "Unknown error",
                key: STORAGE_KEY_WINDOW_WORKSPACE_MAP,
              }),
            ),
          )
          return
        }

        const map: Record<string, WorkspaceId> =
          (result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] as Record<
            string,
            WorkspaceId
          >) || {}
        resume(Effect.succeed(map))
      })
    },
  )

/**
 * Clean up stale window-workspace mappings
 * Removes mappings for closed windows or deleted workspaces
 *
 * Note: Avoids circular dependency by using getBookmarksBar parameter
 */
export const cleanupWindowWorkspaceMap = (
  getBookmarksBar: Effect.Effect<chrome.bookmarks.BookmarkTreeNode>,
): Effect.Effect<void, StorageOperationFailedError> =>
  Effect.gen(function* () {
    // Get all currently open windows
    const windows = yield* Effect.async<chrome.windows.Window[], never>(
      (resume) => {
        chrome.windows.getAll({}, (windows) => resume(Effect.succeed(windows)))
      },
    )
    const openWindowIds = new Set(windows.map((w) => String(w.id)))

    // Get bookmarks bar to check which workspaces exist
    const bookmarksBar = yield* getBookmarksBar

    const children = yield* Effect.async<
      chrome.bookmarks.BookmarkTreeNode[],
      never
    >((resume) => {
      chrome.bookmarks.getChildren(bookmarksBar.id, (children) => {
        // Consume lastError to prevent Chrome from logging it
        const error = chrome.runtime.lastError
        if (error || !children) {
          resume(Effect.succeed([]))
          return
        }
        resume(Effect.succeed(children))
      })
    })

    const existingWorkspaceIds = new Set(
      children.filter((child) => !child.url).map((child) => child.id),
    )

    const result = yield* Effect.async<
      { [key: string]: Record<string, string> },
      StorageOperationFailedError
    >((resume) => {
      chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
        if (chrome.runtime.lastError) {
          resume(
            Effect.fail(
              new StorageOperationFailedError({
                operation: "get",
                reason: chrome.runtime.lastError.message || "Unknown error",
                key: STORAGE_KEY_WINDOW_WORKSPACE_MAP,
              }),
            ),
          )
        } else {
          resume(Effect.succeed(result))
        }
      })
    })

    const map: Record<string, string> =
      result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {}
    const cleanedMap: Record<string, string> = {}

    // Only keep entries for windows that are currently open AND workspaces that still exist
    for (const [windowId, workspaceId] of Object.entries(map)) {
      if (
        openWindowIds.has(windowId) &&
        existingWorkspaceIds.has(workspaceId)
      ) {
        cleanedMap[windowId] = workspaceId
      }
    }

    yield* Effect.async<void, StorageOperationFailedError>((resume) => {
      chrome.storage.local.set(
        { [STORAGE_KEY_WINDOW_WORKSPACE_MAP]: cleanedMap },
        () => {
          if (chrome.runtime.lastError) {
            resume(
              Effect.fail(
                new StorageOperationFailedError({
                  operation: "set",
                  reason: chrome.runtime.lastError.message || "Unknown error",
                  key: STORAGE_KEY_WINDOW_WORKSPACE_MAP,
                }),
              ),
            )
          } else {
            resume(Effect.succeed(undefined))
          }
        },
      )
    })
  })
