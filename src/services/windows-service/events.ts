import { Schema } from "effect"
import { WindowId } from "../state-service/types.ts"

/**
 * Window Created Event
 */
export const WindowCreatedEvent = Schema.Struct({
  type: Schema.Literal("window-created"),
  windowId: WindowId,
})
export type WindowCreatedEvent = Schema.Schema.Type<typeof WindowCreatedEvent>

/**
 * Window Removed Event
 */
export const WindowRemovedEvent = Schema.Struct({
  type: Schema.Literal("window-removed"),
  windowId: WindowId,
})
export type WindowRemovedEvent = Schema.Schema.Type<typeof WindowRemovedEvent>

/**
 * Window Focus Changed Event
 */
export const WindowFocusChangedEvent = Schema.Struct({
  type: Schema.Literal("window-focus-changed"),
  windowId: WindowId,
})
export type WindowFocusChangedEvent = Schema.Schema.Type<
  typeof WindowFocusChangedEvent
>

/**
 * Union of all window events
 */
export const WindowEvent = Schema.Union(
  WindowCreatedEvent,
  WindowRemovedEvent,
  WindowFocusChangedEvent,
)
export type WindowEvent = Schema.Schema.Type<typeof WindowEvent>

/**
 * Window event listener callback
 */
export type WindowEventListener = (event: WindowEvent) => void
