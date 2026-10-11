import { describe, expect, it } from 'vitest';
import { ringsFor } from '../src/render/scene';

describe('ringsFor', () => {
  it('zeigt beim Standardradius 500 m, 1 km und 2 km', () => {
    // 2,5 km Radius, 0,86 davon passen ins Bild, ~0,18 px/m
    expect(ringsFor(2150, 0.18)).toEqual([500, 1000, 2000]);
  });

  it('nutzt bei 10 km größere Ringe und lässt zu dichte weg', () => {
    expect(ringsFor(8600, 0.045)).toEqual([1000, 2000, 5000]);
  });

  it('zeigt bei 1 km feinere Ringe', () => {
    expect(ringsFor(860, 0.45)).toEqual([250, 500]);
  });
});
