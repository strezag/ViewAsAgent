// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { displayUrl, PageHeader } from './PageHeader';
import { SWEEP_ORDER } from '../audit';

afterEach(cleanup);

describe('displayUrl', () => {
  it('splits hostname from path and query', () => {
    expect(displayUrl('https://www.sitecore.com/products?x=1#top')).toEqual({
      host: 'www.sitecore.com',
      path: '/products?x=1#top',
    });
  });

  it('omits a lone slash so the host stands alone', () => {
    expect(displayUrl('https://example.com/')).toEqual({
      host: 'example.com',
      path: '',
    });
  });

  it('keeps a non-default port on the host', () => {
    expect(displayUrl('http://localhost:8787/fixtures')).toEqual({
      host: 'localhost:8787',
      path: '/fixtures',
    });
  });

  it('returns null for empty or unparseable input', () => {
    expect(displayUrl('')).toBeNull();
    expect(displayUrl('   ')).toBeNull();
    expect(displayUrl('not a url')).toBeNull();
  });
});

describe('PageHeader', () => {
  it('leads with the page host and mutes the path', () => {
    render(
      <PageHeader
        url="https://www.sitecore.com/products"
        onRun={() => {}}
        running={false}
        disabled={false}
      />,
    );

    expect(screen.getByText('www.sitecore.com')).toBeInTheDocument();
    expect(screen.getByText('/products')).toBeInTheDocument();
    expect(screen.queryByText('ViewAsAgent')).toBeNull();
  });

  it('falls back when there is no usable URL', () => {
    render(<PageHeader url="" onRun={() => {}} running={false} disabled={false} />);
    expect(screen.getByText('no page')).toBeInTheDocument();
  });

  it('falls back to the raw string when the URL cannot be parsed', () => {
    render(<PageHeader url="not a url" onRun={() => {}} running={false} disabled={false} />);
    expect(screen.getByText('not a url')).toBeInTheDocument();
  });

  it('labels the idle button with the agent count', () => {
    render(
      <PageHeader
        url="https://example.com/"
        onRun={() => {}}
        running={false}
        disabled={false}
      />,
    );
    expect(
      screen.getByRole('button', { name: `Check all ${SWEEP_ORDER.length} agents` }),
    ).toBeEnabled();
  });

  it('shows sweep progress on the button while running', () => {
    render(
      <PageHeader
        url="https://example.com/"
        onRun={() => {}}
        running
        disabled={false}
        progress={{ done: 5, total: 17 }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Checking 5 of 17…' })).toBeDisabled();
  });

  it('disables the button when the page cannot be audited', () => {
    render(
      <PageHeader
        url="https://example.com/"
        onRun={() => {}}
        running={false}
        disabled
      />,
    );
    expect(
      screen.getByRole('button', { name: `Check all ${SWEEP_ORDER.length} agents` }),
    ).toBeDisabled();
  });

  it('fires onRun when the button is clicked', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(
      <PageHeader url="https://example.com/" onRun={onRun} running={false} disabled={false} />,
    );

    await user.click(screen.getByRole('button', { name: `Check all ${SWEEP_ORDER.length} agents` }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});
