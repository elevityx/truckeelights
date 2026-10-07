// Client-side address checks. UX only: the database re-checks everything.
const HOUSE_NUMBER = /^\d{1,6}[A-Za-z]?\s+\S/;
const ALLOWED = /^[A-Za-z0-9 ,.#'/-]+$/;
const STREET_TYPES = ['street_address', 'premise', 'subpremise'];

export type AddressProblem = 'length' | 'characters' | 'number';

/** Returns null when the address looks submittable, otherwise the first problem found. */
export function validateAddress(raw: string): AddressProblem | null {
  const v = raw.trim();
  if (v.length < 5 || v.length > 120) return 'length';
  if (!ALLOWED.test(v)) return 'characters';
  if (!HOUSE_NUMBER.test(v)) return 'number';
  return null;
}

export function addressProblemMessage(p: AddressProblem): string {
  switch (p) {
    case 'length':
      return 'The address must be 5 to 120 characters.';
    case 'characters':
      return 'Use only letters, numbers, and , . # \' / - in the address.';
    case 'number':
      return 'Use a street address that starts with a house number.';
  }
}

/** UX-only street-level check on Google place types. Not a security control. */
export function isStreetLevel(types: readonly string[]): boolean {
  return types.some((t) => STREET_TYPES.includes(t));
}
