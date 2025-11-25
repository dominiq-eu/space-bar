/**
 * Valid tab group colors in Chrome
 */
export const VALID_GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const

export type GroupColor = typeof VALID_GROUP_COLORS[number]

/**
 * Folder name for pinned tabs in workspace bookmarks
 */
export const PINNED_FOLDER_NAME = "[pinned]"

/**
 * Parse group metadata from bookmark folder title
 * Format: [color][collapsed] Title or [color] Title
 *
 * @example
 * parseGroupMetadata("[blue][collapsed] Development")
 * // Returns: { color: "blue", collapsed: true, title: "Development" }
 */
export function parseGroupMetadata(title: string): {
  color: GroupColor
  collapsed: boolean
  title: string
} {
  const collapsedMatch = title.match(/\[collapsed\]/)
  const isCollapsed = collapsedMatch !== null

  const colorMatch = title.match(/^\[(.*?)\]/)
  const color = colorMatch?.[1] || "grey"

  const groupTitle = title
    .replace(/^\[.*?\]/, "") // Remove color
    .replace(/\[collapsed\]/, "") // Remove collapsed marker
    .trim()

  const validColor = VALID_GROUP_COLORS.includes(color as GroupColor)
    ? (color as GroupColor)
    : "grey"

  return {
    color: validColor,
    collapsed: isCollapsed,
    title: groupTitle,
  }
}

/**
 * Create bookmark folder title with group metadata
 *
 * @example
 * createGroupTitle("Development", "blue", true)
 * // Returns: "[blue][collapsed] Development"
 */
export function createGroupTitle(
  title: string,
  color: string,
  collapsed: boolean,
): string {
  const collapsedMarker = collapsed ? "[collapsed]" : ""
  return `[${color}]${collapsedMarker} ${title || "Unnamed Group"}`
}

/**
 * Parse pinned and renamed status from bookmark title
 * Format: [pinned][*] Title or [pinned] Title or [*] Title
 *
 * @returns { pinned: boolean, renamed: boolean, title: string } - Status and clean title
 *
 * @example
 * parseBookmarkPinnedStatus("[pinned][*] My Custom Name")
 * // Returns: { pinned: true, renamed: true, title: "My Custom Name" }
 *
 * parseBookmarkPinnedStatus("[*] My Custom Name")
 * // Returns: { pinned: false, renamed: true, title: "My Custom Name" }
 *
 * parseBookmarkPinnedStatus("[pinned] GitHub")
 * // Returns: { pinned: true, renamed: false, title: "GitHub" }
 *
 * parseBookmarkPinnedStatus("GitHub")
 * // Returns: { pinned: false, renamed: false, title: "GitHub" }
 */
export function parseBookmarkPinnedStatus(bookmarkTitle: string): {
  pinned: boolean
  renamed: boolean
  title: string
} {
  const pinnedMatch = bookmarkTitle.match(/\[pinned\]/)
  const isPinned = pinnedMatch !== null

  const renamedMatch = bookmarkTitle.match(/\[\*\]/)
  const isRenamed = renamedMatch !== null

  const cleanTitle = bookmarkTitle
    .replace(/\[pinned\]/, "")
    .replace(/\[\*\]/, "")
    .trim()

  return {
    pinned: isPinned,
    renamed: isRenamed,
    title: cleanTitle,
  }
}

/**
 * Create bookmark title with pinned and renamed metadata
 *
 * @example
 * createBookmarkTitle("GitHub", true, false)
 * // Returns: "[pinned] GitHub"
 *
 * createBookmarkTitle("My Custom Name", false, true)
 * // Returns: "[*] My Custom Name"
 *
 * createBookmarkTitle("My Custom Name", true, true)
 * // Returns: "[pinned][*] My Custom Name"
 *
 * createBookmarkTitle("GitHub", false, false)
 * // Returns: "GitHub"
 */
export function createBookmarkTitle(
  title: string,
  pinned: boolean,
  renamed: boolean = false,
): string {
  const pinnedMarker = pinned ? "[pinned]" : ""
  const renamedMarker = renamed ? "[*]" : ""

  if (pinnedMarker || renamedMarker) {
    return `${pinnedMarker}${renamedMarker} ${title}`
  }

  return title
}
