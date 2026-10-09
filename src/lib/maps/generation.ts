/** A generation counter for async work that must not land after something newer happened (a request token).
 *  `begin()` starts work and returns its token; `invalidate()` retires every token handed out so far. */
export function createGeneration() {
  let n = 0;
  return {
    begin: () => ++n,
    invalidate: () => void ++n,
    isCurrent: (token: number) => token === n,
  };
}
