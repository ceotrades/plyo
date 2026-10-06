import { supabase } from '../services/supabase';

export type WorkoutStats = {
  actionRatio: number | null; // 0–100, null when no workouts are saved
  streak: number;             // consecutive days with ≥1 completion
};

// Convert a Date to a local YYYY-MM-DD string (avoids UTC midnight shift).
function localDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Count consecutive days with at least one completion, counting backward.
// If today has no completion, yesterday is used as the anchor so the streak
// doesn't reset to 0 mid-day before the user has trained.
function calculateStreak(completedDays: Set<string>): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayStr = localDateStr(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = localDateStr(yesterday);

  let cursor: Date;
  if (completedDays.has(todayStr)) {
    cursor = new Date(today);
  } else if (completedDays.has(yesterdayStr)) {
    cursor = new Date(yesterday);
  } else {
    return 0;
  }

  let streak = 0;
  while (completedDays.has(localDateStr(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * Fetch Action Ratio (30-day rolling) and current streak for a user.
 *
 * @param userId            The authenticated user's ID.
 * @param totalSavedWorkouts Total count of workouts in the user's library.
 *                           Pass 0 to receive actionRatio = null.
 *
 * Date-range extension: to scope actionRatio to a custom window, replace
 * the `thirtyDaysAgo` filter with your desired start/end dates. The streak
 * query already fetches the full history needed; no change required there.
 */
export async function fetchWorkoutStats(
  userId: string,
  totalSavedWorkouts: number,
): Promise<WorkoutStats> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // 2-year lookback covers any realistic streak; keeps the query bounded.
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  const [ratioRes, streakRes] = await Promise.all([
    supabase
      .from('workout_completions')
      .select('workout_id')
      .eq('user_id', userId)
      .not('ended_at', 'is', null)
      .gte('ended_at', thirtyDaysAgo.toISOString()),
    supabase
      .from('workout_completions')
      .select('ended_at')
      .eq('user_id', userId)
      .not('ended_at', 'is', null)
      .gte('ended_at', twoYearsAgo.toISOString()),
  ]);

  // Action Ratio: distinct workouts with a completion in the last 30 days.
  const completedIds = new Set(
    (ratioRes.data ?? []).map((r: { workout_id: string }) => r.workout_id),
  );
  const actionRatio =
    totalSavedWorkouts === 0
      ? null
      : Math.round((completedIds.size / totalSavedWorkouts) * 100);

  // Streak: consecutive days with at least one completed session.
  const completedDays = new Set(
    (streakRes.data ?? []).map((r: { ended_at: string }) =>
      localDateStr(new Date(r.ended_at)),
    ),
  );
  const streak = calculateStreak(completedDays);

  return { actionRatio, streak };
}
