'use client';

import type { RegionContext } from '@/lib/data/types';

// Owner: WP-C
export interface AddHouseSheetProps {
  ctx: RegionContext;
  onClose(): void;
  onCreated(houseId: string): void;
  onOpenExisting(houseId: string): void;
}

export default function AddHouseSheet(props: AddHouseSheetProps) {
  void props;
  return null;
}
