import { describe, expect, it, vi } from 'vitest';
import { createTurnstileBroker } from './turnstile-broker';

describe('createTurnstileBroker', () => {
  it('marks each consumed token unavailable through an interactive second-token sequence', async () => {
    const reset = vi.fn();
    const availability: Array<boolean> = [];
    const broker = createTurnstileBroker();
    broker.attachReset(reset);
    broker.subscribe((available) => availability.push(available));

    broker.deliver('first-token');
    await expect(broker.consume()).resolves.toBe('first-token');

    const secondToken = broker.consume();
    expect(availability).toEqual([false, true, false]);
    expect(reset).toHaveBeenCalledOnce();

    // A Managed challenge may wait for user interaction before delivering this.
    broker.deliver('interactive-second-token');
    await expect(secondToken).resolves.toBe('interactive-second-token');

    expect(availability).toEqual([false, true, false]);
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it('cancels every pending consumer without poisoning the next session', async () => {
    const availability: Array<boolean> = [];
    const broker = createTurnstileBroker();
    broker.subscribe((available) => availability.push(available));
    const abandoned = broker.consume();

    broker.cancel();

    await expect(abandoned).rejects.toMatchObject({ code: 'cancelled' });
    broker.deliver('new-token');
    await expect(broker.consume()).resolves.toBe('new-token');
    expect(availability).toEqual([false, true, false]);
  });
});
