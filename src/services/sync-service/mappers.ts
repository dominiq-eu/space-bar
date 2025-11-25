// ============================================================================
// Mappers - Convert Chrome Types to Normalized State
// ============================================================================

import { Effect } from "effect"
import type { NormalizedGroup, NormalizedItem, NormalizedState } from "./reconciliation.ts"
import {
  parseBookmarkPinnedStatus,
  parseGroupMetadata,
  PINNED_FOLDER_NAME,
} from "../workspaces-service/metadata-parser.ts"
import { urlToString } from "../../utils/type-conversions.ts"

// ============================================================================
// Chrome Tabs → Normalized State
// ============================================================================

/**
 * Map Chrome Tabs and Tab Groups to Normalized State
 *
 * ✅ Merges duplicate tab groups with same name+color to avoid data loss
 *
 * @param tabs - Chrome tabs from chrome.tabs.query()
 * @param groups - Chrome tab groups from chrome.tabGroups.query()
 * @returns Effect that yields NormalizedState
 */
export const mapTabsToNormalizedState = (
  tabs: chrome.tabs.Tab[],
  groups: chrome.tabGroups.TabGroup[],
): Effect.Effect<NormalizedState> =>
  Effect.gen(function* () {
    // ✅ MERGE LOGIC: Group tab groups by title+color
    // Key format: "title|color"
    const makeGroupKey = (title: string, color: string) => `${title}|${color}`

    const groupsByKey = new Map<string, chrome.tabGroups.TabGroup[]>()

    for (const group of groups) {
      const key = makeGroupKey(group.title || "", group.color)
      const existing = groupsByKey.get(key) || []
      existing.push(group)
      groupsByKey.set(key, existing)
    }

    // Create normalized groups (one per unique title+color combination)
    const normalizedGroups: NormalizedGroup[] = []
    // Map: original tab group ID → merged group ID (for items)
    const groupIdMapping = new Map<number, string>()

    for (const [key, duplicateGroups] of groupsByKey) {
      if (duplicateGroups.length === 0) continue

      // Use first group as representative
      const representativeGroup = duplicateGroups[0]

      // Create normalized group with first group's ID as canonical ID
      const normalizedGroup: NormalizedGroup = {
        id: String(representativeGroup.id),
        title: representativeGroup.title || "",
        color: representativeGroup.color,
        collapsed: representativeGroup.collapsed,
        index: normalizedGroups.length, // Sequential index
      }

      normalizedGroups.push(normalizedGroup)

      // Map all duplicate group IDs to the canonical ID
      for (const group of duplicateGroups) {
        groupIdMapping.set(group.id, String(representativeGroup.id))
      }

      if (duplicateGroups.length > 1) {
        console.warn(
          `[Mappers] Merged ${duplicateGroups.length} duplicate tab groups: "${representativeGroup.title}" (${representativeGroup.color})`,
        )
      }
    }

    // Map tabs to normalized items
    const items: NormalizedItem[] = []

    for (const tab of tabs) {
      if (tab.id === undefined || !tab.url) {
        continue
      }

      // ✅ Use merged group ID if tab belongs to a group
      let groupId: string | null = null
      if (tab.groupId !== undefined && tab.groupId !== -1) {
        groupId = groupIdMapping.get(tab.groupId) || String(tab.groupId)
      }

      const item: NormalizedItem = {
        id: String(tab.id),
        url: tab.url,
        title: tab.title || "Untitled",
        pinned: tab.pinned || false,
        renamed: false, // Tabs don't have renamed status directly - will be synced from bookmarks
        index: tab.index,
        groupId,
      }

      items.push(item)
    }

    // Sort items by index to maintain order
    items.sort((a, b) => a.index - b.index)

    return {
      items,
      groups: normalizedGroups,
    }
  })

// ============================================================================
// Chrome Bookmarks → Normalized State
// ============================================================================

/**
 * Map Chrome Bookmarks (Workspace) to Normalized State
 *
 * @param workspace - Root bookmark folder node (workspace)
 * @returns Effect that yields NormalizedState
 */
