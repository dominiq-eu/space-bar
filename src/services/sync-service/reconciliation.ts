// ============================================================================
// Reconciliation Module - Virtual DOM Pattern for Tabs ↔ Bookmarks Sync
// ============================================================================

/**
 * Normalized representation of a Tab or Bookmark
 * Abstracted from concrete Chrome API types
 */
export interface NormalizedItem {
  readonly id: string // Tab ID or Bookmark ID
  readonly url: string
  readonly title: string
  readonly pinned: boolean
  readonly renamed: boolean // Whether the tab/bookmark has been renamed by user
  readonly index: number // Position in list
  readonly groupId: string | null // Reference to group (null = ungrouped)
}

/**
 * Normalized representation of a Tab Group or Bookmark Folder
 */
export interface NormalizedGroup {
  readonly id: string
  readonly title: string
  readonly color: string
  readonly collapsed: boolean
  readonly index: number
}

/**
 * Complete normalized state of a Window/Workspace
 */
export interface NormalizedState {
  readonly items: ReadonlyArray<NormalizedItem>
  readonly groups: ReadonlyArray<NormalizedGroup>
}

// ============================================================================
// Operations - What needs to change?
// ============================================================================

export type Operation =
  | {
    readonly type: "ADD_ITEM"
    readonly item: NormalizedItem
  }
  | {
    readonly type: "DELETE_ITEM"
    readonly itemId: string
  }
  | {
    readonly type: "UPDATE_ITEM"
    readonly itemId: string
    readonly changes: Partial<
      Omit<NormalizedItem, "id" | "url"> // Can't change ID or URL
    >
  }
  | {
    readonly type: "MOVE_ITEM"
    readonly itemId: string
    readonly newIndex: number
  }
  | {
    readonly type: "ADD_GROUP"
    readonly group: NormalizedGroup
  }
  | {
    readonly type: "DELETE_GROUP"
    readonly groupId: string
  }
  | {
    readonly type: "UPDATE_GROUP"
    readonly groupId: string
    readonly changes: Partial<Omit<NormalizedGroup, "id">>
  }

/**
 * Result of diffing two states
 */
export interface DiffResult {
  readonly operations: ReadonlyArray<Operation>
  readonly hasChanges: boolean
}

// ============================================================================
// Diff Algorithm - Compares Source with Target
// ============================================================================

/**
 * Main diff function: Compares two states and generates operations
 *
 * @param source - The "new" state (source of truth)
 * @param target - The "old" state (what needs to be updated)
 * @returns DiffResult with list of operations
 */
export const diffStates = (
  source: NormalizedState,
  target: NormalizedState,
): DiffResult => {
  const operations: Operation[] = []

  // 1. Diff Items (all items in one pass)
  operations.push(...diffItems(source.items, target.items))

  // 2. Diff Groups
  operations.push(...diffGroups(source.groups, target.groups))

  return {
    operations,
    hasChanges: operations.length > 0,
  }
}

/**
 * Diff Items: Compare lists of items
 *
 * Uses URL as the stable identifier (ID can change between tabs/bookmarks)
 */
