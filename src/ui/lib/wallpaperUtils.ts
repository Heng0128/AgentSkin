// SPDX-License-Identifier: MPL-2.0

/** Responsive WE-style grid: with 4+ items use auto-fill so cards flow at a
 *  fixed minimum width (170px) and a wide window produces more columns —
 *  previously the grid was capped at 4 columns, so a large library left big
 *  horizontal whitespace and stretched cards. Small counts stay centered at
 *  a bounded width so 1–3 cards don't stretch into one oversized row.
 *
 *  Rows are content-sized (no auto-rows-fr): cards keep their natural 16:9
 *  preview height. Vertical fill comes from the tight container padding, not
 *  from stretching cards square. */
export function gridClass(count: number): string {
  if (count === 1) return 'grid-cols-[minmax(0,340px)] justify-center';
  if (count === 2) return 'grid-cols-2 max-w-[700px]';
  if (count === 3) return 'grid-cols-3 max-w-[1020px]';
  return 'grid-cols-[repeat(auto-fill,minmax(170px,1fr))]';
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
