import {REQUIRED_CITY} from './eligibility.mjs';
export const CACHE_TTL = 5 * 60 * 1000;
export function readAccessCache(storage, address, now = Date.now()) {
 try {
  if (!/^0x[0-9a-f]{64}$/i.test(address) || storage.getItem('alphacity_gate_address')?.toLowerCase() !== address.toLowerCase()) return null;
  const timestamp = Number(storage.getItem('alphacity_gate_verified_at'));
  if (!timestamp || now < timestamp || now - timestamp >= CACHE_TTL) return null;
  const rawLiquid = storage.getItem('alphacity_gate_liquid'), rawStaked = storage.getItem('alphacity_gate_staked');
  if (!/^\d+$/.test(rawLiquid) || !/^\d+$/.test(rawStaked)) return null;
  const liquid = BigInt(rawLiquid), staked = BigInt(rawStaked), total = liquid + staked;
  return {liquid, staked, total, allowed: total >= REQUIRED_CITY};
 } catch { return null; }
}
export function writeAccessCache(storage, address, balances, now = Date.now()) {
 try {
  storage.removeItem('alphacity_gate_verified_at');
  storage.setItem('alphacity_gate_address', address);
  storage.setItem('alphacity_gate_liquid', balances.liquid.toString());
  storage.setItem('alphacity_gate_staked', balances.staked.toString());
  // Keep the Tools portal's threshold; Climb always checks the actual total.
  const toolsThreshold = 1000000n * 10n ** 9n;
  storage.setItem('alphacity_gate_threshold', toolsThreshold.toString());
  storage.setItem('alphacity_gate_status', balances.total >= toolsThreshold ? 'unlocked' : 'locked');
  storage.setItem('alphacity_gate_verified_at', now.toString());
 } catch { /* Storage is optional; fresh verification still works. */ }
}
