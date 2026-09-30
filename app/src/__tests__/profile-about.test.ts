import {
  aboutPatch,
  aboutRows,
  aboutSummary,
  EMPTY_ABOUT,
  enumLabel,
  graduatingLine,
  graduatingYearOptions,
  parseAbout,
  toggleWorkHours,
  WORK_HOURS,
  WORK_TYPES,
  workLine,
  type AboutSection,
} from '../profile/about';

const FULL: AboutSection = {
  major: { id: 'p-nursing', label: 'nursing' },
  minor: { id: 'p-welding', label: 'welding' },
  graduatingTerm: 'spring',
  graduatingYear: 2028,
  graduatingUnsure: false,
  workType: 'food_service',
  jobTitle: 'barista at a place downtown',
  workHours: ['part_time', 'weekends'],
};

describe('about: the options are the server enums', () => {
  it('has the brief 21 work types and 6 hours, displayed with _ read as a space', () => {
    expect(WORK_TYPES).toHaveLength(21);
    expect(WORK_HOURS).toEqual(['part_time', 'full_time', 'nights', 'weekends', 'seasonal', 'on_call']);
    expect(enumLabel('office_or_admin')).toBe('office or admin');
    expect(enumLabel('not_working_right_now')).toBe('not working right now');
  });
});

describe('parseAbout', () => {
  it('reads the contract shape', () => {
    expect(
      parseAbout({
        major: { id: 'p-nursing', label: 'nursing' },
        minor: { id: 'p-welding', label: 'welding' },
        graduating_term: 'spring',
        graduating_year: 2028,
        graduating_unsure: false,
        work_type: 'food_service',
        job_title: 'barista at a place downtown',
        work_hours: ['weekends', 'part_time'],
      })
    ).toEqual(FULL);
  });

  it('reads null, junk and unknown values as not set, never throwing', () => {
    expect(parseAbout(null)).toEqual(EMPTY_ABOUT);
    expect(parseAbout('x')).toEqual(EMPTY_ABOUT);
    expect(parseAbout({ major: { id: 1 }, graduating_term: 'monsoon', graduating_year: 2028, work_type: 'astronaut', work_hours: ['all_day'], job_title: '  ' })).toEqual({
      ...EMPTY_ABOUT,
      graduatingYear: 2028,
    });
  });

  it('drops a term with no year', () => {
    expect(parseAbout({ graduating_term: 'fall', graduating_year: null }).graduatingTerm).toBeNull();
  });
});

describe('display (brief, as ruled)', () => {
  it('graduating: term + year, year alone, not sure yet, or nothing', () => {
    expect(graduatingLine(FULL)).toBe('graduating spring 2028');
    expect(graduatingLine({ ...FULL, graduatingTerm: null })).toBe('graduating 2028');
    expect(graduatingLine({ ...EMPTY_ABOUT, graduatingUnsure: true })).toBe('not sure yet');
    expect(graduatingLine(EMPTY_ABOUT)).toBeNull();
  });

  it('work: type · title; rather not say is never shown as a value', () => {
    expect(workLine(FULL)).toBe('food service · barista at a place downtown');
    expect(workLine({ workType: 'rather_not_say', jobTitle: 'tutor' })).toBe('tutor');
    expect(workLine({ workType: 'rather_not_say', jobTitle: null })).toBeNull();
    expect(workLine({ workType: 'retail', jobTitle: null })).toBe('retail');
  });

  it('rows in order with sub-lines, skipping empty ones and never a placeholder', () => {
    expect(aboutRows(FULL)).toEqual([
      { key: 'major', primary: 'nursing', secondary: 'minor in welding' },
      { key: 'graduating', primary: 'graduating spring 2028', secondary: null },
      { key: 'work', primary: 'food service · barista at a place downtown', secondary: 'part time · weekends' },
    ]);
    expect(aboutRows({ ...EMPTY_ABOUT, graduatingUnsure: true })).toEqual([{ key: 'graduating', primary: 'not sure yet', secondary: null }]);
    expect(aboutRows(EMPTY_ABOUT)).toEqual([]);
    expect(aboutRows(null)).toEqual([]);
  });

  it('the editor summary', () => {
    expect(aboutSummary({ ...EMPTY_ABOUT, major: { id: 'b', label: 'business' }, graduatingTerm: 'spring', graduatingYear: 2028, workType: 'retail' })).toBe(
      'business · graduating spring 2028 · retail'
    );
    expect(aboutSummary(EMPTY_ABOUT)).toBeNull();
  });
});

describe('graduatingYearOptions', () => {
  it('offers this year .. +8, keeping a stored year outside the range', () => {
    const now = new Date('2026-09-30T12:00:00');
    expect(graduatingYearOptions(now)).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034]);
    expect(graduatingYearOptions(now, 2025)[0]).toBe(2025);
    expect(graduatingYearOptions(now, 2030)).toHaveLength(9);
  });
});

describe('aboutPatch (set_my_about is a patch)', () => {
  it('is empty when nothing changed', () => {
    expect(aboutPatch(FULL, { ...FULL })).toEqual({});
  });

  it('sends only changed keys; a blank title clears it; hours in the fixed order', () => {
    expect(aboutPatch(FULL, { ...FULL, jobTitle: '  ', workHours: ['weekends', 'nights'] })).toEqual({
      job_title: null,
      work_hours: ['nights', 'weekends'],
    });
    expect(aboutPatch(FULL, { ...FULL, major: { id: 'p-cs', label: 'cs' }, minor: null })).toEqual({ major_id: 'p-cs', minor_id: null });
  });

  it('not sure yet goes alone (the server clears term and year)', () => {
    expect(aboutPatch(FULL, { ...FULL, graduatingUnsure: true, graduatingYear: null, graduatingTerm: null })).toEqual({ graduating_unsure: true });
  });

  it('a year or term change sends the group with graduating_unsure false', () => {
    expect(aboutPatch({ ...EMPTY_ABOUT, graduatingUnsure: true }, { ...EMPTY_ABOUT, graduatingYear: 2029, graduatingTerm: 'fall' })).toEqual({
      graduating_unsure: false,
      graduating_year: 2029,
      graduating_term: 'fall',
    });
  });
});

describe('toggleWorkHours', () => {
  it('caps at 3 and keeps part time and full time exclusive', () => {
    expect(toggleWorkHours([], 'weekends')).toEqual(['weekends']);
    expect(toggleWorkHours(['part_time'], 'full_time')).toEqual(['full_time']);
    expect(toggleWorkHours(['full_time', 'nights'], 'part_time')).toEqual(['part_time', 'nights']);
    expect(toggleWorkHours(['part_time', 'nights', 'weekends'], 'seasonal')).toEqual(['part_time', 'nights', 'weekends']);
    expect(toggleWorkHours(['part_time', 'nights', 'weekends'], 'full_time')).toEqual(['full_time', 'nights', 'weekends']);
    expect(toggleWorkHours(['nights'], 'nights')).toEqual([]);
  });
});
