jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() },
}));

import { router } from 'expo-router';
import { FALLBACK, goBack } from '../routing/goBack';

describe('goBack', () => {
  beforeEach(() => jest.clearAllMocks());

  it('goes back when there is history', () => {
    (router.canGoBack as jest.Mock).mockReturnValue(true);
    goBack(FALLBACK.chats);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('replaces the fallback when there is no history (web reload, deep link)', () => {
    (router.canGoBack as jest.Mock).mockReturnValue(false);
    goBack(FALLBACK.chats);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/chats');
  });

  it('has a fallback for each area', () => {
    expect(FALLBACK).toEqual({
      tabs: '/(tabs)/grid',
      chats: '/(tabs)/chats',
      me: '/(tabs)/settings',
      editor: '/profile-editor',
      albums: '/settings/albums',
    });
  });
});
