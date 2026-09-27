import assert from 'node:assert/strict';
import test from 'node:test';
import averageFor from '../src/average.mjs';

test('averageFor averages only included grades', () => {
  assert.equal(averageFor([]), '—');
  assert.equal(averageFor([
    {grade: 80, includeInAverage: true},
    {grade: 100, includeInAverage: true},
    {grade: 0, includeInAverage: false}
  ]), '90.00');
});
