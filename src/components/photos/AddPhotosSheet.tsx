'use client';

// Owner: WP-B. Stub (WP-0): props are frozen, the body is replaced by WP-B.
import type { PinView, RegionContext } from '@/lib/data/types';

interface Props {
  ctx: RegionContext;
  house: PinView;
  onClose(): void;
  onDone(): void;
}

export default function AddPhotosSheet({ ctx, house, onClose, onDone }: Props) {
  void ctx;
  void house;
  void onClose;
  void onDone;
  return null;
}
