import type { PanelRequest, PanelResponse } from './types';

/** Typed wrapper so callers get a rejected promise instead of an `ok: false`. */
export async function send<T>(message: PanelRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as PanelResponse<T> | undefined;
  if (!response) {
    throw new Error('The extension background worker did not respond. Try reloading it.');
  }
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
