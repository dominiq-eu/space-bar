import { Option, Schema } from "effect"

// ============================================================================
// Branded ID Types
// ============================================================================

/**
 * Branded Tab ID - verhindert versehentliche ID-Verwechslungen
 */
export const TabId = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.brand("TabId"),
)
export type TabId = Schema.Schema.Type<typeof TabId>

/**
 * Branded Window ID
 */
export const WindowId = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.brand("WindowId"),
)
export type WindowId = Schema.Schema.Type<typeof WindowId>

/**
 * Branded Group ID
 */
export const GroupId = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.brand("GroupId"),
)
export type GroupId = Schema.Schema.Type<typeof GroupId>

/**
 * Branded Workspace ID (string-based, from Chrome Bookmarks API)
 */
export const WorkspaceId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("WorkspaceId"),
)
export type WorkspaceId = Schema.Schema.Type<typeof WorkspaceId>

// ============================================================================
// Tab Group Color
// ============================================================================

/**
 * Valid Chrome tab group colors
 */
export const TabGroupColor = Schema.Literal(
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
)
export type TabGroupColor = Schema.Schema.Type<typeof TabGroupColor>

// ============================================================================
// Window Type
// ============================================================================

/**
 * Chrome window types
 */
export const WindowType = Schema.Literal(
  "normal",
  "popup",
  "panel",
  "app",
  "devtools",
)
export type WindowType = Schema.Schema.Type<typeof WindowType>

// ============================================================================
// Domain Models
// ============================================================================

/**
 * Tab - represents an existing browser tab
 *
 * All fields are ALWAYS present (no optional!)
 * Uses Option<T> for truly optional values (favIconUrl, groupId)
 * Uses Effect's built-in URL Schema for validated URLs
 */
export const Tab = Schema.Struct({
  id: TabId,
  windowId: WindowId,
  title: Schema.String.pipe(Schema.minLength(1)),
  url: Schema.URL, // 🔥 Effect's built-in URL Schema!
  favIconUrl: Schema.OptionFromSelf(Schema.URL), // Option<URL>
  active: Schema.Boolean,
  groupId: Schema.OptionFromSelf(GroupId), // Option<GroupId> - kein null!
  pinned: Schema.Boolean,
})
export type Tab = Schema.Schema.Type<typeof Tab>

/**
 * Mutable version of Tab for partial updates
 */
export type TabChanges = {
  url?: URL
  title?: string
  favIconUrl?: Option.Option<URL>
  pinned?: boolean
  groupId?: Option.Option<GroupId>
}

/**
 * TabGroup - represents a tab group
 */
export const TabGroup = Schema.Struct({
  id: GroupId,
  title: Schema.OptionFromSelf(Schema.String.pipe(Schema.minLength(1))),
  color: TabGroupColor,
  collapsed: Schema.Boolean,
})
export type TabGroup = Schema.Schema.Type<typeof TabGroup>

/**
 * Window - represents a browser window
 */
export const Window = Schema.Struct({
  id: WindowId,
  focused: Schema.Boolean,
  type: WindowType,
})
export type Window = Schema.Schema.Type<typeof Window>

/**
 * AppState - complete application state
 */
export const AppState = Schema.Struct({
  timestamp: Schema.Date,
  tabs: Schema.Array(Tab),
  tabGroups: Schema.Array(TabGroup),
  windows: Schema.Array(Window),
})
export type AppState = Schema.Schema.Type<typeof AppState>
