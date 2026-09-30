const mockGetSession = jest.fn();
const mockGetUser = jest.fn();

jest.mock('../api/client', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
  },
  SUPABASE_URL: 'https://example.test',
}));

import { getCard, getIdentity, getMyIdentity, getSharedPrivateCard, revealCardSection } from '../api/identity';
import { getMyCard, putCard, putIdentity } from '../api/identityWrite';
import { GoneError, InvalidInputError, RefusedError, UnknownError } from '../api/errors';
import {
  CARD_SECTION_SPECS,
  defaultAudiences,
  emptyIdentityCards,
  IDENTITY_FIELD_SPECS,
  identityPayloadFromCards,
  normalizeTypedEntry,
} from '../profile/fields';
import { CARD_SECTION_ROWS, IDENTITY_CARD_ROWS } from '../me/card/fieldLabels';

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const BASE = 'https://example.test/functions/v1/identity';

function respond(status: number, body?: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) });
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  return fetchMock;
}

const OWNER_BODY = {
  user_id: ME,
  cards: {
    identity: { pronouns: ['she/her', 'they/them'], orientation: ['bi'], interested_in: ['women'], relationship: 'single' },
    background: { languages: [], faith: null, faith_weight: null, politics: null, politics_weight: null },
    lifestyle: { drinking: 'socially', smoking: null, four_twenty: null, kids: null },
    around: { when_free: [], communication: [] },
    before_you_message: { photos_content: ["don't screenshot"] },
  },
  audiences: { identity: 'everyone', background: 'after_hi', lifestyle: 'only_me', around: 'everyone' },
  is_public: true,
  pronouns: 'she/her',
  orientation: ['bi'],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null });
  mockGetUser.mockResolvedValue({ data: { user: { id: ME } } });
});

