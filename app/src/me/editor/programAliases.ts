/**
 * Search aliases for the major/minor picker (`ProgramPickerSheet.tsx`), keyed
 * by program label as `public.programs` stores it (compared after the same
 * normalising the search uses, so case and punctuation do not matter).
 *
 * DATA, not app copy: these are other ways people write a program's name
 * (`computer science` for the catalog's `cs`), never shown on screen. Like
 * the program labels themselves they are the catalog's words, so this file
 * is deliberately left out of `__tests__/voice-rules.test.ts` (the sweep of
 * `me/` filters it out by name, with a note saying why).
 *
 * Keyed by label, so it keeps working as the catalog grows: a label with no
 * entry here just matches on its own text, and an entry whose label is not in
 * the catalog (yet, or any more) is never used. Add a line when a short or
 * abbreviated label joins the list.
 */
export const PROGRAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // The 9 labels migration 0018 seeded at CLC (0019 keeps them as they are,
  // so `cs` and `bio` stay short).
  cs: ['computer science', 'computers', 'computing', 'programming', 'coding', 'software'],
  bio: ['biology', 'biological sciences', 'life science'],
  art: ['fine art', 'studio art', 'arts'],
  business: ['business administration', 'bus admin', 'management'],
  'criminal justice': ['cj', 'criminology', 'law enforcement', 'police'],
  'early childhood education': ['ece', 'childcare', 'child care', 'preschool'],
  education: ['teaching', 'teacher'],
  nursing: ['rn', 'lpn', 'nurse'],
  welding: ['welder', 'fabrication'],

  // Labels migration 0019 adds (the 50-program default list) that people often
  // write another way.
  radiography: ['radiology', 'x-ray', 'rad tech', 'radiologic technology'],
  'fire science': ['firefighting', 'firefighter', 'fire technology'],
  cybersecurity: ['security', 'infosec', 'information security'],
  hospitality: ['hotel', 'tourism', 'hospitality management'],
  paralegal: ['legal', 'law', 'legal studies'],
  'health sciences': ['health', 'allied health', 'pre-health'],
  theater: ['theatre', 'drama', 'acting'],
  'electrical technology': ['electrician', 'electrical'],
  'construction management': ['construction'],
  nutrition: ['dietetics', 'dietitian'],
  'environmental science': ['environmental studies', 'ecology'],
  finance: ['banking'],
  architecture: ['architect'],

  // Abbreviations and their long forms that a larger catalog is likely to use.
  'computer science': ['cs', 'programming', 'coding', 'software'],
  biology: ['bio'],
  it: ['information technology', 'tech support', 'networking'],
  'information technology': ['it', 'networking'],
  cis: ['computer information systems', 'information systems'],
  'computer information systems': ['cis', 'information systems'],
  psych: ['psychology'],
  psychology: ['psych'],
  econ: ['economics'],
  economics: ['econ'],
  math: ['mathematics', 'maths'],
  mathematics: ['math', 'maths'],
  chem: ['chemistry'],
  chemistry: ['chem'],
  'poli sci': ['political science', 'politics', 'government'],
  'political science': ['poli sci', 'polisci', 'politics', 'government'],
  comm: ['communications', 'communication'],
  communications: ['comm', 'comms'],
  'communication studies': ['comm', 'comms', 'communications'],
  engineering: ['eng', 'engineer'],
  accounting: ['acct', 'accountant'],
  'business administration': ['business', 'bus admin', 'mba'],
  hvac: ['heating', 'air conditioning', 'refrigeration', 'hvacr'],
  ems: ['emergency medical services', 'emt', 'paramedic'],
  emt: ['emergency medical technician', 'ems', 'paramedic'],
  paramedic: ['emt', 'ems'],
  cna: ['certified nursing assistant', 'nursing assistant'],
  lpn: ['licensed practical nurse', 'practical nursing'],
  'pre-med': ['premed', 'medicine', 'pre medical'],
  'pre-law': ['prelaw', 'law'],
  'pre-nursing': ['prenursing', 'nursing'],
  kinesiology: ['kin', 'exercise science', 'physical education', 'pe'],
  'exercise science': ['kinesiology', 'physical education', 'pe'],
  'physical education': ['pe', 'phys ed', 'kinesiology'],
  english: ['literature', 'writing'],
  'general studies': ['liberal arts', 'undeclared', 'undecided'],
  'liberal arts': ['general studies', 'undeclared'],
  undecided: ['undeclared', 'exploratory', 'not sure'],
  'automotive technology': ['auto', 'automotive', 'mechanic'],
  'culinary arts': ['culinary', 'cooking', 'chef'],
  cosmetology: ['hair', 'beauty', 'esthetics'],
  'graphic design': ['design', 'graphics'],
  'dental hygiene': ['dental', 'hygienist'],
  'radiologic technology': ['radiology', 'x-ray', 'rad tech'],
  'respiratory therapy': ['respiratory', 'rt'],
  'medical assisting': ['medical assistant', 'ma'],
  'social work': ['social worker', 'msw', 'bsw'],
  agriculture: ['ag', 'farming'],
  'sign language': ['asl', 'american sign language'],
  asl: ['american sign language', 'sign language'],
  esl: ['english as a second language'],
};
