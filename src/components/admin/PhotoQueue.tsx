'use client';

// Owner: WP-C. Stub (WP-0): props are frozen, the body is replaced by WP-C.
import type { RegionContext } from '@/lib/data/types';

interface Props {
  ctx: RegionContext;
  onForbidden(): void;
}

export default function PhotoQueue({ ctx, onForbidden }: Props) {
  void ctx;
  void onForbidden;
  return <p>Photo moderation is coming soon.</p>;
}
