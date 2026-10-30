import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { currentPath, meFor, mockApi, renderApp } from '../test/mockApi';

describe('app shell on small screens', () => {
  it('opens the menu, links to each page and closes after navigating', async () => {
    mockApi({
      'GET /api/auth/me': { body: meFor('patient') },
      'GET /api/patients/me': { status: 503 },
    });
    const { router } = renderApp('/dashboard');
    await screen.findByRole('heading', { name: 'Welcome' });
    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(toggle).toHaveAttribute('aria-controls', nav.id);
    // Hidden below `md` until opened; the md:flex class keeps it visible on desktop.
    expect(nav).toHaveClass('hidden', 'md:flex');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(nav).not.toHaveClass('hidden');

    fireEvent.click(within(nav).getByRole('link', { name: 'Profile' }));
    await waitFor(() => expect(currentPath(router)).toBe('/profile'));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
