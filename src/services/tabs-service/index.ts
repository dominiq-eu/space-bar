import { Effect, Schema } from "effect"
import { Tab, TabGroup } from "../state-service/types.ts"

// Re-export constants
export * from "./constants.ts"

/**
 * Get all tabs from all windows with schema validation
 */
export const getTabs = () =>
  Effect.async<Tab[]>((resume) => {
    chrome.tabs.query({}, (tabs) => {
      const decodeResults = tabs.map((tab) =>
        Schema.decodeUnknown(Tab)({
          id: tab.id,
          windowId: tab.windowId,
          title: tab.title || "Untitled",
          url: tab.url,
          favIconUrl: tab.favIconUrl,
          active: tab.active,
          groupId: tab.groupId !== -1 ? tab.groupId : undefined,
          pinned: tab.pinned,
        }),
      )

      Effect.all(decodeResults).pipe(Effect.runSync, (result) =>
        resume(Effect.succeed(result)),
      )
    })
  })

/**
 * Get all tab groups with schema validation
 */
export const getTabGroups = () =>
  Effect.async<TabGroup[]>((resume) => {
    chrome.tabGroups.query({}, (groups) => {
      const decodeResults = groups.map((group) =>
        Schema.decodeUnknown(TabGroup)({
          id: group.id,
          title: group.title || undefined,
          color: group.color,
          collapsed: group.collapsed,
        }),
      )

      Effect.all(decodeResults).pipe(Effect.runSync, (result) =>
        resume(Effect.succeed(result)),
      )
    })
  })

/**
 * Create a new tab
 */
export const createTab = (options: chrome.tabs.CreateProperties) =>
  Effect.async<chrome.tabs.Tab>((resume) => {
    chrome.tabs.create(options, (tab) => {
      if (tab) {
        resume(Effect.succeed(tab))
      }
    })
  })

/**
 * Update a tab (e.g., activate it)
 */
export const updateTab = (tabId: number, updateProperties: chrome.tabs.UpdateProperties) =>
  Effect.async<chrome.tabs.Tab>((resume) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      if (tab) {
        resume(Effect.succeed(tab))
      }
    })
  })

/**
 * Activate a tab
 */
export const activateTab = (tabId: number) =>
  updateTab(tabId, { active: true })

/**
 * Close/remove a tab
 */
export const removeTab = (tabId: number) =>
  Effect.async<void>((resume) => {
    chrome.tabs.remove(tabId, () => {
      resume(Effect.succeed(undefined))
    })
  })

/**
 * Close/remove multiple tabs
 */
export const removeTabs = (tabIds: number[]) =>
  Effect.async<void>((resume) => {
    chrome.tabs.remove(tabIds, () => {
      resume(Effect.succeed(undefined))
    })
  })

/**
 * Move tab to a different window or position
 */
export const moveTab = (tabId: number, moveProperties: chrome.tabs.MoveProperties) =>
  Effect.async<chrome.tabs.Tab | chrome.tabs.Tab[]>((resume) => {
    chrome.tabs.move(tabId, moveProperties, (result) => {
      resume(Effect.succeed(result))
    })
  })

/**
 * Group tabs together
 */
export const groupTabs = (options: chrome.tabs.GroupOptions) =>
  Effect.async<number>((resume) => {
    chrome.tabs.group(options, (groupId) => {
      resume(Effect.succeed(groupId))
    })
  })

/**
 * Ungroup tabs
 */
export const ungroupTabs = (tabIds: number[]) =>
  Effect.async<void>((resume) => {
    chrome.tabs.ungroup(tabIds, () => {
      resume(Effect.succeed(undefined))
    })
  })

/**
 * Update a tab group (title, color, collapsed state)
 */
export const updateTabGroup = (groupId: number, updateProperties: chrome.tabGroups.UpdateProperties) =>
  Effect.async<chrome.tabGroups.TabGroup>((resume) => {
    chrome.tabGroups.update(groupId, updateProperties, (group) => {
      resume(Effect.succeed(group))
    })
  })

/**
 * Toggle group collapsed state
 */
export const toggleGroupCollapsed = (groupId: number, currentState: boolean) =>
  updateTabGroup(groupId, { collapsed: !currentState })
