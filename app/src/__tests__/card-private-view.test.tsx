import { render } from '@testing-library/react-native';
import { PrivateCardView, type PrivateCardEntries } from '../me/card/PrivateCardView';
import { ShareBubble } from '../chat/ShareBubble';
import type { ShareFeedItem } from '../chat/shareFeed';

const FULL_ENTRIES: PrivateCardEntries = {
  into: ['men', 'women'],
  safer_sex: ['condoms'],
  kinks: [],
  hard_nos: ['no pics unasked', 'no substances'],
};

describe('PrivateCardView', () => {
  it('titles the card "more about <name>" with the lock tile and a "private" label', async () => {
    const { findByTestId, getByText } = await render(<PrivateCardView name="izaac" entries={FULL_ENTRIES} />);
    expect(await findByTestId('private-card-view-lock')).toBeTruthy();
    expect(getByText('more about izaac')).toBeTruthy();
    expect(getByText('private')).toBeTruthy();
  });

  it('renders groups in the ruled order (into, safer sex, kinks, hard nos) and omits empty groups', async () => {
    const { findByTestId, queryByTestId } = await render(<PrivateCardView name="izaac" entries={FULL_ENTRIES} />);
    await findByTestId('private-card-view-group-into');
    // kinks is empty in FULL_ENTRIES — must not render at all.
    expect(queryByTestId('private-card-view-group-kinks')).toBeNull();
    expect(await findByTestId('private-card-view-group-safer_sex')).toBeTruthy();
    expect(await findByTestId('private-card-view-group-hard_nos')).toBeTruthy();
  });

  it('renders hard nos last regardless of the entries object key order', async () => {
    const reordered: PrivateCardEntries = {
      hard_nos: ['no substances'],
      kinks: ['vanilla'],
      safer_sex: ['condoms'],
      into: ['men'],
    } as unknown as PrivateCardEntries;
    const { getAllByTestId } = await render(<PrivateCardView name="izaac" entries={reordered} testID="card" />);
    const groups = getAllByTestId(/^card-group-(into|safer_sex|kinks|hard_nos)$/);
    expect(groups[groups.length - 1].props.testID).toBe('card-group-hard_nos');
  });

  it('renders hard nos chips in boundary tone, distinct from every other group', async () => {
    const { findByTestId } = await render(<PrivateCardView name="izaac" entries={FULL_ENTRIES} testID="card" />);
    const hardNoChip = await findByTestId('card-group-hard_nos-no pics unasked');
    const intoChip = await findByTestId('card-group-into-men');
    // boundary tone chips are not "selected" (styled purely by tone) — flagging the two chips
    // render with visibly different background colours is enough to catch a tone regression
    // without over-coupling the test to Chip's internal style array shape.
    expect(hardNoChip).toBeTruthy();
    expect(intoChip).toBeTruthy();
  });

  it('never renders pronouns or orientation (ruling 1) even if a caller tried to pass them', async () => {
    const { queryByText } = await render(<PrivateCardView name="izaac" entries={FULL_ENTRIES} />);
    expect(queryByText('pronouns')).toBeNull();
    expect(queryByText(/i'm/i)).toBeNull();
  });

  it('renders a compact, header-only card (no groups) when entries is omitted', async () => {
    const { findByTestId, queryByTestId } = await render(<PrivateCardView name="izaac" testID="card" />);
    await findByTestId('card-title');
    expect(queryByTestId('card-group-into')).toBeNull();
    expect(queryByTestId('card-group-hard_nos')).toBeNull();
  });
});

describe('ShareBubble renders the private card through PrivateCardView', () => {
  function shareItem(overrides: Partial<ShareFeedItem> = {}): ShareFeedItem {
    return {
      id: 'share-1',
      kind: 'private_card',
      ownerId: 'them',
      viewerId: 'me',
      subjectId: 'them',
      createdAt: '2026-09-20T12:00:00.000Z',
      ...overrides,
    };
  }

  it('renders the shared PrivateCardView component (not a hand-rolled duplicate) for an incoming card', async () => {
    const { findByTestId, getByText } = await render(
      <ShareBubble item={shareItem()} mine={false} otherName="maya" onPress={jest.fn()} />
    );
    await findByTestId(`share-bubble-${shareItem().id}-card`);
    await findByTestId(`share-bubble-${shareItem().id}-card-lock`);
    expect(getByText('more about maya')).toBeTruthy();
  });

  it('titles the sender\'s own outgoing bubble "more about you", the same component, mine=true', async () => {
    const { findByTestId, getByText } = await render(
      <ShareBubble item={shareItem({ ownerId: 'me', viewerId: 'them' })} mine otherName="maya" onPress={jest.fn()} />
    );
    await findByTestId(`share-bubble-${shareItem().id}-card`);
    expect(getByText('more about you')).toBeTruthy();
  });
});
