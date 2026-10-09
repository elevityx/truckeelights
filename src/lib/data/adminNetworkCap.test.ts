import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({ rpc }) }));

import { adminSetNetworkCap } from './admin';

beforeEach(() => rpc.mockReset());

describe('adminSetNetworkCap', () => {
  it('calls admin_set_network_cap with the flag', async () => {
    rpc.mockResolvedValue({ error: null });
    await adminSetNetworkCap(true);
    expect(rpc).toHaveBeenCalledWith('admin_set_network_cap', { p_enabled: true });
  });
  it('maps forbidden for a region-only admin', async () => {
    rpc.mockResolvedValue({ error: { message: 'forbidden' } });
    await expect(adminSetNetworkCap(false)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
