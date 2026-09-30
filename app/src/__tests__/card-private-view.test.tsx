import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../api/identity', () => ({ revealCardSection: jest.fn() }));

import { revealCardSection } from '../api/identity';
import { PrivateCardView } from '../me/card/PrivateCardView';
import { CARD_GROUP_LABELS, CARD_SECTION_LABELS } from '../me/card/fieldLabels';
import { ShareBubble } from '../chat/ShareBubble';
import type { ShareFeedItem } from '../chat/shareFeed';
import type { CardPayload, GatedSection } from '../profile/fields';
import { colors } from '../theme/tokens';

const OWNER = 'owner-1';
/** What `chat/PrivateCardSheet.tsx` passes: the reveal call bound to the owner. */
const reveal = (section: GatedSection) => revealCardSection(OWNER, section);

const FULL: CardPayload = {
  shows_interest: ['food', 'making time'],
  pace: 'slow',
  living_situation: 'with roommates',
  hosting: null,
  safer_sex: ['condoms'],
  dynamics: ['switch'],
  practices: ['rope', 'impact'],
  hard_nos: ['no pics unasked', 'no substances'],
  privacy: ["don't post about us"],
};

/** What a recipient gets: standard + boundaries, never a gated section's content. */
const RECIPIENT: Partial<CardPayload> = {
  shows_interest: ['food'],
  pace: 'slow',
  living_situation: null,
  hosting: 'i can host',
  hard_nos: ['no calls'],
  privacy: ['keep this between us'],
};

function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

beforeEach(() => jest.clearAllMocks());

