import { profilePhotoPath, PROFILE_PHOTO_FOLDER_RE, PROFILE_PHOTO_FILE_RE } from '../photos/path';

// Copied verbatim from supabase/migrations/20260918000002_core_schema.sql,
// the "profile-photos read when ok and readable" storage.objects policy
// (~L2839-2840: `(storage.foldername(name))[1] ~ '...'` /
// `split_part(name, '/', 2) ~ '^[0-2]\.jpg$'`). This test asserts conformance
// against the same regex the storage policy actually evaluates, not a
// paraphrase of it — and that `src/photos/path.ts`'s own copy hasn't drifted.
const MIGRATION_FOLDER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIGRATION_FILE_RE = /^[0-2]\.jpg$/;

const USER_ID = 'b6b6b6b6-1111-4b11-8b11-111111111111';

describe('profilePhotoPath', () => {
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
