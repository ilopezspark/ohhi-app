import {
  buildProfileViewData,
  classOf,
  isSparse,
  majorAndYear,
  metaParts,
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
        'you both tagged gym',
        'you both tagged coffee',
      ]);
    });

    it('is empty when nothing is shared, which hides the card', () => {
      expect(sharedTagLines(['gym'], ['coffee'])).toEqual([]);
      expect(sharedTagLines([], ['coffee'])).toEqual([]);
    });

    it('ignores case and duplicates', () => {
      expect(sharedTagLines(['GYM'], ['gym', 'Gym'])).toEqual(['you both tagged gym']);
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
    expect(metaParts({ tier: 'nearby', majorLabel: 'business', gradYear: 2029 })).toEqual({ tierWord: 'nearby', rest: "business '29" });
    expect(metaParts({ tier: 'away', majorLabel: null, gradYear: 2029 })).toEqual({ tierWord: '', rest: "'29" });
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
      sharedLines: ['you both tagged nursing', 'you both tagged gym'],
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
  });
});
