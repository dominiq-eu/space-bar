/**
 * Windows Service
 *
 * High-level service for window operations.
 * Wraps BrowserApiService with domain-specific logic and validation.
 *
 * This service uses BrowserApiService for all Chrome API calls.
 *
 * @module windows-service
 */

// Export the service interface and context tag
export { WindowsService } from "./types.ts"

// Export error types
export {
  InvalidWindowDataError,
  WindowNotFoundError,
  WindowOperationFailedError,
} from "./types.ts"

// Export event types
export type {
  WindowCreatedEvent,
  WindowEvent,
  WindowEventListener,
  WindowFocusChangedEvent,
  WindowRemovedEvent,
} from "./types.ts"

// Export the implementation layer
export { WindowsServiceLive } from "./implementation.ts"

// Re-export mappers for use by other services if needed
export { mapChromeWindow, mapChromeWindows } from "./mappers.ts"

// ==============================================================================
// Backwards Compatibility Exports
// ==============================================================================
// Re-export old API from index.old.ts for backwards compatibility
// This allows existing code to continue working while we migrate to the new
// Service-based API.

export {
  createWindow,
  focusWindow,
  getCurrentWindow,
  getWindow,
  getWindows,
  removeWindow,
  subscribeToWindowEvents,
  updateWindow,
} from "./index.old.ts"
