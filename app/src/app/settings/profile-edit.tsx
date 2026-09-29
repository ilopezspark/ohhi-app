import { Redirect } from 'expo-router';

/**
 * `/settings/profile-edit` is retired (`docs/design/me-redesign/brief.md`,
 * ruling 11: "the old `/settings/menu`, `/settings/profile-edit`,
 * `/settings/identity`, `/settings/card` routes are replaced; keep
 * redirects so existing links do not break"). The profile editor it used to
 * render is now `/profile-editor` — a modal, Edit/Preview tab switch, built
 * under `app/profile-editor/**`. Nothing else in the app still links here
 * (`(tabs)/settings.tsx`'s old "edit photos & tags" chip was this route's
 * only caller and has itself moved on to `/profile-editor`), but the route
 * file is kept, as a redirect, per the ruling's own instruction rather than
 * deleted outright.
 */
export default function ProfileEditRedirect() {
  // Cast for the same reason `(tabs)/settings.tsx`'s own `/profile-editor`
  // pushes need one: expo-router's generated route-name union
  // (`.expo/types/router.d.ts`) hasn't been regenerated since `index.tsx`
  // landed in that directory, so the bare `/profile-editor` path (as
  // opposed to `/profile-editor/about` etc., generated earlier) isn't in
  // the union yet.
  return <Redirect href={'/profile-editor' as never} />;
}
