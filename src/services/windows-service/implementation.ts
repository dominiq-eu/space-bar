import { Effect, Layer } from "effect"
import { BrowserApiService } from "../browser-api-service/index.ts"
import { WindowsService } from "./types.ts"
import {
  InvalidWindowDataError,
  WindowNotFoundError,
  WindowOperationFailedError,
} from "./errors.ts"
import type { Window, WindowId } from "../state-service/types.ts"
import type { WindowEventListener } from "./events.ts"
import { mapChromeWindow, mapChromeWindows } from "./mappers.ts"

// ============================================================================
// Service Implementation
// ============================================================================

const make = Effect.gen(function* () {
  const browserApi = yield* BrowserApiService

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * Get all open windows
   * Uses mappers for proper validation and error handling
   */
  const getWindows = (): Effect.Effect<Window[], never> =>
    Effect.gen(function* () {
      const chromeWindows = yield* browserApi.windows.getAll({})
      const windows = yield* mapChromeWindows(chromeWindows).pipe(
        Effect.catchAll(() => Effect.succeed([])), // Return empty on error
      )
      return windows
    })

  /**
   * Get a specific window by ID
   */
  const getWindow = (
    windowId: WindowId,
  ): Effect.Effect<Window, WindowNotFoundError | InvalidWindowDataError> =>
    Effect.gen(function* () {
      const chromeWindow = yield* browserApi.windows.get(windowId).pipe(
        Effect.mapError(() => new WindowNotFoundError({ windowId })),
      )
      return yield* mapChromeWindow(chromeWindow)
    })

  /**
   * Get current window
   * Returns our domain Window, not Chrome's
   */
  const getCurrentWindow = (): Effect.Effect<
    Window,
    WindowNotFoundError | InvalidWindowDataError
  > =>
    Effect.gen(function* () {
      const chromeWindow = yield* browserApi.windows.getCurrent().pipe(
        Effect.mapError(() =>
          new WindowNotFoundError({ windowId: -1 as WindowId })
        ),
      )
      return yield* mapChromeWindow(chromeWindow)
    })

  // ==========================================================================
  // Window Operations
  // ==========================================================================

  /**
   * Create a new window
   * Returns our domain Window, not Chrome's
   */
  const createWindow = (options?: {
    url?: string | string[]
    focused?: boolean
    incognito?: boolean
    type?: "normal" | "popup" | "panel"
  }): Effect.Effect<
    Window,
    WindowOperationFailedError | InvalidWindowDataError
  > =>
    Effect.gen(function* () {
      const chromeWindow = yield* browserApi.windows.create(options ?? {})
        .pipe(
          Effect.mapError((error) =>
            new WindowOperationFailedError({
              operation: "create",
              reason: error.reason,
            })
          ),
        )

      return yield* mapChromeWindow(chromeWindow)
    })

  /**
   * Update a window (focus, bounds, etc.)
   */
  const updateWindow = (
    windowId: WindowId,
    options: {
      focused?: boolean
      drawAttention?: boolean
      state?: "normal" | "minimized" | "maximized" | "fullscreen"
    },
  ): Effect.Effect<
    Window,
    WindowOperationFailedError | InvalidWindowDataError
  > =>
    Effect.gen(function* () {
      const chromeWindow = yield* browserApi.windows.update(
        windowId,
        options,
      ).pipe(
        Effect.mapError((error) =>
          new WindowOperationFailedError({
            operation: "update",
            reason: error.reason,
            windowId,
          })
        ),
      )

      return yield* mapChromeWindow(chromeWindow)
    })

  /**
   * Focus a window
   */
  const focusWindow = (
    windowId: WindowId,
  ): Effect.Effect<
    Window,
    WindowOperationFailedError | InvalidWindowDataError
  > => updateWindow(windowId, { focused: true })

  /**
   * Remove/close a window
   */
  const removeWindow = (
    windowId: WindowId,
  ): Effect.Effect<void, WindowOperationFailedError> =>
    browserApi.windows.remove(windowId).pipe(
      Effect.mapError((error) =>
        new WindowOperationFailedError({
          operation: "remove",
          reason: error.reason,
          windowId,
        })
      ),
    )

  // ==========================================================================
  // Event Subscription
  // ==========================================================================

  /**
   * Subscribe to all window events
   * Returns cleanup function to unsubscribe
   */
  const subscribeToWindowEvents = (
    listener: WindowEventListener,
  ): () => void => {
    // Window Created
    const onWindowCreated = browserApi.events.onWindowCreated(
      (chromeWindow) => {
        if (chromeWindow.id !== undefined) {
          listener({
            type: "window-created" as const,
            windowId: chromeWindow.id as WindowId,
          })
        }
      },
    )

    // Window Removed
    const onWindowRemoved = browserApi.events.onWindowRemoved((windowId) => {
      listener({
        type: "window-removed" as const,
        windowId: windowId as WindowId,
      })
    })

    // Window Focus Changed
    const onWindowFocusChanged = browserApi.events.onWindowFocusChanged(
      (windowId) => {
        // windowId can be -1 when no window has focus
        if (windowId !== -1) {
          listener({
            type: "window-focus-changed" as const,
            windowId: windowId as WindowId,
          })
        }
      },
    )

    // Return cleanup function that removes all listeners
    return () => {
      onWindowCreated()
      onWindowRemoved()
      onWindowFocusChanged()
    }
  }

  return {
    getWindows,
    getWindow,
    getCurrentWindow,
    createWindow,
    updateWindow,
    focusWindow,
    removeWindow,
    subscribeToWindowEvents,
  } satisfies WindowsService
})

// ============================================================================
// Layer
// ============================================================================

/**
 * WindowsService Live Layer
 *
 * Dependencies:
 * - BrowserApiService (for all Chrome API calls)
 */
export const WindowsServiceLive = Layer.effect(WindowsService, make)
