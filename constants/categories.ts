export const WORKOUT_CATEGORIES = [
  'Gym/Strength',
  'Hyrox',
  'Running',
  'HIIT',
  'Yoga/Mobility',
  'Other',
] as const;

export type WorkoutCategory = typeof WORKOUT_CATEGORIES[number];

// A workout belongs to exactly one of: a fixed category OR a custom folder.
// Selecting a custom folder stores folder_id on the workout and category='Other'.
export type Placement =
  | { kind: 'category'; value: WorkoutCategory }
  | { kind: 'folder'; id: string; name: string };

export function guessCategory(exercises: Array<{ name: string }>): WorkoutCategory {
  const text = exercises.map(e => e.name.toLowerCase()).join(' ');
  if (/ski erg|sled push|sled pull|sandbag|wall ball|burpee broad jump|farmer carry/.test(text)) return 'Hyrox';
  if (/\brun\b|\bsprint\b|\bjog\b|\bmile\b|tempo|fartlek/.test(text)) return 'Running';
  if (/burpee|box jump|mountain climber|tabata|jump squat|high.?knees/.test(text)) return 'HIIT';
  if (/yoga|stretch|mobility|foam roll|downward dog|warrior|pigeon/.test(text)) return 'Yoga/Mobility';
  return 'Gym/Strength';
}
