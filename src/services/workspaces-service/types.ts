import { Context, Data, Effect } from "effect"
import type { AppState, WindowId } from "../state-service/schema.ts"

// ============================================================================
// Error Types
// ============================================================================

/**
 * Workspace Operation Error
 * Used when workspace operations fail
 */
export class WorkspaceOperationError extends Data.TaggedError(
  "WorkspaceOperationError",
)<{
  readonly operation: string
  readonly reason: string
  readonly workspaceId?: string
}> {}

/**
 * Bookmark Not Found Error
 * Used when a bookmark cannot be found in a workspace
 */
export class BookmarkNotFoundError extends Data.TaggedError(
  "BookmarkNotFoundError",
)<{
  readonly url: string
  readonly workspaceId: string
}> {}

// ============================================================================
// WorkspacesService Interface
// ============================================================================

/**
 * WorkspacesService
 *
 * Manages browser workspaces using Chrome bookmarks.
 * Each workspace is a bookmark folder containing tabs and tab groups.
 *
 * Responsibilities:
 * - Save current window state as workspace
 * - Load workspace into window
 * - Sync workspace with window changes
 * - Delete and rename workspaces
 * - Track workspace loading state
 *
 * Dependencies:
 * - BrowserApiService for all Chrome API calls
 */
export interface WorkspacesService {
  /**
   * Get the bookmarks bar folder
   * Returns the Chrome bookmarks bar where workspaces are stored
   */
  readonly getBookmarksBar: () => Effect.Effect<
    chrome.bookmarks.BookmarkTreeNode,
    WorkspaceOperationError
  >

  /**
   * Save current window state as a workspace
   * Creates a bookmark folder with all tabs and groups
   *
   * @param workspaceName - Name for the workspace folder
   * @param state - Current application state with tabs and groups
   * @returns The created workspace bookmark folder
   */
  readonly saveWorkspace: (
    workspaceName: string,
    state: AppState,
  ) => Effect.Effect<chrome.bookmarks.BookmarkTreeNode, WorkspaceOperationError>

  /**
   * Sync workspace with current window state
   * Updates bookmark folder to match current tabs and groups
   * Debounced to prevent multiple concurrent syncs (300ms)
   *
   * @param windowId - Window to sync
   * @param workspaceId - Workspace to sync with
   */
  readonly syncWorkspace: (
    windowId: number,
    workspaceId: string,
  ) => Effect.Effect<void, WorkspaceOperationError>

  /**
   * Load workspace into existing window
   * Replaces or adds tabs from workspace into the window
   *
   * @param workspaceId - The workspace to load
   * @param windowId - The window to load into
   * @param keepCurrentTabs - If true, keeps current tabs and adds workspace tabs before them
   */
  readonly loadWorkspaceInWindow: (
    workspaceId: string,
    windowId: number,
    keepCurrentTabs?: boolean,
  ) => Effect.Effect<
    void,
    | WorkspaceOperationError
    | import("../validation-service/index.ts").InvalidIdError
  >

  /**
   * Restore workspace in a new window
   * Creates a new window and loads all workspace tabs into it
   *
   * @param workspaceId - The workspace to restore
   * @returns The newly created window
   */
  readonly restoreWorkspace: (
    workspaceId: string,
  ) => Effect.Effect<
    chrome.windows.Window | undefined,
    | WorkspaceOperationError
    | import("../validation-service/index.ts").InvalidIdError
  >

  /**
   * Delete a workspace
   * Removes the workspace bookmark folder and all its contents
   *
   * @param workspaceId - The workspace to delete
   */
  readonly deleteWorkspace: (
    workspaceId: string,
  ) => Effect.Effect<void, WorkspaceOperationError>

  /**
   * Rename a workspace
   * Updates the bookmark folder title
   *
   * @param workspaceId - The workspace to rename
   * @param newName - New name for the workspace
   * @returns The updated bookmark node
   */
  readonly renameWorkspace: (
    workspaceId: string,
    newName: string,
  ) => Effect.Effect<chrome.bookmarks.BookmarkTreeNode, WorkspaceOperationError>

  /**
   * Rename a tab's bookmark in a workspace
   * Finds the bookmark by URL and updates its title
   * Preserves pinned status in the bookmark title
   *
   * @param windowId - The window ID to find the linked workspace
   * @param tabUrl - The URL of the tab to rename
   * @param newTitle - The new title for the bookmark
   * @param isPinned - Whether the tab is currently pinned
   * @returns Effect that completes when rename is done
   */
  readonly renameTabBookmark: (
    windowId: WindowId,
    tabUrl: string,
    newTitle: string,
    isPinned: boolean,
  ) => Effect.Effect<void, BookmarkNotFoundError>

  /**
   * Check if a workspace is currently being loaded
   * This prevents sync loops during workspace restoration
   *
   * @returns Effect that yields true if a workspace is being loaded, false otherwise
   */
  readonly isLoadingWorkspace: Effect.Effect<boolean>
}

// ============================================================================
// Context Tag
// ============================================================================

/**
 * WorkspacesService Context Tag
 *
 * Use this to inject WorkspacesService:
 *
 * ```typescript
 * const make = Effect.gen(function*() {
 *   const workspaces = yield* WorkspacesService
 *
 *   yield* workspaces.saveWorkspace("My Workspace", state)
 * })
 * ```
 */
export const WorkspacesService = Context.GenericTag<WorkspacesService>(
  "WorkspacesService",
)
