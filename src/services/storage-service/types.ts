import { Context, Data, Effect, Option } from "effect"
import type { WindowId, WorkspaceId } from "../state-service/schema.ts"

// ============================================================================
// Error Types
// ============================================================================

/**
 * Storage operation error
 * Thrown when storage operations fail (get, set, remove, clear)
 */
export class StorageOperationError extends Data.TaggedError(
  "StorageOperationError",
)<{
  readonly operation: string
  readonly reason: string
  readonly key?: string
}> {}

// ============================================================================
// StorageService Interface
// ============================================================================

/**
 * StorageService
 *
 * High-level service for chrome.storage operations.
 * Wraps BrowserApiService with domain-specific logic for workspace-window mappings.
 *
 * Responsibilities:
 * - Window-workspace link management
 * - Storage data validation and mapping
 * - Cleanup of stale mappings
 *
 * Dependencies:
 * - BrowserApiService for all Chrome API calls
 */
export interface StorageService {
  // ==========================================================================
  // Window-Workspace Mapping Operations
  // ==========================================================================

  /**
   * Link a window to a workspace
   * A workspace can only be linked to one window at a time
   * If the workspace is already linked to another window, that link is removed
   */
  readonly linkWindowToWorkspace: (
    windowId: WindowId,
    workspaceId: WorkspaceId,
  ) => Effect.Effect<void, StorageOperationError>

  /**
   * Remove the workspace link from a window
   */
  readonly unlinkWindow: (
    windowId: WindowId,
  ) => Effect.Effect<void, StorageOperationError>

  /**
   * Get the workspace ID linked to a window
   * Returns Option<WorkspaceId> - Some(workspaceId) if linked, None if not
   * Never fails - returns None if no mapping exists
   */
  readonly getWorkspaceForWindow: (
    windowId: WindowId,
  ) => Effect.Effect<Option.Option<WorkspaceId>, never>

  /**
   * Get all window-workspace mappings
   * Returns a record where keys are stringified WindowIds and values are WorkspaceIds
   * Never fails - returns empty record if no mappings exist
   */
  readonly getWindowWorkspaceMap: () => Effect.Effect<
    Record<string, WorkspaceId>,
    never
  >

  /**
   * Clean up stale window-workspace mappings
   * Removes mappings for closed windows or deleted workspaces
   *
   * @param getBookmarksBar - Effect to get bookmarks bar (passed to avoid circular dependency)
   */
  readonly cleanupWindowWorkspaceMap: (
    getBookmarksBar: Effect.Effect<chrome.bookmarks.BookmarkTreeNode>,
  ) => Effect.Effect<void, StorageOperationError>
}

// ============================================================================
// Context Tag
// ============================================================================

/**
 * StorageService Context Tag
 *
 * Use this to inject StorageService:
 *
 * ```typescript
 * const make = Effect.gen(function*() {
 *   const storage = yield* StorageService
 *
 *   yield* storage.linkWindowToWorkspace(windowId, workspaceId)
 * })
 * ```
 */
export const StorageService = Context.GenericTag<StorageService>(
  "StorageService",
)
