// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { aceBonusExplanation, RatingInput } from './multipliers-panel';
import { NumberCell } from './score-sheet-race';

function NumberCellHarness() {
  const [value, setValue] = useState(2);

  return (
    <>
      <NumberCell label="White skill procs" value={value} max={3} onChange={setValue} />
      <output data-testid="number-cell-value">{value}</output>
    </>
  );
}

function RatingInputHarness() {
  const [value, setValue] = useState(125_000);

  return (
    <>
      <RatingInput label="Your team rating" value={value} onChange={setValue} />
      <output data-testid="rating-value">{value}</output>
    </>
  );
}

describe('committed Team Trials number inputs', () => {
  it('does not claim the ace bonus is present when no ace exists', () => {
    expect(aceBonusExplanation(0)).toBe('no ace in roster');
    expect(aceBonusExplanation(1)).toBe('already included in ace rows');
  });

  it('keeps a number cell raw while editing, selects it on focus, and clamps on Enter', () => {
    render(<NumberCellHarness />);

    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    const input = screen.getByRole('spinbutton', { name: 'White skill procs' }) as HTMLInputElement;
    input.focus();

    expect(input).toHaveValue(2);
    expect(select).toHaveBeenCalledOnce();

    fireEvent.change(input, { target: { value: '99' } });
    expect(input).toHaveValue(99);
    expect(screen.getByTestId('number-cell-value')).toHaveTextContent('2');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue(3);
    expect(screen.getByTestId('number-cell-value')).toHaveTextContent('3');
    select.mockRestore();
  });

  it('keeps a rating blank until blur commits its cleared value as zero', () => {
    render(<RatingInputHarness />);

    const input = screen.getByRole('spinbutton', { name: 'Your team rating' }) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });

    expect(input.value).toBe('');
    expect(screen.getByTestId('rating-value')).toHaveTextContent('125000');

    fireEvent.blur(input);
    expect(screen.getByTestId('rating-value')).toHaveTextContent('0');
    expect(input.value).toBe('');
  });
});
