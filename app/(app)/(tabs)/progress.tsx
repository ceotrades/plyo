import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Body, { type ExtendedBodyPart, type Slug } from 'react-native-body-highlighter';
import { fetchWorkoutStats } from '../../../utils/workoutStats';
import { supabase } from '../../../services/supabase';
import { useSession } from '../../../utils/auth';
import { colors, spacing, radius } from '../../../constants/theme';

// ── Types ─────────────────────────────────────────────────────────────────────

type StoredExercise = {
  name: string;
  completed: boolean;
};

type WorkoutCompletion = {
  id: string;
  workout_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  session_exercises: StoredExercise[] | null;
  workouts: { name: string | null } | null;
};

// ── Muscle mapping ─────────────────────────────────────────────────────────────

// Maps exercise names (by keyword) to the slug IDs recognised by react-native-body-highlighter.
// Returns an array because many exercises work multiple muscle groups.
function exerciseToSlugs(name: string): Slug[] {
  const n = name.toLowerCase();
  const s = new Set<Slug>();

  if (/bench|chest fly|pec|push.?up(?!.*down)/.test(n)) {
    s.add('chest'); s.add('triceps'); s.add('deltoids');
  }
  if (/squat|leg press|lunge/.test(n)) {
    s.add('quadriceps'); s.add('gluteal');
  }
  if (/hamstring|rdl|romanian|leg curl|nordic/.test(n)) {
    s.add('hamstring'); s.add('gluteal');
  }
  if (/\bdeadlift\b/.test(n)) {
    s.add('hamstring'); s.add('gluteal'); s.add('lower-back'); s.add('upper-back'); s.add('quadriceps');
  }
  if (/calf/.test(n)) s.add('calves');
  if (/lateral raise|front raise|shoulder press|overhead press|\bohp\b|shoulder|delt/.test(n)) {
    s.add('deltoids'); s.add('trapezius');
  }
  if (/bicep|curl(?!.*leg)|chin.?up/.test(n)) { s.add('biceps'); s.add('forearm'); }
  if (/tricep|skull|push.?down|overhead extension|close grip/.test(n)) s.add('triceps');
  if (/\brow\b|pull.?up|pull.?down|lat |face pull|shrug|cable row/.test(n)) {
    s.add('upper-back'); s.add('trapezius'); s.add('biceps');
  }
  if (/back extension|hyperextension|lower back/.test(n)) {
    s.add('lower-back'); s.add('gluteal');
  }
  if (/glute|hip thrust|sumo|abductor/.test(n)) s.add('gluteal');
  if (/\bab\b|crunch|sit.?up|hollow|l.?sit|hanging leg/.test(n)) s.add('abs');
  if (/oblique|russian twist|wood chop/.test(n)) { s.add('obliques'); s.add('abs'); }
  if (/plank/.test(n)) { s.add('abs'); s.add('lower-back'); }
  if (/adduct/.test(n)) s.add('adductors');
  if (/\brun\b|sprint|jog|treadmill/.test(n)) {
    s.add('quadriceps'); s.add('hamstring'); s.add('calves'); s.add('gluteal');
  }
  if (/burpee|box jump|kettlebell swing/.test(n)) {
    s.add('quadriceps'); s.add('gluteal'); s.add('abs'); s.add('chest'); s.add('deltoids');
  }
  if (/sled|sandbag|wall ball|ski erg|rowing|farmer carry/.test(n)) {
    s.add('quadriceps'); s.add('gluteal'); s.add('upper-back'); s.add('abs'); s.add('trapezius');
  }

  return Array.from(s);
}

