'use client';

// Owner: WP-B. Stub (WP-0): props are frozen, the body is replaced by WP-B.
interface Props {
  houseId: string;
  refreshKey: number;
}

export default function PhotoStrip({ houseId, refreshKey }: Props) {
  void houseId;
  void refreshKey;
  return <p className="nophotos">No photos yet.</p>;
}
