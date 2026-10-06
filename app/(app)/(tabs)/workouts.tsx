import { Redirect } from 'expo-router';

// Library content is now part of the Home tab (add.tsx).
// This file is hidden from the tab bar via href: null in (tabs)/_layout.tsx.
export default function Workouts() {
  return <Redirect href="/add" />;
}
