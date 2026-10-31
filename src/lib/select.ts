/** Click toggles a single driver; shift-click adds/removes. Clicking the only selected driver clears. */
export function nextSelection(current: number[], n: number, shift: boolean): number[] {
  const has = current.includes(n);
  if (shift) return has ? current.filter((x) => x !== n) : [...current, n];
  if (has && current.length === 1) return [];
  return [n];
}

export function isSelected(selected: number[], n: number): boolean {
  return selected.includes(n);
}
