import { Alert, Platform } from 'react-native';
import { fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * A full private card (payload v2) end to end, from the identity function's
 * wire body to every screen that shows it: `parseCardResponse` (via the real
 * `getCard`) -> `fetchMyCard`/`useMyCard` -> the "N of 9 filled in" summary,
 * the owner's preview (`PrivateCardView`) and the editor's initial state.
 * Every section is filled, every multi list is at its cap (all its options;
 * hard nos: every fixed chip plus a typed one), so nothing may be dropped,
 * truncated or miscounted anywhere along the way.
 *
 * Then the web failure: the identity function sends no CORS headers
 * (`supabase/functions/identity/README.md`, "No CORS headers"), so a browser
 * blocks the read and `fetch` rejects with a `TypeError`. Every screen must
 * show that as a failed read, never as an empty card.
 */

const mockGetSession = jest.fn();
jest.mock('../api/client', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
  SUPABASE_URL: 'https://example.test',
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => {
      cb();
    }, [cb]);
  },
}));
jest.mock('../api/session', () => ({ currentUserId: jest.fn(() => Promise.resolve('11111111-1111-4111-8111-111111111111')) }));
jest.mock('../api/profile', () => ({ getFirstName: jest.fn(() => Promise.resolve('debbie')) }));
jest.mock('../api/shares', () => ({ revokeShare: jest.fn() }));
jest.mock('../api/identityWrite', () => ({ putCard: jest.fn() }));
jest.mock('../me/card/sharedWith', () => ({ listPrivateCardSharedWith: jest.fn(() => Promise.resolve([])) }));

import { getCard, parseCardResponse } from '../api/identity';
import { UnknownError } from '../api/errors';
import PrivateCardScreen from '../app/me/private-card';
import EditPrivateCardScreen from '../app/profile-editor/private-card';
import { fetchMyCard, useMyCard } from '../me/card/myCard';
import { privateCardFilledCount, usePrivateCardSummary } from '../me/card/summary';
import { PrivateCardView } from '../me/card/PrivateCardView';
import { CARD_SECTION_SPECS, isSingleField, type CardPayload, type CardSection } from '../profile/fields';
import {
  CARD_SECTIONS,
  DYNAMICS_OPTIONS,
  HARD_NO_OPTIONS,
  HOSTING_OPTIONS,
  LIVING_SITUATION_OPTIONS,
  PACE_OPTIONS,
  PRIVACY_OPTIONS,
  SAFER_SEX_OPTIONS,
  SHOWS_INTEREST_OPTIONS,
} from '../settings/vocab';
import { PRACTICE_OPTIONS } from '../profile/fields';

const ME = '11111111-1111-4111-8111-111111111111';
const TYPED_HARD_NO = 'no voice notes after midnight';

/** Every section filled; every multi at its cap; one typed hard no after the 20 fixed ones. */
const FULL: CardPayload = {
  shows_interest: [...SHOWS_INTEREST_OPTIONS],
  pace: PACE_OPTIONS[PACE_OPTIONS.length - 1],
  living_situation: LIVING_SITUATION_OPTIONS[0],
  hosting: HOSTING_OPTIONS[1],
  safer_sex: [...SAFER_SEX_OPTIONS],
  dynamics: [...DYNAMICS_OPTIONS],
  practices: [...PRACTICE_OPTIONS],
  hard_nos: [...HARD_NO_OPTIONS, TYPED_HARD_NO],
  privacy: [...PRIVACY_OPTIONS],
};

/** The owner's `GET /identity/card/:me` body, exactly as the router sends it (flat, `gated: []`). */
const OWNER_BODY = { user_id: ME, ...FULL, gated: [] };

function valuesOf(section: CardSection, card: CardPayload = FULL): string[] {
  const value = card[section];
  return Array.isArray(value) ? value : value ? [value] : [];
}

const TOTAL_VALUES = CARD_SECTIONS.reduce((sum, section) => sum + valuesOf(section).length, 0);

function respondWith(body: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({ status: 200, ok: true, json: () => Promise.resolve(body) });
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  return fetchMock;
}

/** What a browser does with a response that has no `Access-Control-Allow-Origin`: the request never resolves to a Response. */
function blockLikeABrowser() {
  const fetchMock = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  return fetchMock;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function withClient(ui: ReactNode) {
  return render(<QueryClientProvider client={newClient()}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null });
});

describe('the fixture really is a full card', () => {
  it('fills all nine sections, every multi list at its cap, with one typed hard no', () => {
    for (const section of CARD_SECTIONS) {
      const spec = CARD_SECTION_SPECS[section];
      if (isSingleField(section)) {
        expect(typeof FULL[section]).toBe('string');
      } else if (section === 'hard_nos') {
        expect(FULL.hard_nos).toEqual([...spec.options, TYPED_HARD_NO]);
      } else {
        expect(FULL[section]).toEqual([...spec.options]);
      }
    }
    expect(TOTAL_VALUES).toBeGreaterThan(100);
  });
});