describe('PrivateCardView (payload v2)', () => {
  it('titles the card "more about <name>" with the lock tile and a "private" label', async () => {
    const { findByTestId, getByText } = await render(<PrivateCardView name="izaac" sections={FULL} />);
    expect(await findByTestId('private-card-view-lock')).toBeTruthy();
    expect(getByText('more about izaac')).toBeTruthy();
    expect(getByText('private')).toBeTruthy();
  });

  it('renders the groups in order (getting closer, intimacy, boundaries) with their labels', async () => {
    const { getAllByTestId, getByText } = await render(<PrivateCardView name="izaac" sections={FULL} testID="card" />);
    const groups = getAllByTestId(/^card-group-[a-z_]+$/).map((node) => node.props.testID);
    expect(groups).toEqual(['card-group-standard', 'card-group-gated', 'card-group-always_attached']);
    for (const group of ['standard', 'gated', 'always_attached'] as const) expect(getByText(CARD_GROUP_LABELS[group])).toBeTruthy();
  });

  it('renders sections in group order with hard nos then privacy last, skipping empty ones', async () => {
    const { getAllByTestId, queryByTestId } = await render(<PrivateCardView name="izaac" sections={FULL} testID="card" />);
    const sections = getAllByTestId(/^card-section-[a-z_]+$/).map((node) => node.props.testID.replace('card-section-', ''));
    expect(sections).toEqual([
      'shows_interest',
      'pace',
      'living_situation',
      'safer_sex',
      'dynamics',
      'practices',
      'hard_nos',
      'privacy',
    ]);
    expect(queryByTestId('card-section-hosting')).toBeNull();
  });

  it('renders a single-value section as one chip', async () => {
    const { findByTestId, getAllByTestId } = await render(<PrivateCardView name="izaac" sections={FULL} testID="card" />);
    await findByTestId('card-section-pace-slow');
    expect(getAllByTestId(/^card-section-pace-/)).toHaveLength(1);
  });

  it('shows list values in the picker order, whatever order they were stored in', async () => {
    const { getAllByTestId } = await render(<PrivateCardView name="izaac" sections={FULL} testID="card" />);
    const chips = getAllByTestId(/^card-section-practices-/).map((node) => node.props.testID);
    // impact (sensation) comes before rope (restraint) in the picker.
    expect(chips).toEqual(['card-section-practices-impact', 'card-section-practices-rope']);
  });

  it('draws the boundaries in the boundary colours: a warm border, boundary-ink labels and boundary chips', async () => {
    const { findByTestId, getByText } = await render(<PrivateCardView name="izaac" sections={FULL} testID="card" />);
    const boundaries = await findByTestId('card-group-always_attached');
    expect(flatStyle(boundaries).borderColor).toBe(colors.boundaryInk);
    expect(flatStyle(await findByTestId('card-group-standard')).borderColor).toBeUndefined();

    expect(flatStyle(getByText(CARD_SECTION_LABELS.hard_nos)).color).toBe(colors.boundaryInk);
    expect(flatStyle(getByText(CARD_SECTION_LABELS.privacy)).color).toBe(colors.boundaryInk);
    expect(flatStyle(getByText(CARD_SECTION_LABELS.pace)).color).not.toBe(colors.boundaryInk);

    const hardNoChip = await findByTestId('card-section-hard_nos-no pics unasked');
    const privacyChip = await findByTestId("card-section-privacy-don't post about us");
    const paceChip = await findByTestId('card-section-pace-slow');
    expect(flatStyle(hardNoChip).backgroundColor).toBe(colors.boundaryBg);
    expect(flatStyle(privacyChip).backgroundColor).toBe(colors.boundaryBg);
    expect(flatStyle(paceChip).backgroundColor).not.toBe(colors.boundaryBg);
  });

  it('owner preview: shows a caption under each group when asked', async () => {
    const { findByTestId } = await render(<PrivateCardView name="izaac" sections={FULL} showGroupCaptions testID="card" />);
    await findByTestId('card-caption-standard');
    await findByTestId('card-caption-gated');
    await findByTestId('card-caption-always_attached');
  });

  it('shows no captions otherwise (the recipient never sees them)', async () => {
    const { findByTestId, queryByTestId } = await render(<PrivateCardView name="izaac" sections={FULL} testID="card" />);
    await findByTestId('card-group-standard');
    expect(queryByTestId('card-caption-standard')).toBeNull();
  });

  it('renders a compact, header-only card (no groups) when sections is omitted', async () => {
    const { findByTestId, queryByTestId } = await render(<PrivateCardView name="izaac" testID="card" />);
    await findByTestId('card-title');
    expect(queryByTestId('card-group-standard')).toBeNull();
    expect(queryByTestId('card-group-always_attached')).toBeNull();
  });

  describe('recipient: gated covers', () => {
    it('renders one neutral cover per gated name, with no values and no hint of what is inside', async () => {
      const { findByTestId, queryByTestId, getByText, queryByText } = await render(
        <PrivateCardView name="maya" sections={RECIPIENT} gated={['safer_sex', 'practices']} revealSection={reveal} testID="card" />
      );
      await findByTestId('card-cover-safer_sex');
      await findByTestId('card-cover-practices');
      expect(queryByTestId('card-cover-dynamics')).toBeNull();
      expect(getByText(CARD_SECTION_LABELS.safer_sex)).toBeTruthy();
      expect((await findByTestId('card-cover-safer_sex-hint')).props.children).toBe('tap to see');
      // Nothing about content: no chips, no count.
      expect(queryByTestId(/^card-section-safer_sex/)).toBeNull();
      expect(queryByText(/\d/)).toBeNull();
      expect(revealCardSection).not.toHaveBeenCalled();
    });

    it('covers sit in the intimacy group, between getting closer and the boundaries', async () => {
      const { getAllByTestId } = await render(
        <PrivateCardView name="maya" sections={RECIPIENT} gated={['dynamics']} revealSection={reveal} testID="card" />
      );
      const groups = getAllByTestId(/^card-group-[a-z_]+$/).map((node) => node.props.testID);
      expect(groups).toEqual(['card-group-standard', 'card-group-gated', 'card-group-always_attached']);
    });

    it('a tap reveals that section only: it fetches it and swaps in the values', async () => {
      (revealCardSection as jest.Mock).mockResolvedValue(['rope', 'impact']);
      const { findByTestId, queryByTestId } = await render(
        <PrivateCardView name="maya" sections={RECIPIENT} gated={['safer_sex', 'practices']} revealSection={reveal} testID="card" />
      );
      await fireEvent.press(await findByTestId('card-cover-practices'));

      await findByTestId('card-section-practices-rope');
      await findByTestId('card-section-practices-impact');
      expect(revealCardSection).toHaveBeenCalledTimes(1);
      expect(revealCardSection).toHaveBeenCalledWith(OWNER, 'practices');
      expect(queryByTestId('card-cover-practices')).toBeNull();
      // The other cover stays closed.
      await findByTestId('card-cover-safer_sex');
    });

    it('a reveal that comes back empty (404) tells the caller, and shows nothing', async () => {
      (revealCardSection as jest.Mock).mockResolvedValue(null);
      const onRevealGone = jest.fn();
      const { findByTestId, queryByTestId } = await render(
        <PrivateCardView name="maya" sections={RECIPIENT} gated={['dynamics']} revealSection={reveal} onRevealGone={onRevealGone} testID="card" />
      );
      await fireEvent.press(await findByTestId('card-cover-dynamics'));
      await waitFor(() => expect(onRevealGone).toHaveBeenCalledTimes(1));
      expect(queryByTestId(/^card-section-dynamics/)).toBeNull();
    });

    it('a failed reveal keeps the cover and offers a retry', async () => {
      (revealCardSection as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(['switch']);
      const { findByTestId } = await render(
        <PrivateCardView name="maya" sections={RECIPIENT} gated={['dynamics']} revealSection={reveal} testID="card" />
      );
      await fireEvent.press(await findByTestId('card-cover-dynamics'));
      await waitFor(async () =>
        expect((await findByTestId('card-cover-dynamics-hint')).props.children).toMatch(/try again/)
      );
      await fireEvent.press(await findByTestId('card-cover-dynamics'));
      await findByTestId('card-section-dynamics-switch');
    });

    it('a revealed section stops showing once it drops out of `gated` (the share changed)', async () => {
      (revealCardSection as jest.Mock).mockResolvedValue(['condoms']);
      const view = await render(
        <PrivateCardView name="maya" sections={RECIPIENT} gated={['safer_sex']} revealSection={reveal} testID="card" />
      );
      await fireEvent.press(await view.findByTestId('card-cover-safer_sex'));
      await view.findByTestId('card-section-safer_sex-condoms');

      await view.rerender(<PrivateCardView name="maya" sections={RECIPIENT} gated={[]} revealSection={reveal} testID="card" />);
      expect(view.queryByTestId('card-section-safer_sex-condoms')).toBeNull();
      expect(view.queryByTestId('card-cover-safer_sex')).toBeNull();
    });

    it('ignores gated content that was passed in sections (the recipient path never shows it without a tap)', async () => {
      const { findByTestId, queryByTestId } = await render(
        <PrivateCardView
          name="maya"
          sections={{ ...RECIPIENT, safer_sex: ['condoms'] }}
          gated={['safer_sex']}
          revealSection={reveal}
          testID="card"
        />
      );
      await findByTestId('card-cover-safer_sex');
      expect(queryByTestId('card-section-safer_sex-condoms')).toBeNull();
    });
  });

  it('never renders pronouns or orientation (they are public-profile fields now)', async () => {
    const { queryByText } = await render(<PrivateCardView name="izaac" sections={FULL} />);
    expect(queryByText('pronouns')).toBeNull();
    expect(queryByText('orientation')).toBeNull();
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

  it('renders the shared PrivateCardView component, header only, for an incoming card', async () => {
    const { findByTestId, getByText, queryByTestId } = await render(
      <ShareBubble item={shareItem()} mine={false} otherName="maya" onPress={jest.fn()} />
    );
    await findByTestId(`share-bubble-${shareItem().id}-card`);
    await findByTestId(`share-bubble-${shareItem().id}-card-lock`);
    expect(getByText('more about maya')).toBeTruthy();
    expect(queryByTestId(/-card-group-/)).toBeNull();
  });

  it('titles the sender\'s own outgoing bubble "more about you", the same component, mine=true', async () => {
    const { findByTestId, getByText } = await render(
      <ShareBubble item={shareItem({ ownerId: 'me', viewerId: 'them' })} mine otherName="maya" onPress={jest.fn()} />
    );
    await findByTestId(`share-bubble-${shareItem().id}-card`);
    expect(getByText('more about you')).toBeTruthy();
  });
});
