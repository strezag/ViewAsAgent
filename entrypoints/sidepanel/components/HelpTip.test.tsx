// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpTip } from './ui';

/**
 * The interaction is the whole justification for replacing a native `title`
 * tooltip, so it is worth pinning down. An earlier version folded focus into
 * the hover state, which left a keyboard user unable to dismiss the panel:
 * Escape cleared the pin, and the still-focused trigger held it open again.
 */

afterEach(cleanup);

const setup = () =>
  render(
    <div>
      <HelpTip label="How Reachability is scored">
        <p>Check WAF rules first.</p>
      </HelpTip>
      <button type="button">Somewhere else</button>
    </div>,
  );

const trigger = () => screen.getByRole('button', { name: 'How Reachability is scored' });
const panel = () => screen.queryByRole('tooltip');

describe('HelpTip', () => {
  it('stays closed until asked for', () => {
    setup();
    expect(panel()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on hover and closes when the pointer leaves', async () => {
    const user = userEvent.setup();
    setup();

    await user.hover(trigger());
    expect(panel()).not.toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    await user.unhover(trigger());
    expect(panel()).toBeNull();
  });

  it('opens on keyboard focus, so it is reachable without a mouse', async () => {
    const user = userEvent.setup();
    setup();

    await user.tab();
    expect(trigger()).toHaveFocus();
    expect(panel()).not.toBeNull();
  });

  it('closes on Escape even when the trigger still has focus', async () => {
    const user = userEvent.setup();
    setup();

    await user.tab();
    expect(panel()).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(panel()).toBeNull();
    expect(trigger()).not.toHaveFocus();
  });

  it('closes a pinned panel on Escape', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(trigger());
    await user.unhover(trigger());
    expect(panel()).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(panel()).toBeNull();
  });

  it('stays open after a click once the pointer moves away', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(trigger());
    await user.unhover(trigger());
    // Pinning is what makes the text readable and selectable.
    expect(panel()).not.toBeNull();
  });

  it('closes when something else on the page is clicked', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(trigger());
    await user.unhover(trigger());
    expect(panel()).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Somewhere else' }));
    expect(panel()).toBeNull();
  });

  it('points the trigger at the panel it controls', async () => {
    const user = userEvent.setup();
    setup();

    await user.hover(trigger());
    expect(trigger().getAttribute('aria-controls')).toBe(panel()?.getAttribute('id'));
  });

  it('renders the content it was given', async () => {
    const user = userEvent.setup();
    setup();

    await user.hover(trigger());
    expect(screen.getByText('Check WAF rules first.')).toBeInTheDocument();
  });
});