describe('wire body -> parseCardResponse -> fetchMyCard', () => {
  it('parseCardResponse keeps every section and every value, in order', () => {
    const parsed = parseCardResponse(OWNER_BODY, ME);
    expect(parsed.user_id).toBe(ME);
    expect(parsed.gated).toEqual([]);
    expect(parsed.sections).toEqual(FULL);
  });

  it('getCard reads the owner route and fetchMyCard returns the full card untouched', async () => {
    const fetchMock = respondWith(OWNER_BODY);
    await expect(getCard(ME)).resolves.toEqual({ user_id: ME, sections: FULL, gated: [] });
    expect(fetchMock).toHaveBeenCalledWith(`https://example.test/functions/v1/identity/card/${ME}`, {
      headers: { Authorization: 'Bearer jwt' },
    });
    await expect(fetchMyCard()).resolves.toEqual(FULL);
  });

  it('useMyCard holds the full card', async () => {
    respondWith(OWNER_BODY);
    const client = newClient();
    const { result } = await renderHook(() => useMyCard(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(FULL);
  });
});

describe('the "N of 9 filled in" count', () => {
  it('is 9 for the full card, counted the way the function counts fields_filled', async () => {
    respondWith(OWNER_BODY);
    expect(privateCardFilledCount(FULL)).toBe(9);
    const client = newClient();
    const { result } = await renderHook(() => usePrivateCardSummary(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current).toEqual({ filled: 9, total: 9 }));
  });

  it('counts a single value (pace, living situation, hosting) once when set, and an empty list or null not at all', () => {
    const empty: CardPayload = {
      shows_interest: [],
      pace: null,
      living_situation: null,
      hosting: null,
      safer_sex: [],
      dynamics: [],
      practices: [],
      hard_nos: [],
      privacy: [],
    };
    expect(privateCardFilledCount(empty)).toBe(0);
    expect(privateCardFilledCount({ ...empty, pace: PACE_OPTIONS[0] })).toBe(1);
    expect(privateCardFilledCount({ ...empty, pace: PACE_OPTIONS[0], hosting: HOSTING_OPTIONS[0] })).toBe(2);
    expect(privateCardFilledCount({ ...empty, hard_nos: [TYPED_HARD_NO] })).toBe(1);
    for (const section of CARD_SECTIONS) {
      expect(privateCardFilledCount({ ...empty, [section]: FULL[section] })).toBe(1);
    }
  });

  it('is unknown (null), never 0, while loading and when the read fails', async () => {
    blockLikeABrowser();
    const client = newClient();
    const { result } = await renderHook(() => usePrivateCardSummary(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(result.current).toEqual({ filled: null, total: 9 });
    await waitFor(() => expect(client.getQueryState(['me', 'card', 'v2'])?.status).toBe('error'));
    expect(result.current).toEqual({ filled: null, total: 9 });
  });
});

describe('PrivateCardView shows every chip of the full card', () => {
  it('renders all nine sections and every value, with no truncation', async () => {
    const { getByTestId, getAllByTestId } = await render(<PrivateCardView name="debbie" sections={FULL} showGroupCaptions />);
    for (const section of CARD_SECTIONS) {
      getByTestId(`private-card-view-section-${section}`);
      for (const value of valuesOf(section)) getByTestId(`private-card-view-section-${section}-${value}`);
    }
    const sectionIds = getAllByTestId(new RegExp(`^private-card-view-section-(${CARD_SECTIONS.join('|')})$`));
    expect(sectionIds).toHaveLength(9);
    const chips = getAllByTestId(new RegExp(`^private-card-view-section-(${CARD_SECTIONS.join('|')})-.+$`));
    expect(chips).toHaveLength(TOTAL_VALUES);
  });

  it('shows a single-value section as exactly one chip, and the typed hard no after the fixed ones', async () => {
    const { getAllByTestId } = await render(<PrivateCardView name="debbie" sections={FULL} />);
    for (const section of ['pace', 'living_situation', 'hosting'] as const) {
      expect(getAllByTestId(new RegExp(`^private-card-view-section-${section}-.+$`))).toHaveLength(1);
    }
    const hardNos = getAllByTestId(/^private-card-view-section-hard_nos-.+$/).map((node) =>
      String(node.props.testID).replace('private-card-view-section-hard_nos-', '')
    );
    expect(hardNos).toEqual([...HARD_NO_OPTIONS, TYPED_HARD_NO]);
  });
});

describe('the owner preview (/me/private-card) with the full card', () => {
  it('renders every chip through PrivateCardView', async () => {
    respondWith(OWNER_BODY);
    const screen = await withClient(<PrivateCardScreen />);
    await screen.findByTestId('private-card-preview');
    expect(screen.queryByTestId('private-card-empty')).toBeNull();
    const chips = screen.getAllByTestId(new RegExp(`^private-card-preview-section-(${CARD_SECTIONS.join('|')})-.+$`));
    expect(chips).toHaveLength(TOTAL_VALUES);
    screen.getByTestId(`private-card-preview-section-hard_nos-${TYPED_HARD_NO}`);
  });
});

describe('the editor (/profile-editor/private-card) with the full card', () => {
  it('opens with every saved value picked, and nothing else', async () => {
    respondWith(OWNER_BODY);
    const screen = await withClient(<EditPrivateCardScreen />);
    await screen.findByTestId('private-card-editor-screen');

    let picked = 0;
    for (const section of CARD_SECTIONS) {
      for (const value of valuesOf(section)) {
        expect(screen.getByTestId(`private-card-editor-${section}-${value}`).props.accessibilityState?.checked).toBe(true);
        picked += 1;
      }
      // single-value sections: every other option is unpicked
      if (isSingleField(section)) {
        for (const option of CARD_SECTION_SPECS[section].options) {
          if (option === FULL[section]) continue;
          expect(screen.getByTestId(`private-card-editor-${section}-${option}`).props.accessibilityState?.checked).toBe(false);
        }
      }
    }
    expect(picked).toBe(TOTAL_VALUES);
    expect(screen.queryByTestId('private-card-editor-error')).toBeNull();
  });

  it('still shows a saved value that is no longer on the list, picked, so it can be seen and removed', async () => {
    const retired = 'a chip retired after it was saved';
    respondWith({ ...OWNER_BODY, safer_sex: [SAFER_SEX_OPTIONS[0], retired], pace: 'a retired pace' });
    const screen = await withClient(<EditPrivateCardScreen />);
    await screen.findByTestId('private-card-editor-screen');
    expect(screen.getByTestId(`private-card-editor-safer_sex-${retired}`).props.accessibilityState?.checked).toBe(true);
    expect(screen.getByTestId('private-card-editor-pace-a retired pace').props.accessibilityState?.checked).toBe(true);

    await fireEvent.press(screen.getByTestId(`private-card-editor-safer_sex-${retired}`));
    expect(screen.getByTestId(`private-card-editor-safer_sex-${retired}`).props.accessibilityState?.checked).toBe(false);
  });
});

describe('web: the identity function read is blocked by the browser (no CORS headers)', () => {
  const originalOS = Platform.OS;
  beforeEach(() => {
    Platform.OS = 'web';
  });
  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('getCard rejects with UnknownError (not null, which would mean "no card")', async () => {
    blockLikeABrowser();
    await expect(getCard(ME)).rejects.toBeInstanceOf(UnknownError);
  });

  it('the owner preview says it could not load, never "nothing here yet", and try again reloads', async () => {
    const fetchMock = blockLikeABrowser();
    const screen = await withClient(<PrivateCardScreen />);
    await screen.findByTestId('private-card-load-error');
    expect(screen.queryByTestId('private-card-empty')).toBeNull();
    expect(screen.queryByTestId('private-card-preview')).toBeNull();

    fetchMock.mockResolvedValue({ status: 200, ok: true, json: () => Promise.resolve(OWNER_BODY) });
    await fireEvent.press(screen.getByTestId('private-card-load-retry'));
    await screen.findByTestId('private-card-preview');
    expect(screen.getAllByTestId(new RegExp(`^private-card-preview-section-(${CARD_SECTIONS.join('|')})-.+$`))).toHaveLength(
      TOTAL_VALUES
    );
  });

  it('the editor does not open on an empty card: it says it could not load, and try again reloads', async () => {
    const fetchMock = blockLikeABrowser();
    const screen = await withClient(<EditPrivateCardScreen />);
    await screen.findByTestId('private-card-editor-load-error');
    expect(screen.queryByTestId('private-card-editor-screen')).toBeNull();
    expect(screen.queryByTestId('private-card-editor-save')).toBeNull();

    fetchMock.mockResolvedValue({ status: 200, ok: true, json: () => Promise.resolve(OWNER_BODY) });
    await fireEvent.press(screen.getByTestId('private-card-editor-load-retry'));
    await screen.findByTestId('private-card-editor-screen');
    expect(screen.getByTestId(`private-card-editor-hard_nos-${TYPED_HARD_NO}`).props.accessibilityState?.checked).toBe(true);
  });
});
