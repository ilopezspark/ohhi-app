import { render } from '@testing-library/react-native';

const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: (props: { href: unknown }) => {
    mockRedirect(props);
    return null;
  },
}));

import ProfileEditRedirect from '../app/settings/profile-edit';

/**
 * `/settings/profile-edit` is retired (`docs/design/me-redesign/brief.md`,
 * ruling 11) — this used to be the full pre-redesign photo/tags/status
 * editor screen (see git history for that suite's old coverage), now just a
 * redirect to `/profile-editor`, the modal Edit/Preview profile editor built
 * under `app/profile-editor/**`. `Redirect` itself is mocked (rather than
 * rendered for real, which needs a live navigation container this unit test
 * has no business standing up) so this only asserts the one thing that
 * matters: which route it points at.
 */
describe('ProfileEditRedirect (/settings/profile-edit)', () => {
  it('redirects to /profile-editor', async () => {
    await render(<ProfileEditRedirect />);
    expect(mockRedirect).toHaveBeenCalledWith({ href: '/profile-editor' });
  });
});
