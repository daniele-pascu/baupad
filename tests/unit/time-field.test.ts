import { describe, expect, it } from 'vitest';
import { parseTime } from '../../src/components/TimeField';

describe('Uhrzeit mit Zahlentastatur', () => {
  it('versteht 0630, 630, 6:30, 6.30, 7 und leer', () => {
    expect(parseTime('0630')).toBe('06:30');
    expect(parseTime('630')).toBe('06:30');
    expect(parseTime('6:30')).toBe('06:30');
    expect(parseTime('6.30')).toBe('06:30');
    expect(parseTime('17,45')).toBe('17:45');
    expect(parseTime('7')).toBe('07:00');
    expect(parseTime('16')).toBe('16:00');
    expect(parseTime('6:3')).toBe('06:30');
    expect(parseTime('')).toBe('');
  });
  it('lehnt Unsinn ab', () => {
    expect(parseTime('2460')).toBeNull();
    expect(parseTime('2500')).toBeNull();
    expect(parseTime('12345')).toBeNull();
    expect(parseTime('abc')).toBeNull();
  });
});
