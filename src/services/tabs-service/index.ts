/**
 * Tabs Service
 *
 * High-level service for tab and tab group operations.
 * Wraps BrowserApiService with domain-specific logic and validation.
 *
 * This service uses BrowserApiService for all Chrome API calls.
 *
 * @module tabs-service
 */

// Export the service interface and context tag
export { TabsService } from "./types.ts"

// Export error types
export {
  GroupNotFoundError,
  InvalidGroupDataError,
  InvalidTabDataError,
  InvalidTabUrlError,
  TabAlreadyInGroupError,
  TabNotFoundError,
  TabOperationFailedError,
} from "./types.ts"

// Export event types
export type {
  TabActivatedEvent,
  TabAttachedEvent,
  TabCreatedEvent,
  TabDetachedEvent,
  TabEvent,
  TabEventListener,
  TabGroupCreatedEvent,
  TabGroupRemovedEvent,
  TabGroupUpdatedEvent,
  TabMovedEvent,
  TabRemovedEvent,
  TabUpdatedEvent,
} from "./types.ts"

// Export the implementation layer
export { TabsServiceLive } from "./implementation.ts"

// Re-export constants (if any)
export * from "./constants.ts"

// Re-export mappers for use by other services if needed
export {
  mapChromeTab,
  mapChromeTabGroup,
  mapChromeTabGroups,
  mapChromeTabs,
  mapTabChangeInfo,
} from "./mappers.ts"

// ==============================================================================
// Backwards Compatibility Exports
// ==============================================================================
// Re-export old API from index.old.ts for backwards compatibility
// This allows existing code to continue working while we migrate to the new
// Service-based API.

export {
  activateTab,
  createTab,
  getTab,
  getTabGroup,
  getTabGroups,
  getTabs,
  groupTabs,
  moveTab,
  removeTab,
  removeTabs,
  subscribeToTabEvents,
  toggleGroupCollapsed,
  ungroupTabs,
  updateTab,
  updateTabGroup,
} from "./index.old.ts"
