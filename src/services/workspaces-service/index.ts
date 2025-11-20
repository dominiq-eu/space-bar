/**
 * Workspaces Service
 *
 * Manages browser workspaces using Chrome bookmarks.
 * Each workspace is a bookmark folder containing tabs and tab groups.
 *
 * This service uses BrowserApiService for all Chrome API calls.
 *
 * @module workspaces-service
 */

// Export the service interface and context tag
export { WorkspacesService } from "./types.ts"

// Export error types
export { BookmarkNotFoundError, WorkspaceOperationError } from "./types.ts"

// Export the implementation layer
export { WorkspacesServiceLive } from "./implementation.ts"

// Re-export metadata utilities
export {
  createBookmarkTitle,
  createGroupTitle,
  parseBookmarkPinnedStatus,
  parseGroupMetadata,
  PINNED_FOLDER_NAME,
  VALID_GROUP_COLORS,
} from "./metadata-parser.ts"
export type { GroupColor } from "./metadata-parser.ts"

// Re-export constants
export {
  BATCH_DELAY_MS,
  BATCH_SIZE,
  SYNC_DEBOUNCE_MS,
  TAB_LOAD_TIMEOUT_MS,
} from "./utils.ts"

// ==============================================================================
// Backwards Compatibility Exports
// ==============================================================================
// Re-export old API from index.old.ts for backwards compatibility
// This allows existing code to continue working while we migrate to the new
// Service-based API.

export {
  deleteWorkspace,
  getBookmarksBar,
  getIsLoadingWorkspace,
  loadWorkspaceInWindow,
  renameTabBookmark,
  renameWorkspace,
  restoreWorkspace,
  saveWorkspace,
  syncWorkspace,
} from "./index.old.ts"
