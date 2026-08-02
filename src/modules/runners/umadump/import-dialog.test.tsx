// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UmadumpImportDialog } from './import-dialog';

afterEach(cleanup);

describe('UmadumpImportDialog onboarding', () => {
  it('teaches the export flow and offers only the umadump JSON input', () => {
    render(<UmadumpImportDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Import Veterans with umadump' })).toBeVisible();
    expect(screen.getByText('Run umadump with the game open')).toBeVisible();
    expect(screen.getByText('Export your Veterans')).toBeVisible();
    expect(screen.getByText('Open Torena or upload the file')).toBeVisible();
    expect(
      screen.getByRole('button', { name: /choose umadump trained character json/i })
    ).toBeVisible();
    expect(screen.getByRole('link', { name: /get umadump/i })).toHaveAttribute(
      'href',
      'https://github.com/Werseter/umadump'
    );
    expect(screen.getByText(/Torena never uploads your game data/i)).toBeVisible();
    expect(screen.queryByText(/screenshot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/RosterView/i)).not.toBeInTheDocument();
  });
});
