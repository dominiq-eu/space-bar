import { Context, Effect } from "effect"
import type { Window, WindowId } from "../state-service/schema.ts"

// Re-export error types
export {
  InvalidWindowDataError,
  WindowNotFoundError,
  WindowOperationFailedError,
} from "./errors.ts"

// Re-export event types
export type {
  WindowCreatedEvent,
  WindowEvent,
  WindowEventListener,
  WindowFocusChangedEvent,
  WindowRemovedEvent,
} from "./events.ts"

// ============================================================================
// WindowsService Interface
// ============================================================================

/**
 * WindowsService
 *
 * High-level service for window operations.
 * Wraps BrowserApiService with domain-specific logic and validation.
 *
 * Responsibilities:
 * - Window CRUD operations (get, create, update, remove)
 * - Window focus and state management
 * - Event subscription for window changes
 * - Data validation and mapping between Chrome types and domain types
 *
 * Dependencies:
 * - BrowserApiService for all Chrome API calls
 */
export interface WindowsService {
  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * Get all open windows
   * Returns validated domain Window objects
   * Never fails - invalid windows are filtered out
   */
  readonly getWindows: () => Effect.Effect<Window[], never>

  /**
   * Get a specific window by ID
   * Fails if window doesn't exist or has invalid data
   */
  readonly getWindow: (
    windowId: WindowId,
  ) => Effect.Effect<
    Window,
    | import("./errors.ts").WindowNotFoundError
    | import("./errors.ts").InvalidWindowDataError
    | import("../validation-service/index.ts").InvalidIdError
  >

  /**
   * Get the current window (where the extension is running)
   * Fails if window doesn't exist or has invalid data
   */
  readonly getCurrentWindow: () => Effect.Effect<
    Window,
    | import("./errors.ts").WindowNotFoundError
    | import("./errors.ts").InvalidWindowDataError
    | import("../validation-service/index.ts").InvalidIdError
  >

  // ==========================================================================
  // Window Operations
  // ==========================================================================

  /**
   * Create a new window
   * Returns validated domain Window object
   */
  readonly createWindow: (options?: {
    url?: string | string[]
    focused?: boolean
    incognito?: boolean
    type?: "normal" | "popup" | "panel"
  }) => Effect.Effect<
    Window,
    | import("./errors.ts").WindowOperationFailedError
    | import("./errors.ts").InvalidWindowDataError
    | import("../validation-service/index.ts").InvalidIdError
  >

  /**
   * Update a window's properties (focus, bounds, state)
   */
  readonly updateWindow: (
    windowId: WindowId,
    options: {
      focused?: boolean
      drawAttention?: boolean
      state?: "normal" | "minimized" | "maximized" | "fullscreen"
    },
  ) => Effect.Effect<
    Window,
    | import("./errors.ts").WindowOperationFailedError
    | import("./errors.ts").InvalidWindowDataError
    | import("../validation-service/index.ts").InvalidIdError
  >

  /**
   * Focus a window (make it the active window)
   */
  readonly focusWindow: (
    windowId: WindowId,
  ) => Effect.Effect<
    Window,
    | import("./errors.ts").WindowOperationFailedError
    | import("./errors.ts").InvalidWindowDataError
    | import("../validation-service/index.ts").InvalidIdError
  >

  /**
   * Remove/close a window
   */
  readonly removeWindow: (
    windowId: WindowId,
  ) => Effect.Effect<void, import("./errors.ts").WindowOperationFailedError>

  // ==========================================================================
  // Event Subscription
  // ==========================================================================

  /**
   * Subscribe to all window events
   * Returns cleanup function to unsubscribe
   *
   * Events include:
   * - window-created
   * - window-removed
   * - window-focus-changed
   */
  readonly subscribeToWindowEvents: (
    listener: import("./events.ts").WindowEventListener,
  ) => () => void
}

// ============================================================================
// Context Tag
// ============================================================================

/**
 * WindowsService Context Tag
 *
 * Use this to inject WindowsService:
 *
 * ```typescript
 * const make = Effect.gen(function*() {
 *   const windows = yield* WindowsService
 *
 *   yield* windows.createWindow({ url: "https://example.com" })
 * })
 * ```
 */
export const WindowsService = Context.GenericTag<WindowsService>(
  "WindowsService",
)