const diffItems = (
  sourceItems: ReadonlyArray<NormalizedItem>,
  targetItems: ReadonlyArray<NormalizedItem>,
): Operation[] => {
  const operations: Operation[] = []

  // ✅ FIX: Use Multi-Map to handle multiple items with same URL
  // Create maps for faster access (URL → Array of items)
  const sourceMap = new Map<string, NormalizedItem[]>()
  for (const item of sourceItems) {
    if (!sourceMap.has(item.url)) {
      sourceMap.set(item.url, [])
    }
    sourceMap.get(item.url)!.push(item)
  }

  const targetMap = new Map<string, NormalizedItem[]>()
  for (const item of targetItems) {
    if (!targetMap.has(item.url)) {
      targetMap.set(item.url, [])
    }
    targetMap.get(item.url)!.push(item)
  }

  // 1. Find DELETED items (in target but not in source)
  for (const [url, targetItemsWithUrl] of targetMap) {
    const sourceItemsWithUrl = sourceMap.get(url) || []

    // If URL completely gone from source, delete all target items
    if (sourceItemsWithUrl.length === 0) {
      for (const targetItem of targetItemsWithUrl) {
        operations.push({
          type: "DELETE_ITEM",
          itemId: targetItem.id,
        })
      }
    } // If source has fewer items with this URL, delete the extra target items
    else if (targetItemsWithUrl.length > sourceItemsWithUrl.length) {
      // Match by index, delete the ones that don't have a match
      for (
        let i = sourceItemsWithUrl.length;
        i < targetItemsWithUrl.length;
        i++
      ) {
        operations.push({
          type: "DELETE_ITEM",
          itemId: targetItemsWithUrl[i].id,
        })
      }
    }
  }

  // 2. Find ADDED items (in source but not in target)
  for (const [url, sourceItemsWithUrl] of sourceMap) {
    const targetItemsWithUrl = targetMap.get(url) || []

    // If URL completely new in source, add all source items
    if (targetItemsWithUrl.length === 0) {
      for (const sourceItem of sourceItemsWithUrl) {
        operations.push({
          type: "ADD_ITEM",
          item: sourceItem,
        })
      }
    } // If source has more items with this URL, add the extra source items
    else if (sourceItemsWithUrl.length > targetItemsWithUrl.length) {
      for (
        let i = targetItemsWithUrl.length;
        i < sourceItemsWithUrl.length;
        i++
      ) {
        operations.push({
          type: "ADD_ITEM",
          item: sourceItemsWithUrl[i],
        })
      }
    }
  }

  // 3. Find UPDATED items (in both, but different)
  // For each URL, match items by their index in the array
  for (const [url, sourceItemsWithUrl] of sourceMap) {
    const targetItemsWithUrl = targetMap.get(url)
    if (targetItemsWithUrl) {
      // Match items pairwise by index
      const minLength = Math.min(
        sourceItemsWithUrl.length,
        targetItemsWithUrl.length,
      )

      for (let i = 0; i < minLength; i++) {
        const sourceItem = sourceItemsWithUrl[i]
        const targetItem = targetItemsWithUrl[i]

        // Create mutable changes object
        const changes: {
          title?: string
          renamed?: boolean
          pinned?: boolean
          groupId?: string | null
        } = {}

        // ✅ TITLE SYNC LOGIC:
        // IMPORTANT: Only sync titles FROM bookmarks TO tabs, never the reverse!
        // Reason: Renamed bookmarks ([*] marker) should preserve user's custom title

        // If source has renamed=true, it's the source of truth for the title
        if (sourceItem.renamed && sourceItem.title !== targetItem.title) {
          changes.title = sourceItem.title
          changes.renamed = true
        } // If target is renamed but source is not, keep target's renamed title
        // (Don't overwrite a renamed bookmark with the tab's original title!)
        else if (targetItem.renamed && !sourceItem.renamed) {
          // Do nothing - keep target's renamed title
        } // If neither is renamed, sync normally
        else if (
          !sourceItem.renamed && !targetItem.renamed &&
          sourceItem.title !== targetItem.title
        ) {
          changes.title = sourceItem.title
        }

        // Sync renamed status
        if (sourceItem.renamed !== targetItem.renamed && sourceItem.renamed) {
          // Only propagate renamed=true, never renamed=false (would clear user rename)
          changes.renamed = true
        }

        if (sourceItem.pinned !== targetItem.pinned) {
          changes.pinned = sourceItem.pinned
        }
        if (sourceItem.groupId !== targetItem.groupId) {
          changes.groupId = sourceItem.groupId
        }
        // ❌ DO NOT sync index via UPDATE_ITEM!
        // Index changes are handled by MOVE_ITEM operations which use local indices within parent

        if (Object.keys(changes).length > 0) {
          operations.push({
            type: "UPDATE_ITEM",
            itemId: targetItem.id,
            changes,
          })
        }
      }
    }
  }

  // 4. Find MOVED items (index changed within the same parent)
  // IMPORTANT: Only generate MOVE_ITEM if the item stays in the same parent (groupId)
  // If groupId changes, UPDATE_ITEM will handle the parent change

  // Group items by their parent (groupId + pinned status)
  const getParentKey = (item: NormalizedItem) =>
    `${item.pinned ? "pinned" : item.groupId || "ungrouped"}`

  // Group source items by parent
  const sourceParentGroups = new Map<string, NormalizedItem[]>()
  for (const sourceItem of sourceItems) {
    const parentKey = getParentKey(sourceItem)
    if (!sourceParentGroups.has(parentKey)) {
      sourceParentGroups.set(parentKey, [])
    }
    sourceParentGroups.get(parentKey)!.push(sourceItem)
  }

  // Group target items by parent
  const targetParentGroups = new Map<string, NormalizedItem[]>()
  for (const targetItem of targetItems) {
    const parentKey = getParentKey(targetItem)
    if (!targetParentGroups.has(parentKey)) {
      targetParentGroups.set(parentKey, [])
    }
    targetParentGroups.get(parentKey)!.push(targetItem)
  }

  // Generate MOVE operations for each parent group
  for (const [parentKey, sourceItemsInParent] of sourceParentGroups) {
    const targetItemsInParent = targetParentGroups.get(parentKey) || []

    // Create a URL-based multi-map for matching items within this parent
    const sourceUrlMap = new Map<string, NormalizedItem[]>()
    const targetUrlMap = new Map<string, NormalizedItem[]>()

    for (const item of sourceItemsInParent) {
      if (!sourceUrlMap.has(item.url)) {
        sourceUrlMap.set(item.url, [])
      }
      sourceUrlMap.get(item.url)!.push(item)
    }

    for (const item of targetItemsInParent) {
      if (!targetUrlMap.has(item.url)) {
        targetUrlMap.set(item.url, [])
      }
      targetUrlMap.get(item.url)!.push(item)
    }

    // For each URL in this parent, match items pairwise
    for (const [url, sourceItemsWithUrl] of sourceUrlMap) {
      const targetItemsWithUrl = targetUrlMap.get(url)
      if (!targetItemsWithUrl) continue

      const minLength = Math.min(
        sourceItemsWithUrl.length,
        targetItemsWithUrl.length,
      )

      for (let i = 0; i < minLength; i++) {
        const sourceItem = sourceItemsWithUrl[i]
        const targetItem = targetItemsWithUrl[i]

        // Find local indices within parent
        const sourceLocalIndex = sourceItemsInParent.findIndex((item) =>
          item === sourceItem
        )
        const targetLocalIndex = targetItemsInParent.findIndex((item) =>
          item === targetItem
        )

        // If local position changed within the parent, generate MOVE
        if (
          sourceLocalIndex !== -1 && targetLocalIndex !== -1 &&
          targetLocalIndex !== sourceLocalIndex
        ) {
          operations.push({
            type: "MOVE_ITEM",
            itemId: targetItem.id,
            newIndex: sourceLocalIndex, // ✅ Local index within parent, not global!
          })
        }
      }
    }
  }

  return operations
}

