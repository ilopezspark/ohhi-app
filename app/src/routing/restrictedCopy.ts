import type { RestrictedStatus } from './stateToRoute';

/**
 * The restricted screen's copy (`app/restricted.tsx`). `closed_age` is the
 * age gate's (decision 97, `docs/age-gate-contract.md`), verbatim; the other
 * three are still the skeleton's placeholders (needs brief).
 */
export const RESTRICTED_COPY: Record<RestrictedStatus, { title: string; body: string }> = {
  closed_age: {
    title: 'ohhi is for people 18 and over',
    body: "this account can't be used. if you think this is a mistake, contact support.",
  },
  suspended: {
    title: 'Your account is suspended',
    body: 'Contact support if you think this is a mistake.',
  },
  banned: {
    title: 'Your account is banned',
    body: 'This decision is final and cannot be appealed in-app.',
  },
  deleted: {
    title: 'Account unavailable',
    body: 'Something went wrong loading your account. Please reopen the app.',
  },
};
