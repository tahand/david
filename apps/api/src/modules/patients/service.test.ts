import { describe, expect, it } from 'vitest';
import { parseSearchDate, postcodeVariants } from './service.js';

describe('parseSearchDate', () => {
  it.each([
    ['1990-01-31', '1990-01-31'],
    ['31/01/1990', '1990-01-31'],
    ['1/2/1990', '1990-02-01'],
    ['31-01-1990', '1990-01-31'],
    ['31.01.1990', '1990-01-31'],
  ])('reads %s as %s', (input, expected) => {
    expect(parseSearchDate(input)?.toISOString().slice(0, 10)).toBe(expected);
  });

  it.each(['31/02/1990', '1990-13-01', 'smith', '07700 900123', '1990'])('rejects %s', (input) => {
    expect(parseSearchDate(input)).toBeNull();
  });
});

describe('postcodeVariants', () => {
  it('matches with or without the space', () => {
    expect(postcodeVariants('sw1a1aa')).toEqual(['SW1A1AA', 'SW1A 1AA']);
    expect(postcodeVariants('SW1A 1AA')).toEqual(['SW1A 1AA']);
  });

  it('keeps short prefixes as typed', () => {
    expect(postcodeVariants('ex1')).toEqual(['EX1']);
  });

  it('ignores text without digits or with other characters', () => {
    expect(postcodeVariants('smith')).toEqual([]);
    expect(postcodeVariants("o'neil 1")).toEqual([]);
  });
});
