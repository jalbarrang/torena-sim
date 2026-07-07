import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerGeminiEngine } from './gemini';

const WORKER_URL = 'https://ocr.test';

// Worker prompt aptitude keys (front maps to the runner's `nige` bucket, etc.).
const SAMPLE_APTITUDES = {
  turf: 'A',
  dirt: 'A',
  sprint: 'A',
  mile: 'A',
  medium: 'A',
  long: 'A',
  front: 'S',
  pace: 'A',
  late: 'A',
  end: 'A'
};

function mockWorkerFetch(text: string) {
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json(
      { ok: true, text },
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )
  );

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

function mockWorkerError(code: string, status = 429) {
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({ ok: false, code, error: `worker said ${code}` }, { status })
  );

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

function createEngine() {
  return new WorkerGeminiEngine(WORKER_URL, async () => 'test-token');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WorkerGeminiEngine', () => {
  it('parses fenced JSON responses from Gemini', async () => {
    const fencedJson = `\`\`\`json
${JSON.stringify({
  name: 'Taiki Shuttle',
  outfit: '[Wild Frontier]',
  speed: 1200,
  stamina: 900,
  power: 1000,
  guts: 800,
  wisdom: 950,
  aptitudes: SAMPLE_APTITUDES,
  strategy: 'Senkou',
  skills: ['Right-Handed ○']
})}
\`\`\``;
    const fetchMock = mockWorkerFetch(fencedJson);

    const engine = createEngine();
    const result = await engine.recognize(new Blob(['image'], { type: 'image/png' }));

    expect(fetchMock).toHaveBeenCalledWith(
      WORKER_URL,
      expect.objectContaining({
        method: 'POST'
      })
    );
    const requestBody = (fetchMock.mock.calls[0][1] as RequestInit).body;
    expect(requestBody).toBeInstanceOf(FormData);
    const form = requestBody as FormData;
    expect(form.get('token')).toBe('test-token');
    const imagePart = form.get('image');
    expect(imagePart).toBeInstanceOf(Blob);
    expect((imagePart as Blob).type).toBe('image/png');
    expect(result.structured?.speed).toBe(1200);
    expect(result.structured?.wisdom).toBe(950);
    expect(result.structured?.skills?.map((skill) => skill.id)).toEqual(['200012']);
  });

  it('maps Gemini strategy names into the app strategy names', async () => {
    mockWorkerFetch(
      JSON.stringify({
        name: 'Taiki Shuttle',
        outfit: '[Wild Frontier]',
        speed: 1100,
        stamina: 900,
        power: 1000,
        guts: 800,
        wisdom: 950,
        aptitudes: SAMPLE_APTITUDES,
        strategy: 'Nige',
        skills: []
      })
    );

    const engine = createEngine();
    const result = await engine.recognize(new Blob(['image'], { type: 'image/png' }));

    expect(result.structured?.strategy).toBe('Front Runner');
    expect(result.structured?.aptitudes?.nige).toBe('S');
  });

  it('resolves skill IDs based on whether Gemini preserved a level marker', async () => {
    mockWorkerFetch(
      JSON.stringify({
        name: 'Taiki Shuttle',
        outfit: '[Wild Frontier]',
        speed: 1100,
        stamina: 900,
        power: 1000,
        guts: 800,
        wisdom: 950,
        aptitudes: SAMPLE_APTITUDES,
        strategy: 'Senkou',
        skills: ['Shooting Star Lvl 4', 'Shooting Star', 'Right-Handed ○']
      })
    );

    const engine = createEngine();
    const result = await engine.recognize(new Blob(['image'], { type: 'image/png' }));
    const skillIds = result.structured?.skills?.map((skill) => skill.id) ?? [];

    expect(skillIds).toContain('100011');
    expect(skillIds).toContain('900011');
    expect(skillIds).toContain('200012');
  });

  it('maps raw Gemini circle OCR variants to the intended grade-specific skills', async () => {
    mockWorkerFetch(
      JSON.stringify({
        name: 'Taiki Shuttle',
        outfit: '[Wild Frontier]',
        speed: 1100,
        stamina: 900,
        power: 1000,
        guts: 800,
        wisdom: 950,
        aptitudes: SAMPLE_APTITUDES,
        strategy: 'Senkou',
        skills: ['Right-Handed ©', 'Right-Handed ®', 'Right-Handed ⊚']
      })
    );

    const engine = createEngine();
    const result = await engine.recognize(new Blob(['image'], { type: 'image/png' }));
    const skillIds = result.structured?.skills?.map((skill) => skill.id) ?? [];

    expect(skillIds).toContain('200011');
    expect(skillIds).toContain('200012');
    expect(skillIds.filter((skillId) => skillId === '200011')).toHaveLength(1);
  });

  it('fuzzy matches misspelled outfit and uma names into canonical app data', async () => {
    mockWorkerFetch(
      JSON.stringify({
        name: 'Taiki Shuttel',
        outfit: '[Wild Frontie]',
        speed: 1100,
        stamina: 900,
        power: 1000,
        guts: 800,
        wisdom: 950,
        aptitudes: SAMPLE_APTITUDES,
        strategy: 'Senkou',
        skills: []
      })
    );

    const engine = createEngine();
    const result = await engine.recognize(new Blob(['image'], { type: 'image/png' }));

    expect(result.structured?.outfitId).toBe('101001');
    expect(result.structured?.outfitName).toBe('[Wild Frontier]');
    expect(result.structured?.umaName).toBe('Taiki Shuttle');
    expect(result.structured?.umaConfidence).toBeGreaterThan(0.7);
  });

  it('surfaces a friendly message when the shared quota is exhausted', async () => {
    mockWorkerError('quota_exhausted');

    const engine = createEngine();
    await expect(
      engine.recognize(new Blob(['image'], { type: 'image/png' }))
    ).rejects.toThrow(/quota/i);
  });

  it('surfaces a friendly message when rate limited', async () => {
    mockWorkerError('rate_limited');

    const engine = createEngine();
    await expect(
      engine.recognize(new Blob(['image'], { type: 'image/png' }))
    ).rejects.toThrow(/too many imports/i);
  });
});
