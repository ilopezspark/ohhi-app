import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// api/*.ts import the real supabase client (via ./client), which throws
// outside a real Expo config-eval context (no Constants.expoConfig under
// Jest) — mocked out so requireActual-free mocks below never touch it.
jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));

jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/photos', () => ({ listMyPhotos: jest.fn(), signedPhotoUrls: jest.fn() }));
jest.mock('../api/profile', () => ({
  getFirstName: jest.fn(),
  getGradYear: jest.fn(),
  getStatusLine: jest.fn(),
}));
jest.mock('../api/goals', () => ({ getUserGoals: jest.fn() }));
jest.mock('../api/tags', () => ({ getUserTags: jest.fn() }));
jest.mock('../api/about', () => ({ getMyAbout: jest.fn() }));
jest.mock('../photos/tint', () => ({ tintForPhoto: jest.fn(() => '#abcdef') }));
jest.mock('../me/root/queries', () => ({
  getAlbumsSummary: jest.fn(),
  getPrivateCardShareCount: jest.fn(),
}));

import { me } from '../api/me';
import { listMyPhotos, signedPhotoUrls } from '../api/photos';
import { getFirstName, getGradYear, getStatusLine } from '../api/profile';
import { getUserGoals } from '../api/goals';
import { getUserTags } from '../api/tags';
import { getAlbumsSummary, getPrivateCardShareCount } from '../me/root/queries';
import { getMyAbout } from '../api/about';
import { EMPTY_ABOUT } from '../profile/about';
import { useMeData } from '../me/root/useMeData';
import { profileCompletion } from '../profile/completion';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function baseMe(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'u1',
    status: 'active',
    verification_status: 'verified',
    campus_id: 'c1',
    campus_slug: 'clc',
    campus_label: 'College of Lake County',
    here_now: false,
    goals_count: 1,
    tags_count: 1,
    photos_count: 2,
    ...overrides,
  };
}

describe('useMeData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (me as jest.Mock).mockResolvedValue(baseMe());
    (getFirstName as jest.Mock).mockResolvedValue('izaac');
    (getGradYear as jest.Mock).mockResolvedValue(2027);
    (getStatusLine as jest.Mock).mockResolvedValue('at the library');
    (listMyPhotos as jest.Mock).mockResolvedValue([
      { position: 0, storage_path: 'u1/0.jpg', moderation_state: 'ok' },
      { position: 1, storage_path: 'u1/1.jpg', moderation_state: 'pending' },
    ]);
    (signedPhotoUrls as jest.Mock).mockResolvedValue({ 'u1/0.jpg': 'https://example.com/0.jpg' });
    (getUserGoals as jest.Mock).mockResolvedValue(['friends']);
    (getUserTags as jest.Mock).mockResolvedValue([
      { tag_id: 't1', position: 0 },
      { tag_id: 't2', position: 1 },
      { tag_id: 't3', position: 2 },
    ]);
    (getAlbumsSummary as jest.Mock).mockResolvedValue({ albumCount: 2, sharedAlbumCount: 1 });
    // Migration 0018: the major is the about section's, not a tag.
    (getMyAbout as jest.Mock).mockResolvedValue({ ...EMPTY_ABOUT, major: { id: 'p-cs', label: 'cs' }, graduatingYear: 2027 });
    (getPrivateCardShareCount as jest.Mock).mockResolvedValue(3);
  });

  it('computes a completion percent equal to profileCompletion() run over the same underlying data', async () => {
    const { result } = await renderHook(() => useMeData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.completionPercent).toBeGreaterThan(0));

    const expected = profileCompletion({ photoCount: 2, hasStatus: true, hasHereFor: true, tagCount: 3 });
    expect(result.current.completionPercent).toBe(expected.percent);
    expect(result.current.nextBestCopy).toBe(expected.nextBest?.copy ?? null);
  });

  it('is 100% complete (no next-best copy) once photos/status/hereFor/tags are all filled', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([
      { position: 0, storage_path: 'u1/0.jpg', moderation_state: 'ok' },
      { position: 1, storage_path: 'u1/1.jpg', moderation_state: 'ok' },
      { position: 2, storage_path: 'u1/2.jpg', moderation_state: 'ok' },
    ]);
    const { result } = await renderHook(() => useMeData(), { wrapper });
    await waitFor(() => expect(result.current.completionPercent).toBe(100));
    expect(result.current.nextBestCopy).toBeNull();
  });

  it('two interests leave the tags item undone', async () => {
    (getUserTags as jest.Mock).mockResolvedValue([
      { tag_id: 't1', position: 0 },
      { tag_id: 't2', position: 1 },
    ]);
    (listMyPhotos as jest.Mock).mockResolvedValue([
      { position: 0, storage_path: 'u1/0.jpg', moderation_state: 'ok' },
      { position: 1, storage_path: 'u1/1.jpg', moderation_state: 'ok' },
      { position: 2, storage_path: 'u1/2.jpg', moderation_state: 'ok' },
    ]);
    const { result } = await renderHook(() => useMeData(), { wrapper });
    await waitFor(() => expect(result.current.completionPercent).toBe(90));
  });

  it('reports verified true only when verification_status is verified', async () => {
    const { result } = await renderHook(() => useMeData(), { wrapper });
    await waitFor(() => expect(result.current.verified).toBe(true));
  });

  it('reports an unverified profile', async () => {
    (me as jest.Mock).mockResolvedValue(baseMe({ verification_status: 'unverified' }));
    const { result } = await renderHook(() => useMeData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.verified).toBe(false);
  });

  it("builds the identity line from campus short name, the about major and grad year (\"CLC · cs '27\")", async () => {
    const { result } = await renderHook(() => useMeData(), { wrapper });
    await waitFor(() => expect(result.current.identityText).toBe("CLC · cs '27"));
  });

  it('passes through the private-card share count, including zero', async () => {
    (getPrivateCardShareCount as jest.Mock).mockResolvedValue(0);
    const { result } = await renderHook(() => useMeData(), { wrapper });
    await waitFor(() => expect(result.current.privateCardShareCount).toBe(0));
  });

  it('treats a missing status as no status', async () => {
    (getStatusLine as jest.Mock).mockResolvedValue(null);
    const { result } = await renderHook(() => useMeData(), { wrapper });
    await waitFor(() => expect(result.current.statusLine).toBeNull());
  });

  it('refetch() invalidates every query this hook reads', async () => {
    const { result } = await renderHook(() => useMeData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    jest.clearAllMocks();
    (me as jest.Mock).mockResolvedValue(baseMe());
    act(() => result.current.refetch());
    await waitFor(() => expect(me).toHaveBeenCalled());
  });
});
