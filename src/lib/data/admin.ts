import type { AdminHouse, HouseStatus, Season } from './types';

// Owner: WP-D
const ni = (): never => {
  throw new Error('not implemented');
};
export async function adminSignIn(email: string, password: string, captchaToken: string): Promise<void> {
  void [email, password, captchaToken];
  return ni();
}
export async function adminAal(): Promise<{ current: 'aal1' | 'aal2' | null; next: 'aal1' | 'aal2' | null }> {
  return ni();
}
export async function adminVerifiedTotp(): Promise<{ id: string; friendlyName: string } | null> {
  return ni();
}
export async function adminEnrollTotp(friendlyName: string): Promise<{ factorId: string; qrCode: string; secret: string }> {
  void friendlyName;
  return ni();
}
export async function adminVerifyTotp(factorId: string, code: string): Promise<void> {
  void [factorId, code];
  return ni();
}
export async function adminChangePassword(pw: string): Promise<void> {
  void pw;
  return ni();
}
export async function adminSignOut(): Promise<void> {
  return ni();
}
export async function adminWhoami(regionId: string): Promise<boolean> {
  void regionId;
  return ni();
}
export async function adminSetSeason(regionId: string, season: Season, year: number, open: boolean): Promise<void> {
  void [regionId, season, year, open];
  return ni();
}
export async function adminListHouses(regionId: string, status: HouseStatus | null, query: string | null): Promise<AdminHouse[]> {
  void [regionId, status, query];
  return ni();
}
export async function adminSetHouseStatus(houseId: string, status: 'visible' | 'hidden', reason: string | null): Promise<void> {
  void [houseId, status, reason];
  return ni();
}
export async function adminReleaseHouse(houseId: string): Promise<void> {
  void houseId;
  return ni();
}
