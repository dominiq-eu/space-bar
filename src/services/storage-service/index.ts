import { Effect } from "effect"

// Storage keys
export const STORAGE_KEY_WINDOW_WORKSPACE_MAP = "windowWorkspaceMap"

/**
 * Link a window to a workspace
 * A workspace can only be linked to one window at a time
 */
export const linkWindowToWorkspace = (
  windowId: number,
  workspaceId: string,
): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      const map = result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {}

      // Remove any existing link to this workspace from other windows
      // (a workspace can only be linked to one window at a time)
      for (const [existingWindowId, existingWorkspaceId] of Object.entries(map)) {
        if (existingWorkspaceId === workspaceId && existingWindowId !== String(windowId)) {
          delete map[existingWindowId]
        }
      }

      map[windowId] = workspaceId
      chrome.storage.local.set(
        { [STORAGE_KEY_WINDOW_WORKSPACE_MAP]: map },
        () => resume(Effect.succeed(undefined)),
      )
    })
  })

/**
 * Remove the workspace link from a window
 */
export const unlinkWindow = (windowId: number): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      const map = result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {}
      delete map[windowId]
      chrome.storage.local.set(
        { [STORAGE_KEY_WINDOW_WORKSPACE_MAP]: map },
        () => resume(Effect.succeed(undefined)),
      )
    })
  })

/**
 * Get the workspace ID linked to a window
 */
export const getWorkspaceForWindow = (
  windowId: number,
): Effect.Effect<string | undefined> =>
  Effect.async<string | undefined>((resume) => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      const map = result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {}
      resume(Effect.succeed(map[windowId]))
    })
  })

/**
 * Get all window-workspace mappings
 */
export const getWindowWorkspaceMap = (): Effect.Effect<Record<string, string>> =>
  Effect.async<Record<string, string>>((resume) => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      const map = result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {}
      resume(Effect.succeed(map))
    })
  })

/**
 * Clean up stale window-workspace mappings
 * Removes mappings for closed windows or deleted workspaces
 *
 * Note: Avoids circular dependency by using getBookmarksBar parameter
 */
export const cleanupWindowWorkspaceMap = (
  getBookmarksBar: Effect.Effect<chrome.bookmarks.BookmarkTreeNode>
): Effect.Effect<void> =>
  Effect.gen(function* () {
    // Get all currently open windows
    const windows = yield* Effect.async<chrome.windows.Window[]>((resume) => {
      chrome.windows.getAll({}, (windows) => resume(Effect.succeed(windows)))
    })
    const openWindowIds = new Set(windows.map((w) => String(w.id)))

    // Get bookmarks bar to check which workspaces exist
    const bookmarksBar = yield* getBookmarksBar

    const children = yield* Effect.async<chrome.bookmarks.BookmarkTreeNode[]>((resume) => {
      chrome.bookmarks.getChildren(bookmarksBar.id, (children) =>
        resume(Effect.succeed(children))
      )
    })

    const existingWorkspaceIds = new Set(
      children.filter((child) => !child.url).map((child) => child.id),
    )

    const result = yield* Effect.async<{ [key: string]: Record<string, string> }>((resume) => {
      chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) =>
        resume(Effect.succeed(result))
      )
    })

    const map: Record<string, string> = result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {}
    const cleanedMap: Record<string, string> = {}

    // Only keep entries for windows that are currently open AND workspaces that still exist
    for (const [windowId, workspaceId] of Object.entries(map)) {
      if (openWindowIds.has(windowId) && existingWorkspaceIds.has(workspaceId)) {
        cleanedMap[windowId] = workspaceId
      }
    }

    yield* Effect.async<void>((resume) => {
      chrome.storage.local.set(
        { [STORAGE_KEY_WINDOW_WORKSPACE_MAP]: cleanedMap },
        () => resume(Effect.succeed(undefined)),
      )
    })
  })
