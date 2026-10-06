// Edit this file to retheme the entire app.
// Every screen imports from here — no hex values live anywhere else.

export const colors = {
  // Backgrounds
  bg: '#0d0d0d',
  bgCard: '#1a1a1a',
  bgInput: '#141414',

  // Borders
  border: '#262626',

  // Text
  textPrimary: '#ffffff',
  textSecondary: '#888888',
  textMuted: '#555555',

  // Accent — lime green from the mockup.
  // accentFg is the foreground color to use ON TOP of accent backgrounds
  // (lime is bright so it needs dark text, not white).
  accent: '#c8f000',
  accentFg: '#0d0d0d',
  accentDim: '#1a2200', // very dark green tint for selected-state backgrounds

  // Semantic
  danger: '#ef4444',

  // Bottom tab bar
  tabBarBg: '#0d0d0d',
  tabBarBorder: '#1e1e1e',
  tabActive: '#c8f000',
  tabInactive: '#4a4a4a',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 9999,
} as const;
