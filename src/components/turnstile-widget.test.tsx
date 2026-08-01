// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnstileWidget } from './turnstile-widget';

type RenderOptions = Parameters<NonNullable<Window['turnstile']>['render']>[1];

afterEach(() => {
  cleanup();
  document.getElementById('cf-turnstile-script')?.remove();
  delete window.turnstile;
});

describe('TurnstileWidget', () => {
  it('retries a rejected script load and forwards responsive and timeout options', async () => {
    const onError = vi.fn();
    const firstRender = render(
      <TurnstileWidget siteKey="site-key" onVerify={() => {}} onError={onError} />
    );
    const failedScript = document.querySelector<HTMLScriptElement>('#cf-turnstile-script');

    expect(failedScript?.src).toContain('render=explicit');
    fireEvent.error(failedScript!);
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(document.getElementById('cf-turnstile-script')).toBeNull();
    firstRender.unmount();

    const renderWidget = vi.fn((_element: HTMLElement, _options: RenderOptions) => 'widget-id');
    const remove = vi.fn();
    const reset = vi.fn();
    const onVerify = vi.fn();
    const onExpire = vi.fn();
    const onTimeout = vi.fn();

    const retryRender = render(
      <TurnstileWidget
        siteKey="site-key"
        size="flexible"
        onVerify={onVerify}
        onExpire={onExpire}
        onError={onError}
        onTimeout={onTimeout}
      />
    );
    const retryScript = document.querySelector<HTMLScriptElement>('#cf-turnstile-script');
    expect(retryScript).not.toBe(failedScript);

    window.turnstile = { render: renderWidget, remove, reset };
    fireEvent.load(retryScript!);

    await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());
    const options = renderWidget.mock.calls[0][1];
    expect(options).toMatchObject({ sitekey: 'site-key', size: 'flexible' });

    options.callback?.('fresh-token');
    options['expired-callback']?.();
    options['timeout-callback']?.();
    expect(onVerify).toHaveBeenCalledWith('fresh-token');
    expect(onExpire).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledOnce();

    retryRender.unmount();
    expect(remove).toHaveBeenCalledWith('widget-id');
  });
});
