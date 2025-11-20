/**
 * Storage Service
 *
 * High-level service for chrome.storage operations.
 * Wraps BrowserApiService with domain-specific logic for workspace-window mappings.
 *
 * This service uses BrowserApiService for all Chrome API calls.
 *
 * @module storage-service
 */

// Export the service interface and context tag
export { StorageService } from "./types.ts"

// Export error types
export { StorageOperationError } from "./types.ts"

// Export the implementation layer
export { StorageServiceLive } from "./implementation.ts"

// Export storage constants
export { STORAGE_KEY_WINDOW_WORKSPACE_MAP } from "./implementation.ts"

// ==============================================================================
// Backwards Compatibility Exports
// ==============================================================================
// Re-export old API from index.old.ts for backwards compatibility
// This allows existing code to continue working while we migrate to the new
// Service-based API.

export {
  cleanupWindowWorkspaceMap,
  getWindowWorkspaceMap,
  getWorkspaceForWindow,
  linkWindowToWorkspace,
  unlinkWindow,
} from "./index.old.ts"

// Re-export old error name for backwards compatibility
// TODO: Remove this once all consumers are migrated to StorageOperationError
export { StorageOperationFailedError } from "./errors.ts"
