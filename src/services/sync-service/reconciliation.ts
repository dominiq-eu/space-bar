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

  // Create maps for faster access (by URL, not ID!)
  const sourceMap = new Map(sourceItems.map((item) => [item.url, item]))
  const targetMap = new Map(targetItems.map((item) => [item.url, item]))

  // 1. Find DELETED items (in target but not in source)
  for (const [url, targetItem] of targetMap) {
    if (!sourceMap.has(url)) {
      operations.push({
        type: "DELETE_ITEM",
        itemId: targetItem.id,
      })
    }
  }

  // 2. Find ADDED items (in source but not in target)
  for (const [url, sourceItem] of sourceMap) {
    if (!targetMap.has(url)) {
      operations.push({
        type: "ADD_ITEM",
        item: sourceItem,
      })
    }
  }

  // 3. Find UPDATED items (in both, but different)
  for (const [url, sourceItem] of sourceMap) {
    const targetItem = targetMap.get(url)
    if (targetItem) {
      const changes: Partial<Omit<NormalizedItem, "id" | "url">> = {}

      // ✅ TITLE SYNC LOGIC:
      // Sync titles and mark as renamed when they differ
      if (sourceItem.title !== targetItem.title) {
        // Titles are different - source has changed
        changes.title = sourceItem.title

        // If target wasn't already renamed, mark it as renamed now
        if (!targetItem.renamed) {
          changes.renamed = true
        }
      }

      // Sync renamed status if it changed
      if (sourceItem.renamed !== targetItem.renamed) {
        changes.renamed = sourceItem.renamed
      }

      if (sourceItem.pinned !== targetItem.pinned) {
        changes.pinned = sourceItem.pinned
      }
      if (sourceItem.groupId !== targetItem.groupId) {
        changes.groupId = sourceItem.groupId
      }
      if (sourceItem.index !== targetItem.index) {
        changes.index = sourceItem.index
      }

      if (Object.keys(changes).length > 0) {
        operations.push({
          type: "UPDATE_ITEM",
          itemId: targetItem.id,
          changes,
        })
      }
    }
  }

  // 4. Find MOVED items (index changed)
  // Note: We need to check if reordering is needed
  const needsReordering = sourceItems.some((sourceItem, idx) => {
    const targetItem = targetMap.get(sourceItem.url)
    return targetItem && targetItem.index !== idx
  })

  if (needsReordering) {
    sourceItems.forEach((sourceItem, idx) => {
      const targetItem = targetMap.get(sourceItem.url)
      if (targetItem && targetItem.index !== idx) {
        operations.push({
          type: "MOVE_ITEM",
          itemId: targetItem.id,
          newIndex: idx,
        })
      }
    })
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
      const changes: Partial<Omit<NormalizedGroup, "id">> = {}

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