describe('GET /identity/:user_id', () => {
  it("returns the owner's five cards, audiences and is_public as sent", async () => {
    const fetchMock = respond(200, OWNER_BODY);
    const identity = await getIdentity(ME);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/${ME}`, { headers: { Authorization: 'Bearer jwt' } });
    expect(identity).toEqual(OWNER_BODY);
  });

  it('keeps only the cards a viewer was sent, fills missing keys, and has no owner settings', async () => {
    respond(200, {
      user_id: OWNER,
      cards: { identity: { pronouns: ['she/her'] }, before_you_message: { photos_content: ["don't screenshot", 7] } },
      pronouns: 'she/her',
      orientation: [],
    });
    const identity = await getIdentity(OWNER);
    expect(identity).toEqual({
      user_id: OWNER,
      cards: {
        identity: { pronouns: ['she/her'], orientation: [], interested_in: [], relationship: null },
        before_you_message: { photos_content: ["don't screenshot"] },
      },
      audiences: null,
      is_public: null,
      pronouns: 'she/her',
      orientation: [],
    });
  });

  it('derives the transitional pronouns/orientation from cards.identity when the keys are missing', async () => {
    respond(200, { user_id: OWNER, cards: { identity: { pronouns: ['he/they', 'any pronouns'], orientation: ['pan'] } } });
    const identity = await getIdentity(OWNER);
    expect(identity?.pronouns).toBe('he/they');
    expect(identity?.orientation).toEqual(['pan']);
  });

  it('turns the 404 into null (no cards, never an error)', async () => {
    respond(404, { error: { code: 'not_found', message: 'Not found.' } });
    await expect(getIdentity(OWNER)).resolves.toBeNull();
  });

  it('maps 401 to the generic refusal and 500 to unknown', async () => {
    respond(401, {});
    await expect(getIdentity(OWNER)).rejects.toBeInstanceOf(RefusedError);
    respond(500, {});
    await expect(getIdentity(OWNER)).rejects.toBeInstanceOf(UnknownError);
  });

  it("getMyIdentity: the owner's 404 (never written) is every card empty with default audiences", async () => {
    respond(404);
    const mine = await getMyIdentity();
    expect(mine.cards).toEqual(emptyIdentityCards());
    expect(mine.audiences).toEqual(defaultAudiences());
    expect(mine.user_id).toBe(ME);
  });

  it('flattens cards into one payload for an editor', () => {
    const payload = identityPayloadFromCards(OWNER_BODY.cards);
    expect(payload.relationship).toBe('single');
    expect(payload.photos_content).toEqual(["don't screenshot"]);
    expect(Object.keys(payload)).toHaveLength(16);
  });
});

describe('PUT /identity', () => {
  it('sends the v1 onboarding body unchanged', async () => {
    const fetchMock = respond(200, { user_id: ME, key_version: 1, fields_filled: 2, updated_at: 'now' });
    await putIdentity({ pronouns: 'she/her', orientation: ['bi'], is_public: false });
    expect(fetchMock).toHaveBeenCalledWith(BASE, {
      method: 'PUT',
      headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify({ pronouns: 'she/her', orientation: ['bi'], is_public: false }),
    });
  });

  it('sends a v2 partial patch with audiences as is', async () => {
    const fetchMock = respond(200, { user_id: ME, key_version: 1, fields_filled: 7, updated_at: 'now' });
    const result = await putIdentity({ kids: 'not sure', faith: 'jewish', faith_weight: 'important', audiences: { lifestyle: 'after_hi' } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      kids: 'not sure',
      faith: 'jewish',
      faith_weight: 'important',
      audiences: { lifestyle: 'after_hi' },
    });
    expect(result.fields_filled).toBe(7);
  });

  it("maps the word filter's 400 to the neutral line, never echoing the text", async () => {
    respond(400, { error: { code: 'validation_failed', message: "that text can't be used" } });
    const error = await putIdentity({ languages: ['something rude'] }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toBe("that text can't be used.");
  });

  it('maps any other 400 to unknown, a 404 to gone and a 403 to the refusal', async () => {
    respond(400, { error: { code: 'validation_failed', message: 'kids contains an unknown value.' } });
    await expect(putIdentity({ kids: 'x' })).rejects.toBeInstanceOf(UnknownError);
    respond(404, { error: { code: 'not_found', message: 'Not found.' } });
    await expect(putIdentity({ kids: null })).rejects.toBeInstanceOf(GoneError);
    respond(403, {});
    await expect(putIdentity({ kids: null })).rejects.toBeInstanceOf(RefusedError);
  });
});

describe('the private card', () => {
  it("owner: all nine sections and no covers", async () => {
    const fetchMock = respond(200, {
      user_id: ME,
      shows_interest: ['food'],
      pace: 'slow',
      living_situation: null,
      hosting: "i can't host",
      safer_sex: ['condoms'],
      dynamics: ['switch'],
      practices: [],
      hard_nos: ['no calls'],
      privacy: ['keep this between us'],
      gated: [],
    });
    const card = await getCard(ME);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/card/${ME}`, { headers: { Authorization: 'Bearer jwt' } });
    expect(card?.gated).toEqual([]);
    expect(Object.keys(card?.sections ?? {})).toHaveLength(9);
    expect(card?.sections.hosting).toBe("i can't host");
  });

  it('recipient: standard + boundaries, gated names in group order, unknown names dropped', async () => {
    respond(200, {
      user_id: OWNER,
      shows_interest: ['food'],
      pace: 'slow',
      living_situation: null,
      hosting: null,
      hard_nos: ['no calls'],
      privacy: [],
      gated: ['practices', 'safer_sex', 'kinks'],
    });
    const card = await getCard(OWNER);
    expect(card?.gated).toEqual(['safer_sex', 'practices']);
    expect(card?.sections).not.toHaveProperty('safer_sex');
    expect(card?.sections.hard_nos).toEqual(['no calls']);
  });

  it('turns the 404 (no active share) into null', async () => {
    respond(404, { error: { code: 'not_found', message: 'Not found.' } });
    await expect(getCard(OWNER)).resolves.toBeNull();
  });

  it('reveals one gated section on tap, and a 404 there is null too', async () => {
    const fetchMock = respond(200, { user_id: OWNER, section: 'safer_sex', values: ['condoms', 'tested recently'] });
    await expect(revealCardSection(OWNER, 'safer_sex')).resolves.toEqual(['condoms', 'tested recently']);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/card/${OWNER}/reveal/safer_sex`, { headers: { Authorization: 'Bearer jwt' } });
    respond(404);
    await expect(revealCardSection(OWNER, 'dynamics')).resolves.toBeNull();
  });

  it('PUT /identity/card sends a v2 patch', async () => {
    const fetchMock = respond(200, { user_id: ME, key_version: 1, fields_filled: 2, updated_at: 'now' });
    await putCard({ pace: 'slow', hard_nos: ['no calls'] });
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/card`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ pace: 'slow', hard_nos: ['no calls'] });
  });

  it('the v1 readers down-map a v2 body for the pre-restructure screens', async () => {
    respond(200, { user_id: ME, safer_sex: ['condoms'], dynamics: ['switch'], practices: ['rope'], hard_nos: ['no calls'], gated: [] });
    await expect(getMyCard()).resolves.toEqual({ into: [], safer_sex: ['condoms'], kinks: ['switch', 'rope'], hard_nos: ['no calls'] });
    respond(200, { user_id: OWNER, hard_nos: ['no calls'], gated: ['safer_sex'] });
    await expect(getSharedPrivateCard(OWNER)).resolves.toEqual({ into: [], safer_sex: [], kinks: [], hard_nos: ['no calls'] });
  });
});

