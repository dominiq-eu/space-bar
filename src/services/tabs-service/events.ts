import { Schema } from "effect"
import { GroupId, Tab, TabId, WindowId } from "../state-service/types.ts"

/**
 * Tab Created Event
 * Fired when a new tab is created
 */
export const TabCreatedEvent = Schema.Struct({
  type: Schema.Literal("tab-created"),
  tab: Tab,
})
export type TabCreatedEvent = Schema.Schema.Type<typeof TabCreatedEvent>

/**
 * Tab Updated Event
 * Fired when a tab is updated (URL, title, favicon, etc.)
 */
export const TabUpdatedEvent = Schema.Struct({
  type: Schema.Literal("tab-updated"),
  tabId: TabId,
  windowId: WindowId,
  changes: Schema.Struct({
    url: Schema.optional(Schema.URL),
    title: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
    favIconUrl: Schema.optional(Schema.OptionFromSelf(Schema.URL)),
    pinned: Schema.optional(Schema.Boolean),
    groupId: Schema.optional(Schema.OptionFromSelf(GroupId)),
  }),
})
export type TabUpdatedEvent = Schema.Schema.Type<typeof TabUpdatedEvent>

/**
 * Tab Removed Event
 * Fired when a tab is closed
 */
export const TabRemovedEvent = Schema.Struct({
  type: Schema.Literal("tab-removed"),
  tabId: TabId,
  windowId: WindowId,
  isWindowClosing: Schema.Boolean,
})
export type TabRemovedEvent = Schema.Schema.Type<typeof TabRemovedEvent>

/**
 * Tab Moved Event
 * Fired when a tab is moved within a window or to another window
 */
export const TabMovedEvent = Schema.Struct({
  type: Schema.Literal("tab-moved"),
  tabId: TabId,
  windowId: WindowId,
  fromIndex: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  toIndex: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})
export type TabMovedEvent = Schema.Schema.Type<typeof TabMovedEvent>

/**
 * Tab Attached Event
 * Fired when a tab is attached to a window
 */
export const TabAttachedEvent = Schema.Struct({
  type: Schema.Literal("tab-attached"),
  tabId: TabId,
  newWindowId: WindowId,
  newPosition: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})
export type TabAttachedEvent = Schema.Schema.Type<typeof TabAttachedEvent>

/**
 * Tab Detached Event
 * Fired when a tab is detached from a window
 */
export const TabDetachedEvent = Schema.Struct({
  type: Schema.Literal("tab-detached"),
  tabId: TabId,
  oldWindowId: WindowId,
  oldPosition: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})
export type TabDetachedEvent = Schema.Schema.Type<typeof TabDetachedEvent>

/**
 * Tab Activated Event
 * Fired when a tab becomes active
 */
export const TabActivatedEvent = Schema.Struct({
  type: Schema.Literal("tab-activated"),
  tabId: TabId,
  windowId: WindowId,
  previousTabId: Schema.optional(TabId),
})
export type TabActivatedEvent = Schema.Schema.Type<typeof TabActivatedEvent>

/**
 * Tab Group Created Event
 */
export const TabGroupCreatedEvent = Schema.Struct({
  type: Schema.Literal("tab-group-created"),
  groupId: GroupId,
  windowId: WindowId,
})
export type TabGroupCreatedEvent = Schema.Schema.Type<
  typeof TabGroupCreatedEvent
>

/**
 * Tab Group Updated Event
 */
export const TabGroupUpdatedEvent = Schema.Struct({
  type: Schema.Literal("tab-group-updated"),
  groupId: GroupId,
  windowId: WindowId,
  changes: Schema.Struct({
    title: Schema.optional(
      Schema.OptionFromSelf(Schema.String.pipe(Schema.minLength(1))),
    ),
    color: Schema.optional(
      Schema.Literal(
        "grey",
        "blue",
        "red",
        "yellow",
        "green",
        "pink",
        "purple",
        "cyan",
        "orange",
      ),
    ),
    collapsed: Schema.optional(Schema.Boolean),
  }),
})
export type TabGroupUpdatedEvent = Schema.Schema.Type<
  typeof TabGroupUpdatedEvent
>

/**
 * Tab Group Removed Event
 */
export const TabGroupRemovedEvent = Schema.Struct({
  type: Schema.Literal("tab-group-removed"),
  groupId: GroupId,
  windowId: WindowId,
})
export type TabGroupRemovedEvent = Schema.Schema.Type<
  typeof TabGroupRemovedEvent
>

/**
 * Union of all tab events
 */
export const TabEvent = Schema.Union(
  TabCreatedEvent,
  TabUpdatedEvent,
  TabRemovedEvent,
  TabMovedEvent,
  TabAttachedEvent,
  TabDetachedEvent,
  TabActivatedEvent,
  TabGroupCreatedEvent,
  TabGroupUpdatedEvent,
  TabGroupRemovedEvent,
)
export type TabEvent = Schema.Schema.Type<typeof TabEvent>

/**
 * Tab event listener callback
 */
export type TabEventListener = (event: TabEvent) => void