/**
 * Diff Groups: Compare lists of groups
 *
 * Groups are matched by title+color (NOT by ID!)
 * This allows matching tab groups with bookmark folders across different ID spaces
 */
const diffGroups = (
  sourceGroups: ReadonlyArray<NormalizedGroup>,
  targetGroups: ReadonlyArray<NormalizedGroup>,
): Operation[] => {
  const operations: Operation[] = []

  // ✅ NEW: Match groups by title+color instead of ID
  // Key format: "title|color"
  const makeGroupKey = (g: NormalizedGroup) => `${g.title}|${g.color}`

  const sourceMap = new Map(sourceGroups.map((g) => [makeGroupKey(g), g]))
  const targetMap = new Map(targetGroups.map((g) => [makeGroupKey(g), g]))

  // 1. Deleted groups (in target but not in source)
  for (const [key, targetGroup] of targetMap) {
    if (!sourceMap.has(key)) {
      operations.push({
        type: "DELETE_GROUP",
        groupId: targetGroup.id, // Use target ID for deletion
      })
    }
  }

  // 2. Added groups (in source but not in target)
  for (const [key, sourceGroup] of sourceMap) {
    if (!targetMap.has(key)) {
      operations.push({
        type: "ADD_GROUP",
        group: sourceGroup,
      })
    }
  }

  // 3. Updated groups (in both, but properties changed)
  for (const [key, sourceGroup] of sourceMap) {
    const targetGroup = targetMap.get(key)
    if (targetGroup) {
      // Create mutable changes object
      const changes: {
        title?: string
        color?: string
        collapsed?: boolean
        index?: number
      } = {}

      // Title and color are used for matching, so they shouldn't change
      // But collapsed state and index can change
      if (sourceGroup.collapsed !== targetGroup.collapsed) {
        changes.collapsed = sourceGroup.collapsed
      }
      if (sourceGroup.index !== targetGroup.index) {
        changes.index = sourceGroup.index
      }

      if (Object.keys(changes).length > 0) {
        operations.push({
          type: "UPDATE_GROUP",
          groupId: targetGroup.id, // Use target ID for update
          changes,
        })
      }
    }
  }

  return operations
}

