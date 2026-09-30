import {
  buildProfileViewData,
  classOf,
  isSparse,
  majorAndYear,
  metaParts,
  pinLine,
  sharedLines,
  sparseNotice,
  tierWordFor,
} from '../profile/view/model';

// Migration 0018: every tag is an interest; the major is the about section's.
const CATALOG = [
  { id: 't-gym', label: 'gym' },
  { id: 't-coffee', label: 'coffee' },
  { id: 't-crime', label: 'true crime' },
];

const NURSING = { id: 'p-nursing', label: 'nursing' };

describe('profile view model', () => {
  describe('sharedLines', () => {
    it('returns one line per interest both people have, in their order', () => {
      expect(sharedLines({ myLabels: ['coffee', 'gym'], theirLabels: ['gym', 'true crime', 'coffee'] })).toEqual([
        "you're both into gym",
        "you're both into coffee",
      ]);
    });

    it('is empty when nothing is shared, which hides the card', () => {
      expect(sharedLines({ myLabels: ['gym'], theirLabels: ['coffee'] })).toEqual([]);
      expect(sharedLines({ myLabels: [], theirLabels: ['coffee'] })).toEqual([]);
    });

    it('ignores case and duplicates', () => {
      expect(sharedLines({ myLabels: ['GYM'], theirLabels: ['gym', 'Gym'] })).toEqual(["you're both into gym"]);
    });

    it('puts the shared major first, from about (by program id), read as a field of study', () => {
      expect(
        sharedLines({ myLabels: ['gym'], theirLabels: ['gym'], myMajor: NURSING, theirMajor: { id: 'p-nursing', label: 'nursing' } })
      ).toEqual(["you're both in nursing", "you're both into gym"]);
    });

    it('no shared major line when the majors differ or either is unset', () => {
      expect(sharedLines({ myLabels: [], theirLabels: [], myMajor: NURSING, theirMajor: { id: 'p-cs', label: 'cs' } })).toEqual([]);
      expect(sharedLines({ myLabels: [], theirLabels: [], myMajor: null, theirMajor: NURSING })).toEqual([]);
    });

    it('never words a tag with an article', () => {
      expect(sharedLines({ myLabels: ['gym'], theirLabels: ['gym'] }).join(' ')).not.toMatch(/tagged|the gym/);
    });
  });

  it('tierWordFor uses the grid words, and nothing for away/county', () => {
    expect(tierWordFor('on_campus')).toBe('on campus');
    expect(tierWordFor('nearby')).toBe('nearby');
    expect(tierWordFor('away')).toBe('');
    expect(tierWordFor('county')).toBe('');
  });

  it('majorAndYear and metaParts build the pin line parts', () => {
    expect(majorAndYear('nursing', 2027)).toBe("nursing '27");
    expect(majorAndYear(null, 2027)).toBe("'27");
    expect(majorAndYear(null, null)).toBe('');
    expect(metaParts({ tier: 'nearby', majorLabel: 'business', gradYear: 2029 })).toEqual({
      tierWord: 'nearby',
      place: '',
      lead: 'nearby',
      rest: "business '29",
    });
    expect(metaParts({ tier: 'away', majorLabel: null, gradYear: 2029 })).toEqual({ tierWord: '', place: '', lead: '', rest: "'29" });
  });

  it('pinLine puts the place line in place of the tier word, and never without one', () => {
    expect(pinLine({ tier: 'on_campus', majorLabel: 'nursing', gradYear: 2027, placeLine: 'library, 2nd floor' })).toBe(
      "library, 2nd floor · nursing '27"
    );
    expect(pinLine({ tier: 'nearby', majorLabel: 'business', gradYear: null, placeLine: null })).toBe('nearby · business');
    expect(pinLine({ tier: 'away', majorLabel: 'nursing', gradYear: 2027, placeLine: 'library' })).toBe("nursing '27");
    expect(pinLine({ tier: 'nearby', majorLabel: null, gradYear: null, placeLine: '   ' })).toBe('nearby');
  });

  it('classOf formats the basics year line', () => {
    expect(classOf(2027)).toBe("class of '27");
    expect(classOf(null)).toBeNull();
  });

  describe('isSparse (05-profile-sparse.png)', () => {
    it('is true with no status, no tags beyond the major and one photo', () => {
      expect(isSparse({ statusLine: null, tagLabels: [], photoPaths: ['a.jpg'] })).toBe(true);
    });

    it('is false with a status, a tag, or a second photo', () => {
      expect(isSparse({ statusLine: 'hi', tagLabels: [], photoPaths: ['a.jpg'] })).toBe(false);
      expect(isSparse({ statusLine: null, tagLabels: ['gym'], photoPaths: ['a.jpg'] })).toBe(false);
      expect(isSparse({ statusLine: null, tagLabels: [], photoPaths: ['a.jpg', 'b.jpg'] })).toBe(false);
    });

    it('the notice never claims a joined date', () => {
      expect(sparseNotice('luis')).toBe("luis hasn't filled much in yet. not a red flag.");
      expect(sparseNotice('luis')).not.toMatch(/joined|yesterday|week|since/);
    });
  });

  it('buildProfileViewData joins the card, the catalog, my tags and the identity read', () => {
    const data = buildProfileViewData({
      card: {
        user_id: 'u-maya',
        first_name: 'maya',
        grad_year: 2027,
        status_line: '   ',
        tier: 'on_campus',
        here_now: true,
        is_online: false,
        photos: ['p0', 'p1'],
        tag_labels: ['nursing', 'gym', 'coffee'],
        goals: ['friends', 'study'],
        about: { major: NURSING, minor: null, graduating_term: 'spring', graduating_year: 2027, graduating_unsure: false, work_type: null, job_title: null, work_hours: [] },
      },
      catalog: CATALOG,
      myTagIds: ['t-gym', 'unknown'],
      myAbout: { major: NURSING, minor: null, graduatingTerm: null, graduatingYear: null, graduatingUnsure: false, workType: null, jobTitle: null, workHours: [] },
      identity: {
        cards: {
          identity: { pronouns: ['she/her'], orientation: [], interested_in: [], relationship: null },
          before_you_message: { photos_content: ["don't screenshot"] },
        },
      },
      campusShort: 'CLC',
      photoUrls: { p0: 'https://example.test/0.jpg' },
    });

    expect(data).toMatchObject({
      userId: 'u-maya',
      firstName: 'maya',
      statusLine: null,
      // The major comes from about; every tag label is an interest chip,
      // even one that happens to read like a program.
      majorLabel: 'nursing',
      tagLabels: ['nursing', 'gym', 'coffee'],
      sharedLines: ["you're both in nursing", "you're both into gym"],
      // The cards exactly as the identity read returned them; no audiences for a viewer.
      identityCards: {
        identity: { pronouns: ['she/her'], orientation: [], interested_in: [], relationship: null },
        before_you_message: { photos_content: ["don't screenshot"] },
      },
      identityAudiences: null,
      campusShort: 'CLC',
      verified: true,
      hereNow: true,
      photoPaths: ['p0', 'p1'],
    });
  });

  it('buildProfileViewData leaves the identity cards empty on a 404 (null identity)', () => {
    const data = buildProfileViewData({
      card: {
        user_id: 'u',
        first_name: 'luis',
        grad_year: 2029,
        status_line: null,
        tier: 'nearby',
        here_now: false,
        is_online: true,
        photos: null,
        tag_labels: null,
        goals: null,
      },
      catalog: [],
      myTagIds: [],
      identity: null,
      campusShort: null,
      photoUrls: {},
    });
    expect(data.identityCards).toEqual({});
    expect(data.identityAudiences).toBeNull();
    expect(data.goals).toEqual([]);
    expect(data.photoPaths).toEqual([]);
    expect(data.sharedLines).toEqual([]);
    // no about on the row: no major, no about card
    expect(data.majorLabel).toBeNull();
    expect(data.about).toBeNull();
    // migration 0015 fields absent from the row: all empty, nothing invented
    expect(data.placeLine).toBeNull();
    expect(data.prompts).toEqual([]);
    expect(data.usualPlaces).toBeNull();
    expect(data.gateOpen).toBe(false);
    expect(data.joinedMonth).toBeNull();
    expect(data.joinedRecency).toBeNull();
  });
});

