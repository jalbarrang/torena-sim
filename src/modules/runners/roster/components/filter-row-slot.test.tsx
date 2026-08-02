// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AptitudeFilterRowSlot } from './filter-row-slot';

const slot = { key: 'proper_ground_turf', name: 'Turf' } as const;

describe('AptitudeFilterRowSlot', () => {
  it('reflects controlled filter changes in the visible trigger label', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AptitudeFilterRowSlot slot={slot} filters={{}} onChange={onChange} />
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('All');

    rerender(
      <AptitudeFilterRowSlot slot={slot} filters={{ proper_ground_turf: 7 }} onChange={onChange} />
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('A');
    expect(screen.getByRole('combobox')).not.toHaveTextContent('7');
  });
});
