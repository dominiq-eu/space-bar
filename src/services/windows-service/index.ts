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

// Export the implementation layers
export { WindowsServiceLive, WindowsServiceTest } from "./implementation.ts"

// Re-export mappers for use by other services if needed
export { mapChromeWindow, mapChromeWindows } from "./mappers.ts"
