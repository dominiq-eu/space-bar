import { Effect } from "effect"
import { Window, WindowId, WindowType } from "../state-service/types.ts"
import { InvalidWindowDataError } from "./errors.ts"

/**
 * Map Chrome Window → Domain Window
 *
 * Returns Effect with typed errors
 */
export function mapChromeWindow(
  chromeWindow: chrome.windows.Window,
): Effect.Effect<Window, InvalidWindowDataError> {
  return Effect.gen(function* () {
    // Validate required fields
    if (chromeWindow.id === undefined) {
      return yield* Effect.fail(
        new InvalidWindowDataError({
          reason: "Missing required field: id",
          data: chromeWindow,
        }),
      )
    }

    // Validate window type
    const validTypes: WindowType[] = [
      "normal",
      "popup",
      "panel",
      "app",
      "devtools",
    ]
    if (
      !chromeWindow.type ||
      !validTypes.includes(chromeWindow.type as WindowType)
    ) {
      return yield* Effect.fail(
        new InvalidWindowDataError({
          reason: `Invalid window type: ${chromeWindow.type}`,
          data: chromeWindow,
        }),
      )
    }

    // Build Window
    const window: Window = {
      id: chromeWindow.id as WindowId,
      focused: chromeWindow.focused ?? false,
      type: chromeWindow.type as WindowType,
    }

    return window
  })
}

/**
 * Map array of Chrome Windows → Domain Windows
 *
 * Filters out invalid windows (logs errors)
 */
export function mapChromeWindows(
  chromeWindows: chrome.windows.Window[],
): Effect.Effect<Window[]> {
  return Effect.gen(function* () {
    const results = yield* Effect.forEach(
      chromeWindows,
      (chromeWindow) => mapChromeWindow(chromeWindow).pipe(Effect.either),
      { concurrency: "unbounded" },
    )

    const validWindows: Window[] = []
    for (const result of results) {
      if (result._tag === "Right") {
        validWindows.push(result.right)
      } else {
        console.warn("Failed to map Chrome window:", result.left)
      }
    }

    return validWindows
  })
}
