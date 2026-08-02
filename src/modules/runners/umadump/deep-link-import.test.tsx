// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { encodeUmadumpDeepLinkValue } from './deep-link';
import { UmadumpDeepLinkImport } from './deep-link-import';

vi.mock('./import-dialog', () => ({
  UmadumpImportDialog: (props: {
    open: boolean;
    initialImport: { result: { ok: boolean; error?: string; runners?: unknown[] } };
    onOpenChange: (open: boolean) => void;
  }) => (
    <div role="dialog" aria-label="umadump preview">
      <span>{props.open ? 'open' : 'closed'}</span>
      <span>
        {props.initialImport.result.ok
          ? `${props.initialImport.result.runners?.length ?? 0} runners`
          : props.initialImport.result.error}
      </span>
      <button onClick={() => props.onOpenChange(false)}>Close preview</button>
    </div>
  )
}));

const trainedChara = {
  card_id: 100401,
  speed: 987,
  stamina: 445,
  power: 608,
  wiz: 372,
  guts: 364,
  proper_ground_turf: 7,
  proper_ground_dirt: 4,
  proper_running_style_nige: 7,
  proper_running_style_senko: 3,
  proper_running_style_sashi: 2,
  proper_running_style_oikomi: 1,
  proper_distance_short: 7,
  proper_distance_mile: 7,
  proper_distance_middle: 7,
  proper_distance_long: 6,
  skill_array: []
};

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="location">{`${location.pathname}${location.search}${location.hash}`}</output>
  );
}

function renderImport(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <UmadumpDeepLinkImport />
      <LocationProbe />
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe('UmadumpDeepLinkImport', () => {
  it('routes to Veterans, opens the parsed preview, and consumes only the import parameter', async () => {
    const value = encodeUmadumpDeepLinkValue(JSON.stringify([trainedChara]));
    renderImport(`/skills?keep=filter&from=${value}#saved`);

    expect(await screen.findByRole('dialog', { name: 'umadump preview' })).toHaveTextContent(
      '1 runners'
    );
    await waitFor(() => {
      expect(screen.getByLabelText('location')).toHaveTextContent('/runners?keep=filter#saved');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(screen.queryByRole('dialog', { name: 'umadump preview' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('location')).toHaveTextContent('/runners?keep=filter#saved');
  });

  it('remains on Veterans and opens an actionable error for malformed payloads', async () => {
    renderImport('/runners?from=not*base64');

    const dialog = await screen.findByRole('dialog', { name: 'umadump preview' });
    expect(dialog).toHaveTextContent('malformed payload');
    await waitFor(() => {
      expect(screen.getByLabelText('location')).toHaveTextContent('/runners');
    });
  });
});
