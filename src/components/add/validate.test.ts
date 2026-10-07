import { describe, expect, it } from 'vitest';
import { addressProblemMessage, isStreetLevel, validateAddress } from './validate';

describe('validateAddress', () => {
  it('accepts a full Google-style address', () => {
    expect(validateAddress('10013 Jibboom St, Truckee, CA 96161, USA')).toBeNull();
    expect(validateAddress('12B Donner Pass Rd')).toBeNull();
  });
  it('rejects markup', () => {
    expect(validateAddress('<b>1 Main</b>')).toBe('characters');
  });
  it('rejects no house number', () => {
    expect(validateAddress('Jibboom St, Truckee')).toBe('number');
    expect(validateAddress('Truckee')).toBe('number');
  });
  it('rejects 4 chars and over 120', () => {
    expect(validateAddress('1 Ma')).toBe('length');
    expect(validateAddress('1 ' + 'a'.repeat(120))).toBe('length');
  });
  it('rejects 7-digit numbers', () => {
    expect(validateAddress('1234567 Main St')).toBe('number');
  });
  it('has a message for every problem', () => {
    expect(addressProblemMessage('number')).toMatch(/house number/);
  });
});

describe('isStreetLevel', () => {
  it('accepts street_address, premise, subpremise', () => {
    expect(isStreetLevel(['street_address', 'geocode'])).toBe(true);
    expect(isStreetLevel(['premise'])).toBe(true);
    expect(isStreetLevel(['subpremise'])).toBe(true);
  });
  it('rejects localities and empty', () => {
    expect(isStreetLevel(['locality', 'political'])).toBe(false);
    expect(isStreetLevel([])).toBe(false);
  });
});
