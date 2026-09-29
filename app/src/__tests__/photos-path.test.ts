import {
  isReadableProfilePhotoPath,
  newPhotoId,
  profilePhotoPath,
  profilePhotoPathForId,
  PROFILE_PHOTO_FOLDER_RE,
  PROFILE_PHOTO_FILE_RE,
  PROFILE_PHOTO_READ_FILE_RE,
} from '../photos/path';

// Copied verbatim from the migration (see path.ts's own doc comment for
// exact line references) so a test can assert conformance against the same
// regex the storage policy actually evaluates, not a paraphrase of it.
const MIGRATION_FOLDER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIGRATION_FILE_RE = /^[0-2]\.jpg$/;
// Migration 0011's widened read policy, verbatim from the coordinator's
// contract: `^{uuid}/({uuid}|[0-2])\.jpg$`.
const MIGRATION_READ_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-2])\.jpg$/;

const USER_ID = 'b6b6b6b6-1111-4b11-8b11-111111111111';
const PHOTO_ID = 'c7c7c7c7-2222-4c22-8c22-222222222222';

describe('profilePhotoPath (legacy, read-only after migration 0011)', () => {
  it("path.ts's regexes match the migration's byte for byte", () => {
    expect(PROFILE_PHOTO_FOLDER_RE.source).toBe(MIGRATION_FOLDER_RE.source);
    expect(PROFILE_PHOTO_FILE_RE.source).toBe(MIGRATION_FILE_RE.source);
  });

  it.each([0, 1, 2] as const)('builds a path for position %d that the migration regex accepts', (position) => {
    const path = profilePhotoPath(USER_ID, position);
    const [folder, file] = path.split('/');

    expect(MIGRATION_FOLDER_RE.test(folder)).toBe(true);
    expect(MIGRATION_FILE_RE.test(file)).toBe(true);
    expect(path).toBe(`${USER_ID}/${position}.jpg`);
  });

  it('rejects a userId that is not a uuid (would fail the read policy)', () => {
    expect(() => profilePhotoPath('not-a-uuid', 0)).toThrow();
  });

  it('rejects an extension other than jpg (would fail the read policy)', () => {
    expect(() => profilePhotoPath(USER_ID, 0, 'png')).toThrow();
  });
});

describe('newPhotoId', () => {
  it('returns a lowercase v4-shaped uuid', () => {
    const id = newPhotoId();
    expect(PROFILE_PHOTO_FOLDER_RE.test(id)).toBe(true);
    expect(id).toBe(id.toLowerCase());
  });

  it('is different on every call (no fixed fallback value)', () => {
    const ids = new Set(Array.from({ length: 20 }, () => newPhotoId()));
    expect(ids.size).toBe(20);
  });

  it('uses crypto.randomUUID when available', () => {
    const randomUUID = jest.fn().mockReturnValue('11111111-1111-4111-8111-111111111111');
    const previous = (globalThis as { crypto?: unknown }).crypto;
    (globalThis as { crypto?: unknown }).crypto = { randomUUID };

    expect(newPhotoId()).toBe('11111111-1111-4111-8111-111111111111');
    expect(randomUUID).toHaveBeenCalled();

    (globalThis as { crypto?: unknown }).crypto = previous;
  });
});

describe('profilePhotoPathForId (migration 0011 write path)', () => {
  it('builds {userId}/{photoId}.jpg for two uuids', () => {
    expect(profilePhotoPathForId(USER_ID, PHOTO_ID)).toBe(`${USER_ID}/${PHOTO_ID}.jpg`);
  });

  it('the built path satisfies the migration read policy', () => {
    const path = profilePhotoPathForId(USER_ID, PHOTO_ID);
    const [folder, file] = path.split('/');
    expect(MIGRATION_FOLDER_RE.test(folder)).toBe(true);
    expect(MIGRATION_READ_FILE_RE.test(file)).toBe(true);
  });

  it('rejects a non-uuid userId', () => {
    expect(() => profilePhotoPathForId('not-a-uuid', PHOTO_ID)).toThrow();
  });

  it('rejects a non-uuid photoId', () => {
    expect(() => profilePhotoPathForId(USER_ID, 'not-a-uuid')).toThrow();
  });
});

describe('isReadableProfilePhotoPath / PROFILE_PHOTO_READ_FILE_RE', () => {
  it('matches the migration-0011 combined read regex byte for byte', () => {
    expect(PROFILE_PHOTO_READ_FILE_RE.source).toBe(MIGRATION_READ_FILE_RE.source);
  });

  it('accepts an existing legacy position-based path', () => {
    expect(isReadableProfilePhotoPath(`${USER_ID}/0.jpg`)).toBe(true);
  });

  it('accepts a new uuid-based path', () => {
    expect(isReadableProfilePhotoPath(`${USER_ID}/${PHOTO_ID}.jpg`)).toBe(true);
  });

  it('rejects a path with neither shape', () => {
    expect(isReadableProfilePhotoPath(`${USER_ID}/3.jpg`)).toBe(false);
    expect(isReadableProfilePhotoPath(`${USER_ID}/not-a-uuid.jpg`)).toBe(false);
  });

  it('rejects a non-uuid folder', () => {
    expect(isReadableProfilePhotoPath(`not-a-uuid/0.jpg`)).toBe(false);
  });
});
