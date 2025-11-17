import { Schema } from "effect"

// Schemas
export const TabGroup = Schema.Struct({
  id: Schema.Number,
  title: Schema.optional(Schema.String),
  color: Schema.String,
  collapsed: Schema.Boolean,
})

export const Tab = Schema.Struct({
  id: Schema.optional(Schema.Number),
  windowId: Schema.optional(Schema.Number),
  title: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  favIconUrl: Schema.optional(Schema.String),
  active: Schema.Boolean,
  groupId: Schema.optional(Schema.Number),
  pinned: Schema.Boolean,
})

export const Window = Schema.Struct({
  id: Schema.optional(Schema.Number),
  focused: Schema.Boolean,
  type: Schema.optional(Schema.String),
})

export const AppState = Schema.Struct({
  timestamp: Schema.Date,
  tabs: Schema.Array(Tab),
  tabGroups: Schema.Array(TabGroup),
  windows: Schema.Array(Window),
})

// Types
export type TabGroup = Schema.Schema.Type<typeof TabGroup>
export type Tab = Schema.Schema.Type<typeof Tab>
export type Window = Schema.Schema.Type<typeof Window>
export type AppState = Schema.Schema.Type<typeof AppState>
