// Owner: WP-C. Stubs only (WP-0); bodies per Spec_Photos_Release2 §1.3 and Amendment 1.
import type { StorageJob } from './types';

const nope = (): never => {
  throw new Error('not implemented');
};

export async function adminStorageJobs(regionId: string): Promise<StorageJob[]> {
  void regionId;
  return nope();
}
export async function runStorageJobsFallback(regionId: string): Promise<{ done: number; open: number }> {
  void regionId;
  return nope();
}
