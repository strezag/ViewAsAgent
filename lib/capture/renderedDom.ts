export interface RenderedCapture {
  html: string;
  url: string;
  title: string;
}

/**
 * Injected into the page with `chrome.scripting.executeScript`, so it must be
 * fully self-contained — no imports, no closure over module scope.
 *
 * This is document A: the DOM after hydration, i.e. what the human sees and
 * what no non-rendering AI crawler ever receives.
 */
export function captureRenderedDom(): RenderedCapture {
  return {
    html: document.documentElement.outerHTML,
    url: location.href,
    title: document.title,
  };
}

/** Convert a page URL into the host permission pattern we need for it. */
export function originPatternFor(url: string): string {
  return `${new URL(url).origin}/*`;
}

/** URLs the extension can never audit, so the UI can say so instead of failing. */
export function unauditableReason(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'That is not a URL this extension can fetch.';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Agents only fetch over HTTP. This page is ${parsed.protocol.replace(':', '')}.`;
  }
  return null;
}
