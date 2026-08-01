import { describe, it, expect, beforeEach } from 'vitest';
import { Mood } from '@/lib/uma-domain/runner/definitions';
import { createRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { createRaceConditions } from '@/utils/races';
import { useSettingsStore } from '@/store/settings.store';
import { useRaceSimStore } from '@/modules/simulation/stores/race-sim.store';
import { gzipStringToBase64 } from '@/modules/runners/share/gzip-base64';
import { buildRaceSimSnapshot } from './snapshot';
import { encodeRaceSimShareCode, decodeRaceSimShareCode } from './share-code';

const hasCompressionStream =
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

describe.skipIf(!hasCompressionStream)('race-sim share code', () => {
  beforeEach(() => {
    useRaceSimStore.setState({
      runners: [
        createRunnerState({ outfitId: '100101', strategy: 'Front Runner', mood: Mood.Great }),
        createRunnerState({ outfitId: '100201', strategy: 'Pace Chaser' })
      ],
      nsamples: 5,
      seed: 12345,
      focusRunnerIndices: [0],
      results: null,
      isStale: false
    });
    useSettingsStore.setState({
      courseId: 10101,
      racedef: createRaceConditions({ ground: 1 })
    });
  });

  it('round-trips through encode/decode', async () => {
    const snapshot = buildRaceSimSnapshot();
    const code = await encodeRaceSimShareCode(snapshot);
    expect(code.startsWith('rs1:')).toBe(true);

    const decoded = await decodeRaceSimShareCode(code);
    expect(decoded).toEqual(snapshot);
  });

  it('strips a leading hash/URL', async () => {
    const code = await encodeRaceSimShareCode(buildRaceSimSnapshot());
    const decoded = await decodeRaceSimShareCode(`https://example.com/race-sim#${code}`);
    expect(decoded).not.toBeNull();
  });

  it('rejects invalid input', async () => {
    expect(await decodeRaceSimShareCode('')).toBeNull();
    expect(await decodeRaceSimShareCode('not-a-code')).toBeNull();
    expect(await decodeRaceSimShareCode('z123abc')).toBeNull();
    expect(await decodeRaceSimShareCode('rs1:!!!notbase64!!!')).toBeNull();

    // Valid base64 but not gzip.
    expect(await decodeRaceSimShareCode('rs1:aGVsbG8')).toBeNull();

    // gzip of invalid (non-snapshot) JSON.
    const badPayload = await gzipStringToBase64(JSON.stringify({ hello: 'world' }));
    expect(await decodeRaceSimShareCode(`rs1:${badPayload}`)).toBeNull();
  });
});
