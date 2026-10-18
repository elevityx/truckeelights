// AC-L1-17e: compile-time guard only (checked by `npm run typecheck`; no runtime tests, so vitest skips this file).
// Each @ts-expect-error fails the typecheck as soon as the field it removes stops being required by UseVibesInput.
import type { PublicEvent } from '@/lib/data/types';
import { useVibes, type Handoff, type UseVibesInput } from './useVibes';

const hooks = {
  onOpen: (id: string) => void id,
  onClose: (id: string) => void id,
  onShare: (e: PublicEvent) => void e,
  onHandoff: (h: Handoff) => void h,
};
const full: UseVibesInput = { ctx: null, provider: 'lights', nativeEvents: null, hostOpenEventId: null, hooks };
const { onHandoff: _dropped, ...noHandoff } = hooks;
void _dropped;

export function useTypeGuards() {
  useVibes(full);
  // @ts-expect-error nativeEvents is required
  useVibes({ ctx: null, provider: 'lights', hostOpenEventId: null, hooks });
  // @ts-expect-error hostOpenEventId is required
  useVibes({ ctx: null, provider: 'lights', nativeEvents: null, hooks });
  // @ts-expect-error hooks.onHandoff is required
  useVibes({ ctx: null, provider: 'lights', nativeEvents: null, hostOpenEventId: null, hooks: noHandoff });
}
