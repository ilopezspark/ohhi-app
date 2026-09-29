import { render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { View } = require('react-native');
    return <View testID="redirect" accessibilityLabel={href} />;
  },
}));

import MenuRedirect from '../app/settings/menu';
import NotificationsRedirect from '../app/settings/notifications';
import AccountRedirect from '../app/settings/account';

describe('old Settings routes redirect to /me/settings (ruling 11)', () => {
  it.each([
    ['/settings/menu', MenuRedirect],
    ['/settings/notifications', NotificationsRedirect],
    ['/settings/account', AccountRedirect],
  ])('%s redirects to /me/settings', async (_route, Screen) => {
    const { getByTestId } = await render(<Screen />);
    expect(getByTestId('redirect').props.accessibilityLabel).toBe('/me/settings');
  });
});