describe('profile view model — migration 0015 fields', () => {
  const baseCard = {
    user_id: 'u',
    first_name: 'maya',
    grad_year: 2027,
    status_line: null,
    tier: 'on_campus' as const,
    here_now: false,
    is_online: false,
    photos: ['p0'],
    tag_labels: [],
    goals: [],
  };
  const build = (card: Record<string, unknown>) =>
    buildProfileViewData({
      card: { ...baseCard, ...card },
      catalog: [],
      myTagIds: [],
      identity: null,
      campusShort: 'CLC',
      photoUrls: {},
    });

  it('carries the place line, prompts in order, usual places, gate and join fields', () => {
    const data = build({
      place_line: 'library, 2nd floor',
      prompts: [
        { prompt_id: 'a', question: 'q a', answer: 'answer a' },
        { prompt_id: 'b', question: 'q b', answer: 'answer b' },
      ],
      usual_places: ['library', 'the gym'],
      gate_open: true,
      joined_month: '2026-01-01',
      joined_recency: 'this_week',
    });
    expect(data.placeLine).toBe('library, 2nd floor');
    expect(data.prompts).toEqual([
      { promptId: 'a', question: 'q a', answer: 'answer a' },
      { promptId: 'b', question: 'q b', answer: 'answer b' },
    ]);
    expect(data.usualPlaces).toEqual(['library', 'the gym']);
    expect(data.gateOpen).toBe(true);
    expect(data.joinedMonth).toBe('2026-01-01');
    expect(data.joinedRecency).toBe('this_week');
  });

  it('null or empty usual places are null (gated and unset look the same)', () => {
    expect(build({ usual_places: null, gate_open: false }).usualPlaces).toBeNull();
    expect(build({ usual_places: [], gate_open: true }).usualPlaces).toBeNull();
  });

  it('a blank place line is no place line; malformed prompts and unknown recency are dropped', () => {
    const data = build({
      place_line: '  ',
      prompts: [{ prompt_id: 'a' }, 'nope', { prompt_id: 'b', question: 'q', answer: 'ok' }],
      joined_recency: 'last_year',
    });
    expect(data.placeLine).toBeNull();
    expect(data.prompts).toEqual([{ promptId: 'b', question: 'q', answer: 'ok' }]);
    expect(data.joinedRecency).toBeNull();
  });

  it('the sparse notice uses joined_recency, else claims nothing about when', () => {
    expect(sparseNotice('luis', 'today')).toBe("luis joined today and hasn't filled much in. not a red flag.");
    expect(sparseNotice('luis', 'yesterday')).toBe("luis joined yesterday and hasn't filled much in. not a red flag.");
    expect(sparseNotice('luis', 'this_week')).toBe("luis joined this week and hasn't filled much in. not a red flag.");
    expect(sparseNotice('luis', null)).toBe("luis hasn't filled much in yet. not a red flag.");
    for (const r of ['today', 'yesterday', 'this_week', null] as const) {
      expect(sparseNotice('luis', r)).not.toMatch(/semester|year|first/);
    }
  });

  it('a prompt answer means the profile is not sparse', () => {
    const prompts = [{ promptId: 'a', question: 'q', answer: 'a' }];
    expect(isSparse({ statusLine: null, tagLabels: [], photoPaths: ['a.jpg'], prompts })).toBe(false);
    expect(isSparse({ statusLine: null, tagLabels: [], photoPaths: ['a.jpg'], prompts: [] })).toBe(true);
  });
});
