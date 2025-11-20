import { Effect } from "effect"
import { Window, WindowId } from "../state-service/types.ts"
import { mapChromeWindow, mapChromeWindows } from "./mappers.ts"
import {
  InvalidWindowDataError,
  WindowNotFoundError,
  WindowOperationFailedError,
} from "./errors.ts"
import type {
  WindowCreatedEvent,
  WindowEvent,
  WindowEventListener,
  WindowFocusChangedEvent,
  WindowRemovedEvent,
} from "./events.ts"

// Re-export event types
export type {
  WindowCreatedEvent,
  WindowEvent,
  WindowEventListener,
  WindowFocusChangedEvent,
  WindowRemovedEvent,
}

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Get all open windows
 * Uses mappers for proper validation and error handling
 */
export const getWindows = (): Effect.Effect<Window[]> =>
  Effect.async<Window[], never>((resume) => {
    chrome.windows.getAll({}, (chromeWindows) => {
      Effect.runPromise(mapChromeWindows(chromeWindows))
        .then((windows) => resume(Effect.succeed(windows)))
        .catch(() => resume(Effect.succeed([]))) // Return empty on error, invalid windows filtered
    })
  })

/**
 * Get a specific window by ID
 */
export const getWindow = (
  windowId: WindowId,
): Effect.Effect<Window, WindowNotFoundError | InvalidWindowDataError> =>
  Effect.gen(function* () {
    const chromeWindow = yield* Effect.async<
      chrome.windows.Window,
      WindowNotFoundError
    >((resume) => {
      chrome.windows.get(windowId, (window) => {
        if (chrome.runtime.lastError) {
          resume(Effect.fail(new WindowNotFoundError({ windowId })))
        } else {
          resume(Effect.succeed(window))
        }
      })
    })

    return yield* mapChromeWindow(chromeWindow)
  })

/**
 * Get current window
 * Returns our domain Window, not Chrome's
 */
export const getCurrentWindow = (): Effect.Effect<
  Window,
  WindowNotFoundError | InvalidWindowDataError
> =>
  Effect.gen(function* () {
    const chromeWindow = yield* Effect.async<
      chrome.windows.Window,
      WindowNotFoundError
    >((resume) => {
      chrome.windows.getCurrent((window) => {
        if (chrome.runtime.lastError) {
          resume(
            Effect.fail(
              new WindowNotFoundError({ windowId: window?.id ?? -1 }),
            ),
          )
        } else {
          resume(Effect.succeed(window))
        }
      })
    })

    return yield* mapChromeWindow(chromeWindow)
  })

// ============================================================================
// Window Operations
// ============================================================================

/**
 * Create a new window
 * Returns our domain Window, not Chrome's
 */
export const createWindow = (options?: {
  url?: string | string[]
  focused?: boolean
  incognito?: boolean
  type?: "normal" | "popup" | "panel"
}): Effect.Effect<
  Window,
  WindowOperationFailedError | InvalidWindowDataError
> =>
  Effect.gen(function* () {
    const chromeWindow = yield* Effect.async<
      chrome.windows.Window,
      WindowOperationFailedError
    >((resume) => {
      chrome.windows.create(options ?? {}, (window) => {
        if (chrome.runtime.lastError || !window) {
          resume(
            Effect.fail(
              new WindowOperationFailedError({
                operation: "create",
                reason: chrome.runtime.lastError?.message || "Unknown error",
              }),
            ),
          )
        } else {
          resume(Effect.succeed(window))
        }
      })
    })

    return yield* mapChromeWindow(chromeWindow)
  })

/**
 * Update a window (focus, bounds, etc.)
 */
export const updateWindow = (
  windowId: WindowId,
  options: {
    focused?: boolean
    drawAttention?: boolean
    state?: "normal" | "minimized" | "maximized" | "fullscreen"
  },
): Effect.Effect<Window, WindowOperationFailedError | InvalidWindowDataError> =>
  Effect.gen(function* () {
    const chromeWindow = yield* Effect.async<
      chrome.windows.Window,
      WindowOperationFailedError
    >((resume) => {
      chrome.windows.update(windowId, options, (window) => {
        if (chrome.runtime.lastError || !window) {
          resume(
            Effect.fail(
              new WindowOperationFailedError({
                operation: "update",
                reason: chrome.runtime.lastError?.message || "Unknown error",
                windowId,
              }),
            ),
          )
        } else {
          resume(Effect.succeed(window))
        }
      })
    })

    return yield* mapChromeWindow(chromeWindow)
  })

/**
 * Focus a window
 */
export const focusWindow = (
  windowId: WindowId,
): Effect.Effect<Window, WindowOperationFailedError | InvalidWindowDataError> =>
  updateWindow(windowId, { focused: true })

/**
 * Remove/close a window
 */
export const removeWindow = (
  windowId: WindowId,
): Effect.Effect<void, WindowOperationFailedError> =>
  Effect.async<void, WindowOperationFailedError>((resume) => {
    chrome.windows.remove(windowId, () => {
      if (chrome.runtime.lastError) {
        resume(
          Effect.fail(
            new WindowOperationFailedError({
              operation: "remove",
              reason: chrome.runtime.lastError.message || "Unknown error",
              windowId,
            }),
          ),
        )
      } else {
        resume(Effect.succeed(undefined))
      }
    })
  })

// ============================================================================
// Event Subscription
// ============================================================================

/**
 * Subscribe to all window events
 * Returns cleanup function to unsubscribe
 */
export const subscribeToWindowEvents = (
  listener: WindowEventListener,
): () => void => {
  // Window Created
  const onWindowCreated = (chromeWindow: chrome.windows.Window) => {
    if (chromeWindow.id !== undefined) {
      listener({
        type: "window-created" as const,
        windowId: chromeWindow.id as WindowId,
      })
    }
  }

  // Window Removed
  const onWindowRemoved = (windowId: number) => {
    listener({
      type: "window-removed" as const,
      windowId: windowId as WindowId,
    })
  }

  // Window Focus Changed
  const onWindowFocusChanged = (windowId: number) => {
    // windowId can be -1 when no window has focus
    if (windowId !== -1) {
      listener({
        type: "window-focus-changed" as const,
        windowId: windowId as WindowId,
      })
    }
  }

  // Register listeners
  chrome.windows.onCreated.addListener(onWindowCreated)
  chrome.windows.onRemoved.addListener(onWindowRemoved)
  chrome.windows.onFocusChanged.addListener(onWindowFocusChanged)

  // Return cleanup function
  return () => {
    chrome.windows.onCreated.removeListener(onWindowCreated)
    chrome.windows.onRemoved.removeListener(onWindowRemoved)
    chrome.windows.onFocusChanged.removeListener(onWindowFocusChanged)
  }
}