describe('specs and labels', () => {
  it('typed entries follow the function: listed options canonicalise, typed ones are capped', () => {
    expect(normalizeTypedEntry('  SHE/HER ', IDENTITY_FIELD_SPECS.pronouns, [])).toEqual({ ok: true, value: 'she/her', listed: true });
    expect(normalizeTypedEntry('x'.repeat(17), IDENTITY_FIELD_SPECS.pronouns, []).rejection).toBe('too_long');
    expect(normalizeTypedEntry('ey/em', IDENTITY_FIELD_SPECS.pronouns, ['ze/zir']).rejection).toBe('too_many');
    expect(normalizeTypedEntry('ey/em', IDENTITY_FIELD_SPECS.pronouns, ['she/her'])).toEqual({ ok: true, value: 'ey/em', listed: false });
    expect(normalizeTypedEntry('slowish', CARD_SECTION_SPECS.pace, []).rejection).toBe('not_listed');
  });

  it('labels every card section in group order, hard nos then privacy last', () => {
    expect(CARD_SECTION_ROWS.map((row) => row.section)).toEqual([
      'shows_interest',
      'pace',
      'living_situation',
      'hosting',
      'safer_sex',
      'dynamics',
      'practices',
      'hard_nos',
      'privacy',
    ]);
    expect(CARD_SECTION_ROWS[0].label).toBe('how i show i like someone');
    expect(CARD_SECTION_ROWS.map((row) => row.group)).toEqual([
      'standard',
      'standard',
      'standard',
      'standard',
      'gated',
      'gated',
      'gated',
      'always_attached',
      'always_attached',
    ]);
  });

  it('labels the five public cards and their 16 fields in render order', () => {
    expect(IDENTITY_CARD_ROWS.map((row) => row.label)).toEqual([
      'identity',
      'background',
      'lifestyle',
      "when i'm around",
      'before you message me',
    ]);
    expect(IDENTITY_CARD_ROWS.flatMap((row) => row.fields)).toHaveLength(16);
    expect(IDENTITY_CARD_ROWS[2].fields.map((f) => f.label)).toEqual(['drinking', 'smoking', '420', 'kids']);
  });
});
