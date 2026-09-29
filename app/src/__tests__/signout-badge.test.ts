/**
 * Signing out clears the app icon badge (decision 93): its counts belonged
 * to the account that just left.
 */
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../api/client', () => ({ supabase: { auth: { signOut: jest.fn(() => Promise.resolve({ error: null })) } } }));
jest.mock('../badges/appBadge', () => ({ setAppBadge: jest.fn(() => Promise.resolve()) }));

import { QueryClient } from '@tanstack/react-query';
import { setAppBadge } from '../badges/appBadge';
import { signOutAndReset } from '../settings/signOut';

it('clears the app icon badge on sign-out', async () => {
  await signOutAndReset(new QueryClient());
  expect(setAppBadge).toHaveBeenCalledWith(0);
});
