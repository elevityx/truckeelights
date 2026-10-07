/** Address before its first comma. */
export function firstSegment(address: string): string {
  const i = address.indexOf(',');
  return (i < 0 ? address : address.slice(0, i)).trim();
}
/** Everything after the first comma. */
export function restSegment(address: string): string {
  const i = address.indexOf(',');
  return i < 0 ? '' : address.slice(i + 1).trim();
}
/** Street name: first segment with the leading house number removed. */
export function street(address: string): string {
  return firstSegment(address).replace(/^\d+[A-Za-z]?\s+/, '');
}
/** Leading integer of the address, or 0. */
export function number(address: string): number {
  const m = /^(\d+)/.exec(address.trim());
  return m ? parseInt(m[1], 10) : 0;
}

export interface StreetGroup<T> {
  street: string;
  items: T[];
}
/** Group by street (A-Z), numbers ascending within each street. */
export function groupByStreet<T extends { address: string }>(items: T[]): StreetGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const s = street(it.address);
    const arr = map.get(s);
    if (arr) arr.push(it);
    else map.set(s, [it]);
  }
  return [...map.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((s) => ({ street: s, items: map.get(s)!.sort((a, b) => number(a.address) - number(b.address)) }));
}

/** Split text on `**` and flag odd segments as bold. No HTML is ever produced. */
export function splitBold(s: string): { text: string; bold: boolean }[] {
  return s.split('**').map((text, i) => ({ text, bold: i % 2 === 1 })).filter((p) => p.text !== '');
}
