import { describe, it, expect } from 'vitest';
import { ICP_CRITERIA, MAX_SCORE, bandFromScore, shouldSkipCold } from '../../src/agent/icp.js';

describe('ICP_CRITERIA', () => {
  it('criterion weights sum to MAX_SCORE = 10', () => {
    const sum = ICP_CRITERIA.reduce((s, c) => s + c.weight, 0);
    expect(sum).toBeCloseTo(10, 6);
    expect(MAX_SCORE).toBeCloseTo(10, 6);
  });

  it('every criterion has a unique id', () => {
    const ids = ICP_CRITERIA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every criterion documents at least one signal', () => {
    for (const c of ICP_CRITERIA) {
      expect(c.signals.length).toBeGreaterThan(0);
    }
  });
});

describe('bandFromScore', () => {
  it('Hot for >= 8', () => {
    expect(bandFromScore(10)).toBe('hot');
    expect(bandFromScore(8)).toBe('hot');
  });
  it('Warm for 4..7.999', () => {
    expect(bandFromScore(7.9)).toBe('warm');
    expect(bandFromScore(4)).toBe('warm');
  });
  it('Cold for < 4', () => {
    expect(bandFromScore(3.99)).toBe('cold');
    expect(bandFromScore(0)).toBe('cold');
  });
});

describe('shouldSkipCold', () => {
  it('true when score <= 2', () => {
    expect(shouldSkipCold(2)).toBe(true);
    expect(shouldSkipCold(0)).toBe(true);
    expect(shouldSkipCold(2.01)).toBe(false);
  });
});
