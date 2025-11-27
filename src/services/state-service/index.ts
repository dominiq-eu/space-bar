/**
 * State Service
 *
 * Manages application state loading and access.
 * Loads all tabs, windows, groups, and workspace mappings.
 *
 * This service uses BrowserApiService for all Chrome API calls.
 *
 * @module state-service
 */

// Export the service interface and context tag
export { StateService } from "./types.ts"

// Export error types
export { StateLoadError } from "./types.ts"

// Export the implementation layer
export { StateServiceLive } from "./implementation.ts"

// Re-export schema types for convenience
export type { AppState, Tab, TabGroup, Window } from "./schema.ts"

// Re-export branded IDs
export type {
  GroupId,
  TabGroupColor,
  TabId,
  WindowId,
  WindowType,
  WorkspaceId,
} from "./schema.ts"
