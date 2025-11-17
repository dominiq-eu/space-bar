import { Effect, Schema } from "effect"
import { Window } from "../state-service/types.ts"

/**
 * Get all open windows with schema validation
 */
export const getWindows = () =>
  Effect.async<Window[]>((resume) => {
    chrome.windows.getAll({}, (windows) => {
      const decodeResults = windows.map((window) =>
        Schema.decodeUnknown(Window)({
          id: window.id,
          focused: window.focused,
          type: window.type,
        }),
      )

      Effect.all(decodeResults).pipe(Effect.runSync, (result) =>
        resume(Effect.succeed(result)),
      )
    })
  })

/**
 * Get current window
 */
export const getCurrentWindow = () =>
  Effect.async<chrome.windows.Window>((resume) => {
    chrome.windows.getCurrent((window) => {
      resume(Effect.succeed(window))
    })
  })

/**
 * Create a new window
 */
export const createWindow = () =>
  Effect.async<chrome.windows.Window>((resume) => {
    chrome.windows.create({}, (window) => {
      if (window) {
        resume(Effect.succeed(window))
      }
    })
  })