// Build the data array for the Body component from all completed exercises in a session list.
// intensity 1 = 1 exercise hit that muscle, 2 = 2, 3 = 3+ (capped to match 3-color ramp).
function buildBodyData(sessions: WorkoutCompletion[]): ExtendedBodyPart[] {
  const slugCounts: Record<string, number> = {};
  for (const session of sessions) {
    const done = (session.session_exercises ?? []).filter(e => e.completed);
    for (const ex of done) {
      for (const slug of exerciseToSlugs(ex.name)) {
        slugCounts[slug] = (slugCounts[slug] ?? 0) + 1;
      }
    }
  }
  return Object.entries(slugCounts).map(([slug, count]) => ({
    slug: slug as Slug,
    intensity: Math.min(count, 3) as 1 | 2 | 3,
  }));
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDateLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 60) return seconds ? `${seconds}s` : '—';
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m} min`;
}

function getWorkoutName(c: WorkoutCompletion): string {
  return c.workouts?.name ?? 'Workout';
}

// ── Component ──────────────────────────────────────────────────────────────────

// Three-stop intensity ramp: light → medium → full accent
// Body-highlighter only accepts raw string props — these must stay as literals,
// not colors.accent references. Update when theme.ts accent changes.
// Body-highlighter only accepts raw string props — these must stay as literals,
// not colors.accent references. Update when theme.ts accent changes.
const BODY_COLORS = ['#c8f00050', '#c8f000a0', '#c8f000'] as const;

export default function ProgressScreen() {
  const { session } = useSession();
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<WorkoutCompletion[]>([]);
  const [actionRatio, setActionRatio] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      loadSessions();
    }, [session, selectedDate]),
  );

  async function loadSessions() {
    setLoading(true);
    const dayStart = new Date(selectedDate);
    const dayEnd = new Date(selectedDate);
    dayEnd.setHours(23, 59, 59, 999);

    const [sessionsRes, workoutCountRes] = await Promise.all([
      supabase
        .from('workout_completions')
        .select('id, workout_id, started_at, ended_at, duration_seconds, session_exercises, workouts(name)')
        .eq('user_id', session!.user.id)
        .gte('started_at', dayStart.toISOString())
        .lte('started_at', dayEnd.toISOString())
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false }),
      supabase
        .from('workouts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session!.user.id),
    ]);

    setSessions((sessionsRes.data ?? []) as WorkoutCompletion[]);

    const stats = await fetchWorkoutStats(session!.user.id, workoutCountRes.count ?? 0);
    setActionRatio(stats.actionRatio);
    setStreak(stats.streak);

    setLoading(false);
  }

  function confirmDelete(sessionId: string) {
    Alert.alert(
      'Delete Session',
      "Delete this completed workout? This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteSession(sessionId) },
      ],
    );
  }

  async function deleteSession(sessionId: string) {
    const { error } = await supabase
      .from('workout_completions')
      .delete()
      .eq('id', sessionId);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    // Remove from state immediately — bodyData re-derives automatically on next render.
    setSessions(prev => prev.filter(s => s.id !== sessionId));
  }

  function goBack() {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    setSessions([]);
    setSelectedDate(prev);
  }

  function goForward() {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    setSessions([]);
    setSelectedDate(next);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = selectedDate.toDateString() === today.toDateString();
  const bodyData = buildBodyData(sessions);
  const totalCompleted = sessions.reduce(
    (sum, s) => sum + (s.session_exercises ?? []).filter(e => e.completed).length,
    0,
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Day navigation ── */}
        <View style={styles.dayNav}>
          <TouchableOpacity onPress={goBack} hitSlop={12} style={styles.navBtn}>
            <Text style={styles.navArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.dayLabel}>{formatDateLabel(selectedDate)}</Text>
          <TouchableOpacity
            onPress={goForward}
            hitSlop={12}
            style={styles.navBtn}
            disabled={isToday}
          >
            <Text style={[styles.navArrow, isToday && styles.navArrowDisabled]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* ── Muscle diagram ── */}
        <View style={styles.bodyRow}>
          <View style={styles.bodyCol}>
            <Text style={styles.bodyLabel}>FRONT</Text>
            <Body
              data={bodyData}
              side="front"
              scale={0.7}
              colors={BODY_COLORS}
              defaultFill="#252525"
              border="#404040"
              defaultStroke="none"
              defaultStrokeWidth={0}
            />
          </View>
          <View style={styles.bodyCol}>
            <Text style={styles.bodyLabel}>BACK</Text>
            <Body
              data={bodyData}
              side="back"
              scale={0.7}
              colors={BODY_COLORS}
              defaultFill="#252525"
              border="#404040"
              defaultStroke="none"
              defaultStrokeWidth={0}
            />
          </View>
        </View>

        {/* ── Summary stat ── */}
        {!loading && sessions.length > 0 && (
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{sessions.length}</Text>
              <Text style={styles.statLabel}>
                {sessions.length === 1 ? 'session' : 'sessions'}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>{totalCompleted}</Text>
              <Text style={styles.statLabel}>exercises done</Text>
            </View>
          </View>
        )}

        {/* ── Stat cards: Action Ratio + Streak ── */}
        {!loading && (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statCardValue}>
                {actionRatio !== null ? `${actionRatio}%` : '—'}
              </Text>
              <Text style={styles.statCardLabel}>Action Ratio</Text>
              <Text style={styles.statCardSub}>last 30 days</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statCardValue}>{streak}</Text>
              <Text style={styles.statCardLabel}>Day Streak</Text>
            </View>
          </View>
        )}

        {/* ── Sessions list ── */}
        <Text style={styles.sectionLabel}>COMPLETED SESSIONS</Text>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
        ) : sessions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing yet</Text>
            <Text style={styles.emptyBody}>
              Complete a workout to see it here.
            </Text>
          </View>
        ) : (
          sessions.map(s => {
            const name = getWorkoutName(s);
            const done = (s.session_exercises ?? []).filter(e => e.completed).length;
            const total = (s.session_exercises ?? []).length;
            const startTime = new Date(s.started_at).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            });
            return (
              <TouchableOpacity
                key={s.id}
                style={styles.sessionCard}
                onPress={() =>
                  router.push({
                    pathname: '/workout-summary',
                    params: {
                      completionId: s.id,
                      durationSeconds: String(s.duration_seconds ?? 0),
                      workoutName: name,
                      readOnly: 'true',
                    },
                  })
                }
                activeOpacity={0.75}
              >
                <View style={styles.sessionCardTop}>
                  <Text style={styles.sessionName} numberOfLines={1}>{name}</Text>
                  <TouchableOpacity
                    onPress={() => confirmDelete(s.id)}
                    hitSlop={8}
                    style={styles.sessionDeleteBtn}
                  >
                    <Text style={styles.sessionDeleteText}>×</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.sessionMeta}>
                  <Text style={styles.sessionMetaText}>{startTime}</Text>
                  <Text style={styles.sessionMetaDot}>·</Text>
                  <Text style={styles.sessionMetaText}>
                    {formatDuration(s.duration_seconds)}
                  </Text>
                  {total > 0 && (
                    <>
                      <Text style={styles.sessionMetaDot}>·</Text>
                      <Text style={styles.sessionMetaText}>
                        {done}/{total} exercises
                      </Text>
                    </>
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: 48 },

  // Stat cards
  statsRow: { flexDirection: 'row', gap: spacing.md },
  statCard: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 4,
  },
  statCardValue: { color: colors.accent, fontSize: 28, fontWeight: '700', textAlign: 'center' },
  statCardLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  statCardSub: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },

  // Day navigation
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navBtn: { padding: 4 },
  navArrow: { color: colors.accent, fontSize: 32, fontWeight: '300', lineHeight: 36 },
  navArrowDisabled: { color: colors.textMuted },
  dayLabel: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },

  // Body diagram
  bodyRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
  },
  bodyCol: { alignItems: 'center', gap: 4 },
  bodyLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
  },

  // Stats strip
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
  },
  stat: { alignItems: 'center', gap: 2 },
  statValue: { color: colors.accent, fontSize: 28, fontWeight: '700' },
  statLabel: { color: colors.textMuted, fontSize: 12 },
  statDivider: { width: 1, height: 36, backgroundColor: colors.border },

  // Sessions
  sectionLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1.5 },

  empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  emptyTitle: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  emptyBody: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },

  sessionCard: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sessionCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sessionName: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', flex: 1 },
  sessionDeleteBtn: { paddingHorizontal: 4 },
  sessionDeleteText: { color: colors.textMuted, fontSize: 20, lineHeight: 22, fontWeight: '300' },
  sessionMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  sessionMetaText: { color: colors.textSecondary, fontSize: 13 },
  sessionMetaDot: { color: colors.textSecondary, fontSize: 13 },
});