export const mapBookmarksToNormalizedState = (
  workspace: chrome.bookmarks.BookmarkTreeNode,
): Effect.Effect<NormalizedState> =>
  Effect.gen(function* () {
    const items: NormalizedItem[] = []
    const groups: NormalizedGroup[] = []

    if (!workspace.children) {
      return { items: [], groups: [] }
    }

    let itemIndex = 0
    let groupIndex = 0

    for (const child of workspace.children) {
      // Direct bookmark (ungrouped item)
      if (child.url) {
        const { pinned, renamed, title } = parseBookmarkPinnedStatus(child.title)
        items.push({
          id: child.id,
          url: child.url,
          title, // Use clean title without markers
          pinned,
          renamed,
          index: itemIndex++,
          groupId: null,
        })
        continue
      }

      // Folder (either [pinned] or group)
      if (child.children) {
        // Check if it's the [pinned] folder
        if (child.title === PINNED_FOLDER_NAME) {
          // Process pinned items
          for (const bookmark of child.children) {
            if (bookmark.url) {
              const { pinned, renamed, title } = parseBookmarkPinnedStatus(bookmark.title)
              items.push({
                id: bookmark.id,
                url: bookmark.url,
                title, // Use clean title without markers
                pinned,
                renamed,
                index: itemIndex++,
                groupId: null, // Pinned items don't have a group
              })
            }
          }
          continue
        }

        // Regular group folder
        const { title: groupTitle, color, collapsed } = parseGroupMetadata(child.title)

        // ✅ NEW: Use title|color as stable identifier
        // This allows matching with tab groups that have different IDs
        const groupKey = `${groupTitle}|${color}`

        // Add group (use folder ID as group ID - it will be matched by title+color in diff)
        groups.push({
          id: child.id, // Bookmark folder ID
          title: groupTitle,
          color,
          collapsed,
          index: groupIndex++,
        })

        // Add items in this group
        for (const bookmark of child.children) {
          if (bookmark.url) {
            const { pinned, renamed, title } = parseBookmarkPinnedStatus(bookmark.title)
            items.push({
              id: bookmark.id,
              url: bookmark.url,
              title, // Use clean title without markers
              pinned,
              renamed,
              index: itemIndex++,
              groupId: child.id, // Reference to bookmark folder ID
            })
          }
        }
      }
    }

    return {
      items,
      groups,
    }
  })

// ============================================================================
// Helper: Calculate Group Index from Tabs
// ============================================================================

/**
 * Calculate the proper index for tab groups based on the first tab in each group
 * This is needed because Chrome doesn't expose group.index directly
 *
 * @param tabs - All tabs in the window
 * @param groups - All tab groups in the window
 * @returns Map of groupId to index
 */
export const calculateGroupIndices = (
  tabs: chrome.tabs.Tab[],
  groups: chrome.tabGroups.TabGroup[],
): Map<number, number> => {
  const groupIndices = new Map<number, number>()

  // Find the first tab in each group
  const groupFirstTabIndex = new Map<number, number>()

  for (const tab of tabs) {
    if (tab.groupId !== undefined && tab.groupId !== -1) {
      if (!groupFirstTabIndex.has(tab.groupId)) {
        groupFirstTabIndex.set(tab.groupId, tab.index)
      }
    }
  }

  // Sort groups by their first tab's index
  const sortedGroups = [...groups].sort((a, b) => {
    const indexA = groupFirstTabIndex.get(a.id) ?? Infinity
    const indexB = groupFirstTabIndex.get(b.id) ?? Infinity
    return indexA - indexB
  })

  // Assign indices
  sortedGroups.forEach((group, idx) => {
    groupIndices.set(group.id, idx)
  })

  return groupIndices
}

/**
 * Enhanced version of mapTabsToNormalizedState with proper group indices
 */
export const mapTabsToNormalizedStateEnhanced = (
  tabs: chrome.tabs.Tab[],
  groups: chrome.tabGroups.TabGroup[],
): Effect.Effect<NormalizedState> =>
  Effect.gen(function* () {
    const groupIndices = calculateGroupIndices(tabs, groups)

    const items: NormalizedItem[] = []

    for (const tab of tabs) {
      if (tab.id === undefined || !tab.url) {
        continue
      }

      const item: NormalizedItem = {
        id: String(tab.id),
        url: tab.url,
        title: tab.title || "Untitled",
        pinned: tab.pinned || false,
        index: tab.index,
        groupId:
          tab.groupId !== undefined && tab.groupId !== -1
            ? String(tab.groupId)
            : null,
      }

      items.push(item)
    }

    const normalizedGroups: NormalizedGroup[] = groups.map((group) => ({
      id: String(group.id),
      title: group.title || "",
      color: group.color,
      collapsed: group.collapsed,
      index: groupIndices.get(group.id) ?? 0,
    }))

    items.sort((a, b) => a.index - b.index)

    return {
      items,
      groups: normalizedGroups,
    }
  })
