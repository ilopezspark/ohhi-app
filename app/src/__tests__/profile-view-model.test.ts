import {
  buildProfileViewData,
  classOf,
  isSparse,
  majorAndYear,
  metaParts,
  pinLine,
  sharedTagLines,
  sparseNotice,
  splitMajor,
  tierWordFor,
} from '../profile/view/model';

const CATALOG = [
  { id: 't-nursing', label: 'nursing', category: 'major' },
  { id: 't-business', label: 'business', category: 'major' },
  { id: 't-gym', label: 'gym', category: 'interest' },
  { id: 't-coffee', label: 'coffee', category: 'interest' },
  { id: 't-crime', label: 'true crime', category: 'interest' },
];

describe('profile view model', () => {
  describe('splitMajor', () => {
    it('pulls the first major-category label out of the tags, keeping the rest in order', () => {
      expect(splitMajor(['gym', 'nursing', 'coffee'], CATALOG)).toEqual({ majorLabel: 'nursing', otherTags: ['gym', 'coffee'] });
    });

    it('only takes one major; a second stays a chip', () => {
      expect(splitMajor(['nursing', 'business'], CATALOG)).toEqual({ majorLabel: 'nursing', otherTags: ['business'] });
    });

    it('matches labels case-insensitively', () => {
      expect(splitMajor(['Nursing'], CATALOG).majorLabel).toBe('Nursing');
    });

    it('with no catalog, nothing is a major and every tag stays a chip', () => {
      expect(splitMajor(['nursing', 'gym'], [])).toEqual({ majorLabel: null, otherTags: ['nursing', 'gym'] });
    });
  });

  describe('sharedTagLines', () => {
    it('returns one line per tag both people have, in their order', () => {
      expect(sharedTagLines(['coffee', 'gym'], ['gym', 'true crime', 'coffee'])).toEqual([
        "you're both into gym",
        "you're both into coffee",
      ]);
    });

    it('is empty when nothing is shared, which hides the card', () => {
      expect(sharedTagLines(['gym'], ['coffee'])).toEqual([]);
      expect(sharedTagLines([], ['coffee'])).toEqual([]);
    });

    it('ignores case and duplicates', () => {
      expect(sharedTagLines(['GYM'], ['gym', 'Gym'])).toEqual(["you're both into gym"]);
    });

    it('needs no article for any label, and reads the major as a field of study', () => {
      expect(sharedTagLines(['library', 'night classes', 'nursing'], ['library', 'night classes', 'nursing'], 'nursing')).toEqual([
        "you're both into library",
        "you're both into night classes",
        "you're both in nursing",
      ]);
      expect(sharedTagLines(['gym'], ['gym']).join(' ')).not.toMatch(/tagged|the gym/);
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
      },
      catalog: CATALOG,
      myTagIds: ['t-gym', 't-nursing', 'unknown'],
      identity: { pronouns: 'she/her', orientation: [] },
      campusShort: 'CLC',
      photoUrls: { p0: 'https://example.test/0.jpg' },
    });

    expect(data).toMatchObject({
      userId: 'u-maya',
      firstName: 'maya',
      statusLine: null,
      majorLabel: 'nursing',
      tagLabels: ['gym', 'coffee'],
      sharedLines: ["you're both in nursing", "you're both into gym"],
      pronouns: 'she/her',
      orientation: [],
      campusShort: 'CLC',
      verified: true,
      hereNow: true,
      photoPaths: ['p0', 'p1'],
    });
  });

  it('buildProfileViewData leaves identity fields empty on a 404 (null identity)', () => {
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
    expect(data.pronouns).toBeNull();
    expect(data.orientation).toEqual([]);
    expect(data.goals).toEqual([]);
    expect(data.photoPaths).toEqual([]);
    expect(data.sharedLines).toEqual([]);
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
