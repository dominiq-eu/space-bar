/**
 * Browser API Service
 *
 * Abstraction layer for Browser Extension APIs.
 * This is the ONLY service that directly interacts with chrome.* APIs.
 *
 * @module browser-api-service
 */

// Export the service interface and context tag
export { BrowserApiService } from "./types.ts"

// Export all error types
export {
  BookmarkNotFoundError,
  BookmarkOperationError,
  BrowserApiError,
  GroupNotFoundError,
  StorageError,
  TabGroupOperationError,
  TabNotFoundError,
  TabOperationError,
  WindowNotFoundError,
  WindowOperationError,
} from "./types.ts"

// Export type definitions (for type annotations)
export type { GroupId, TabId, WindowId, WorkspaceId } from "./types.ts"

// Export the Chrome implementation layer
export { ChromeApiServiceLive } from "./chrome-api.ts"
