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

// Export the implementation layers
export { StorageServiceLive, StorageServiceTest } from "./implementation.ts"

// Export storage constants
export { STORAGE_KEY_WINDOW_WORKSPACE_MAP } from "./implementation.ts"