// ============================================================================
// Helper Functions (Pure Functions, NOT Class!)
// ============================================================================

/**
 * Get all pinned items from state
 */
export const getPinnedItems = (
  state: NormalizedState,
): ReadonlyArray<NormalizedItem> => {
  return state.items.filter((item) => item.pinned)
}

/**
 * Get all ungrouped items (not pinned, not in any group)
 */
export const getUngroupedItems = (
  state: NormalizedState,
): ReadonlyArray<NormalizedItem> => {
  return state.items.filter((item) => !item.pinned && item.groupId === null)
}

/**
 * Get all items in a specific group
 */
export const getItemsInGroup = (
  state: NormalizedState,
  groupId: string,
): ReadonlyArray<NormalizedItem> => {
  return state.items.filter((item) => item.groupId === groupId)
}

/**
 * Get all groups with their items
 * Useful for rendering
 */
export const getGroupsWithItems = (
  state: NormalizedState,
): ReadonlyArray<{
  group: NormalizedGroup
  items: ReadonlyArray<NormalizedItem>
}> => {
  return state.groups.map((group) => ({
    group,
    items: getItemsInGroup(state, group.id),
  }))
}

/**
 * Find an item by URL
 */
export const findItemByUrl = (
  state: NormalizedState,
  url: string,
): NormalizedItem | undefined => {
  return state.items.find((item) => item.url === url)
}

/**
 * Find an item by ID
 */
export const findItemById = (
  state: NormalizedState,
  id: string,
): NormalizedItem | undefined => {
  return state.items.find((item) => item.id === id)
}

/**
 * Find a group by ID
 */
export const findGroupById = (
  state: NormalizedState,
  id: string,
): NormalizedGroup | undefined => {
  return state.groups.find((group) => group.id === id)
}

/**
 * Validate state integrity
 * Ensures all item.groupId references exist
 */
export const validateState = (state: NormalizedState): boolean => {
  const groupIds = new Set(state.groups.map((g) => g.id))

  for (const item of state.items) {
    if (item.groupId !== null && !groupIds.has(item.groupId)) {
      console.error(
        `Item ${item.id} references non-existent group ${item.groupId}`,
      )
      return false
    }
  }

  return true
}

/**
 * Get statistics about the state (useful for debugging/logging)
 */
export const getStateStats = (state: NormalizedState) => {
  const pinnedCount = getPinnedItems(state).length
  const ungroupedCount = getUngroupedItems(state).length
  const groupedCount = state.items.length - pinnedCount - ungroupedCount

  return {
    totalItems: state.items.length,
    pinnedItems: pinnedCount,
    ungroupedItems: ungroupedCount,
    groupedItems: groupedCount,
    totalGroups: state.groups.length,
    itemsPerGroup: state.groups.map((group) => ({
      groupId: group.id,
      groupTitle: group.title,
      itemCount: getItemsInGroup(state, group.id).length,
    })),
  }
}
