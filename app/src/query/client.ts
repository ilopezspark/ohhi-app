import { QueryClient } from '@tanstack/react-query';

/**
 * The app's one `QueryClient`, shared so code outside a component (an api
 * wrapper that knows which lists it makes stale, e.g. `sendHi` and the sent
 * hi's list) can invalidate caches without every call site repeating it.
 * `app/_layout.tsx` hands this same instance to `QueryClientProvider`.
 */
export const queryClient = new QueryClient();
