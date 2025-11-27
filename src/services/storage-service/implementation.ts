import { Effect, Layer, Option } from "effect"
import { BrowserApiService } from "../browser-api-service/index.ts"
import { StorageService } from "./types.ts"
import { StorageOperationError } from "./types.ts"
import type { WindowId, WorkspaceId } from "../state-service/schema.ts"
import { Validators } from "../validation-service/index.ts"

// ============================================================================
// Constants
// ============================================================================

/** Storage key for window-workspace mappings */
export const STORAGE_KEY_WINDOW_WORKSPACE_MAP = "windowWorkspaceMap"

// ============================================================================
// Service Implementation
// ============================================================================

const make = Effect.gen(function* () {
  const browserApi = yield* BrowserApiService

  // ==========================================================================
  // Window-Workspace Mapping Operations
  // ==========================================================================

  /**
   * Link a window to a workspace
   * A workspace can only be linked to one window at a time
   */
  const linkWindowToWorkspace = (
    windowId: WindowId,
    workspaceId: WorkspaceId,
  ): Effect.Effect<void, StorageOperationError> =>
    Effect.gen(function* () {
      // Get current mappings
      const result = yield* browserApi.storage.local.get([
        STORAGE_KEY_WINDOW_WORKSPACE_MAP,
      ])

      const map: Record<string, string> =
        (result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] as Record<string, string>) ??
          ({} as Record<string, string>)

      // Remove any existing link to this workspace from other windows
      // (a workspace can only be linked to one window at a time)
      for (
        const [existingWindowId, existingWorkspaceId] of Object.entries(map)
      ) {
        if (
          existingWorkspaceId === workspaceId &&
          existingWindowId !== String(windowId)
        ) {
          delete map[existingWindowId]
        }
      }

      // Add new mapping
      map[String(windowId)] = workspaceId

      // Save updated mappings
      yield* browserApi.storage.local.set({
        [STORAGE_KEY_WINDOW_WORKSPACE_MAP]: map,
      }).pipe(
        Effect.mapError((error) =>
          new StorageOperationError({
            operation: error.operation,
            reason: error.reason,
            key: error.key,
          })
        ),
      )
    })

  /**
   * Remove the workspace link from a window
   */
  const unlinkWindow = (
    windowId: WindowId,
  ): Effect.Effect<void, StorageOperationError> =>
    Effect.gen(function* () {
      // Get current mappings
      const result = yield* browserApi.storage.local.get([
        STORAGE_KEY_WINDOW_WORKSPACE_MAP,
      ])

      const map: Record<string, string> =
        (result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] as Record<string, string>) ??
          ({} as Record<string, string>)

      // Remove the mapping
      delete map[String(windowId)]

      // Save updated mappings
      yield* browserApi.storage.local.set({
        [STORAGE_KEY_WINDOW_WORKSPACE_MAP]: map,
      }).pipe(
        Effect.mapError((error) =>
          new StorageOperationError({
            operation: error.operation,
            reason: error.reason,
            key: error.key,
          })
        ),
      )
    })

  /**
   * Get the workspace ID linked to a window
   * Returns Option<WorkspaceId> instead of string | undefined
   */
  const getWorkspaceForWindow = (
    windowId: WindowId,
  ): Effect.Effect<Option.Option<WorkspaceId>, never> =>
    Effect.gen(function* () {
      const result = yield* browserApi.storage.local.get([
        STORAGE_KEY_WINDOW_WORKSPACE_MAP,
      ])

      const map: Record<string, string> =
        (result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] as Record<string, string>) ??
          ({} as Record<string, string>)
      const workspaceId = map[String(windowId)]

      if (workspaceId) {
        const validated = yield* Validators.workspaceIdOptional(workspaceId)
        return validated
      }

      return Option.none()
    })

  /**
   * Get all window-workspace mappings
   * Keys are stringified WindowIds, values are WorkspaceIds
   */
  const getWindowWorkspaceMap = (): Effect.Effect<
    Record<string, WorkspaceId>,
    never
  > =>
    Effect.gen(function* () {
      const result = yield* browserApi.storage.local.get([
        STORAGE_KEY_WINDOW_WORKSPACE_MAP,
      ])

      const map: Record<string, WorkspaceId> =
        (result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] as Record<
          string,
          WorkspaceId
        >) || {}

      return map
    })

  /**
   * Clean up stale window-workspace mappings
   * Removes mappings for closed windows or deleted workspaces
   *
   * Note: Avoids circular dependency by using getBookmarksBar parameter
   */
  const cleanupWindowWorkspaceMap = (
    getBookmarksBar: Effect.Effect<chrome.bookmarks.BookmarkTreeNode>,
  ): Effect.Effect<void, StorageOperationError> =>
    Effect.gen(function* () {
      // Get all currently open windows
      const windows = yield* browserApi.windows.getAll({}).pipe(
        Effect.tapError((error) =>
          Effect.logWarning(
            "Failed to get windows for cleanup, using empty list",
            error,
          )
        ),
        Effect.catchAll(() => Effect.succeed([])),
      )
      const openWindowIds = new Set(windows.map((w) => String(w.id)))

      // Get bookmarks bar to check which workspaces exist
      const bookmarksBar = yield* getBookmarksBar

      // Get children of bookmarks bar (workspaces are folders in bookmarks bar)
      const children = yield* browserApi.bookmarks.getChildren(bookmarksBar.id)
        .pipe(
          Effect.tapError((error) =>
            Effect.logWarning(
              "Failed to get bookmark children for cleanup, using empty list",
              error,
            )
          ),
          Effect.catchAll(() => Effect.succeed([])),
        )

      const existingWorkspaceIds = new Set(
        children.filter((child) => !child.url).map((child) => child.id),
      )

      // Get current mappings
      const result = yield* browserApi.storage.local.get([
        STORAGE_KEY_WINDOW_WORKSPACE_MAP,
      ])

      const map: Record<string, string> =
        (result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] as Record<string, string>) ??
          ({} as Record<string, string>)
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

      // Save cleaned mappings
      yield* browserApi.storage.local.set({
        [STORAGE_KEY_WINDOW_WORKSPACE_MAP]: cleanedMap,
      }).pipe(
        Effect.mapError((error) =>
          new StorageOperationError({
            operation: "set",
            reason: error.reason,
            key: STORAGE_KEY_WINDOW_WORKSPACE_MAP,
          })
        ),
      )
    })

  return {
    linkWindowToWorkspace,
    unlinkWindow,
    getWorkspaceForWindow,
    getWindowWorkspaceMap,
    cleanupWindowWorkspaceMap,
  } satisfies StorageService
})

// ============================================================================
// Layer
// ============================================================================

/**
 * Base StorageService layer without dependencies provided.
 * Use this for testing with mock dependencies.
 */
const StorageServiceLayer = Layer.effect(StorageService, make)

/**
 * StorageService Live Layer
 *
 * Dependencies:
 * - BrowserApiService (for all Chrome API calls)
 */
export const StorageServiceLive = StorageServiceLayer

/**
 * StorageService layer for testing.
 * Does NOT provide BrowserApiService - caller must provide it.
 *
 * Usage in tests:
 * ```typescript
 * const mockLayer = createMockBrowserApiService()
 * const testLayer = StorageServiceTest.pipe(Layer.provide(mockLayer))
 * ```
 */
export const StorageServiceTest = StorageServiceLayer
