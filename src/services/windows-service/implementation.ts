import { Effect, Layer, Schema } from "effect"
import { BrowserApiService } from "../browser-api-service/index.ts"
import { WindowsService } from "./types.ts"
import {
  InvalidWindowDataError,
  WindowNotFoundError,
  WindowOperationFailedError,
} from "./errors.ts"
import type { Window, WindowId } from "../state-service/schema.ts"
import type { WindowEventListener } from "./events.ts"
import { mapChromeWindow, mapChromeWindows } from "./mappers.ts"
import { WindowId as WindowIdSchema } from "../state-service/schema.ts"
import { annotateOperation } from "../../utils/logging.ts"

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
        Effect.tapError((error) =>
          Effect.logWarning(
            "Some windows failed validation, returning valid windows only",
            error,
          ).pipe(
            Effect.annotateLogs({ totalWindows: chromeWindows.length }),
          )
        ),
        Effect.catchAll(() => Effect.succeed([])),
      )
      return windows
    }).pipe(
      annotateOperation("WindowsService", "getWindows"),
    )

  /**
   * Get a specific window by ID
   */
  const getWindow = (
    windowId: WindowId,
  ): Effect.Effect<
    Window,
    | WindowNotFoundError
    | InvalidWindowDataError
    | import("../validation-service/index.ts").InvalidIdError
  > =>
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
    | WindowNotFoundError
    | InvalidWindowDataError
    | import("../validation-service/index.ts").InvalidIdError
  > =>
    Effect.gen(function* () {
      const chromeWindow = yield* browserApi.windows.getCurrent().pipe(
        Effect.mapError(() => new WindowNotFoundError({ windowId: -1 })),
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
    | WindowOperationFailedError
    | InvalidWindowDataError
    | import("../validation-service/index.ts").InvalidIdError
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
    | WindowOperationFailedError
    | InvalidWindowDataError
    | import("../validation-service/index.ts").InvalidIdError
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
    | WindowOperationFailedError
    | InvalidWindowDataError
    | import("../validation-service/index.ts").InvalidIdError
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
          try {
            const validatedWindowId = Schema.decodeSync(WindowIdSchema)(
              chromeWindow.id,
            )
            listener({
              type: "window-created" as const,
              windowId: validatedWindowId,
            })
          } catch (error) {
            Effect.runFork(
              Effect.logWarning("Invalid window ID in onWindowCreated", error)
                .pipe(
                  Effect.annotateLogs({ windowId: chromeWindow.id }),
                ),
            )
          }
        }
      },
    )

    // Window Removed
    const onWindowRemoved = browserApi.events.onWindowRemoved((windowId) => {
      try {
        const validatedWindowId = Schema.decodeSync(WindowIdSchema)(windowId)
        listener({
          type: "window-removed" as const,
          windowId: validatedWindowId,
        })
      } catch (error) {
        Effect.runFork(
          Effect.logWarning("Invalid window ID in onWindowRemoved", error).pipe(
            Effect.annotateLogs({ windowId }),
          ),
        )
      }
    })

    // Window Focus Changed
    const onWindowFocusChanged = browserApi.events.onWindowFocusChanged(
      (windowId) => {
        // windowId can be -1 when no window has focus
        if (windowId !== -1) {
          try {
            const validatedWindowId = Schema.decodeSync(WindowIdSchema)(
              windowId,
            )
            listener({
              type: "window-focus-changed" as const,
              windowId: validatedWindowId,
            })
          } catch (error) {
            Effect.runFork(
              Effect.logWarning(
                "Invalid window ID in onWindowFocusChanged",
                error,
              ).pipe(
                Effect.annotateLogs({ windowId }),
              ),
            )
          }
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
 * Base WindowsService layer without dependencies provided.
 * Use this for testing with mock dependencies.
 */
const WindowsServiceLayer = Layer.effect(WindowsService, make)

/**
 * WindowsService Live Layer
 *
 * Dependencies:
 * - BrowserApiService (for all Chrome API calls)
 */
export const WindowsServiceLive = WindowsServiceLayer

/**
 * WindowsService layer for testing.
 * Does NOT provide BrowserApiService - caller must provide it.
 *
 * Usage in tests:
 * ```typescript
 * const mockLayer = createMockBrowserApiService()
 * const testLayer = WindowsServiceTest.pipe(Layer.provide(mockLayer))
 * ```
 */
export const WindowsServiceTest = WindowsServiceLayer
