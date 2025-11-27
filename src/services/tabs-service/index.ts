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

// Export the implementation layers
export { TabsServiceLive, TabsServiceTest } from "./implementation.ts"

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
