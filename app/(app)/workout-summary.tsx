import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../services/supabase';
import { useSession } from '../../utils/auth';
import { colors, spacing, radius } from '../../constants/theme';

// ── Types ─────────────────────────────────────────────────────────────────────

type StoredExercise = {
  name: string;
  sets: number | null;
  reps: number | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
  notes: string | null;
  completed: boolean;
  source_workout_name?: string | null;
};

type SummaryExercise = StoredExercise & { key: string };

// Current personal best for one exercise + record type.
type ExistingPR = {
  exercise_name: string; // always lowercase
  record_type: string;
  value: number;
  unit: string;
};

// A PR that was beaten in this session.
type PRHit = {
  exerciseName: string; // display name (original case from session)
  recordType: string;
  newValue: number;
  oldValue: number;
  unit: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours} hr ${minutes} min`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  if (totalMinutes === 0) return 'Less than a minute';
  return `${totalMinutes} minute${totalMinutes !== 1 ? 's' : ''}`;
}

function formatExLine(ex: StoredExercise): string {
  const parts: string[] = [];
  if (ex.sets) parts.push(`${ex.sets} sets`);
  if (ex.reps) parts.push(`× ${ex.reps} reps`);
  else if (ex.duration_seconds) parts.push(`× ${ex.duration_seconds}s`);
  if (ex.rest_seconds) parts.push(`· ${ex.rest_seconds}s rest`);
  return parts.join('  ');
}

function formatPRValue(value: number, unit: string): string {
  if (unit === 'seconds') {
    if (value >= 60) return `${Math.floor(value / 60)}m ${value % 60}s`;
    return `${value}s`;
  }
  return `${value} ${unit}`;
}

function inferMuscleGroups(exercises: StoredExercise[]): string[] {
  const groups = new Set<string>();
  for (const { name } of exercises) {
    const n = name.toLowerCase();
    if (/bench|chest fly|pec|push.?up(?!.*down)/.test(n)) groups.add('Chest');
    if (/squat|leg press|quad/.test(n)) groups.add('Quads');
    if (/hamstring|rdl|romanian|leg curl|nordic/.test(n)) groups.add('Hamstrings');
    if (/calf/.test(n)) groups.add('Calves');
    if (/lateral raise|front raise|shoulder press|overhead press|ohp|delt/.test(n)) groups.add('Shoulders');
    if (/bicep|curl(?!.*leg)/.test(n)) groups.add('Biceps');
    if (/tricep|skull|push.?down|overhead extension/.test(n)) groups.add('Triceps');
    if (/\brow\b|pull.?up|pull.?down|lat |deadlift|back extension|face pull|shrug/.test(n)) groups.add('Back');
    if (/glute|hip thrust|sumo|abductor/.test(n)) groups.add('Glutes');
    if (/\bab\b|core|plank|crunch|sit.?up|hollow|l.?sit/.test(n)) groups.add('Core');
    if (/\brun\b|sprint|jog|treadmill/.test(n)) groups.add('Cardio');
    if (/burpee|box jump|kettlebell|circuit|sled|sandbag|wall ball|ski erg|rowing/.test(n)) groups.add('Full Body');
  }
  return Array.from(groups);
}

// Compute which PRs were beaten, based on the current checked exercise state.
// Called on every render so it updates live as the user ticks/unticks exercises.
//
// NOTE: PRs are matched on exercise_name exact-string (lowercased). "Bench Press"
// and "Barbell Bench" are treated as different exercises. Fuzzy name-matching
// is a deferred, deliberate decision — see personal_records table comments.
//
// NOTE: weight/load is not tracked because the RawExercise schema has no weight
// field. 'max_weight' PRs will be supported once weight is added to the schema.
function computePRHits(
  exercises: SummaryExercise[],
  existingPRs: ExistingPR[],
): PRHit[] {
  const hits: PRHit[] = [];

  // Deduplicate within the session: take the best value per (name, type).
  const bestReps = new Map<string, { display: string; value: number }>();
  const bestDuration = new Map<string, { display: string; value: number }>();

  for (const ex of exercises) {
    if (!ex.completed) continue;
    const key = ex.name.toLowerCase();
    if (ex.reps !== null && ex.reps > 0) {
      const current = bestReps.get(key);
      if (!current || ex.reps > current.value) bestReps.set(key, { display: ex.name, value: ex.reps });
    }
    if (ex.duration_seconds !== null && ex.duration_seconds > 0) {
      const current = bestDuration.get(key);
      if (!current || ex.duration_seconds > current.value) {
        bestDuration.set(key, { display: ex.name, value: ex.duration_seconds });
      }
    }
  }

  for (const [key, { display, value }] of bestReps) {
    const existing = existingPRs.find(pr => pr.exercise_name === key && pr.record_type === 'max_reps');
    // Only celebrate if there IS a prior record to beat (first time = baseline, not a PR).
    if (existing && value > existing.value) {
      hits.push({ exerciseName: display, recordType: 'max_reps', newValue: value, oldValue: existing.value, unit: 'reps' });
    }
  }

  for (const [key, { display, value }] of bestDuration) {
    const existing = existingPRs.find(pr => pr.exercise_name === key && pr.record_type === 'longest_duration');
    if (existing && value > existing.value) {
      hits.push({ exerciseName: display, recordType: 'longest_duration', newValue: value, oldValue: existing.value, unit: 'seconds' });
    }
  }

  return hits;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorkoutSummaryScreen() {
  const { completionId, durationSeconds: durationStr, workoutName, readOnly: readOnlyParam } =
    useLocalSearchParams<{
      completionId: string;
      durationSeconds: string;
      workoutName: string;
      readOnly?: string;
    }>();

  const { session } = useSession();
  const readOnly = readOnlyParam === 'true';
  const durationSeconds = parseInt(durationStr ?? '0', 10);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exercises, setExercises] = useState<SummaryExercise[]>([]);
  const [existingPRs, setExistingPRs] = useState<ExistingPR[]>([]);

  // Load the session's exercise list from the completion record.
  useEffect(() => {
    if (!completionId) { setLoading(false); return; }
    supabase
      .from('workout_completions')
      .select('session_exercises')
      .eq('id', completionId)
      .single()
      .then(({ data }) => {
        const stored: StoredExercise[] = Array.isArray(data?.session_exercises)
          ? (data!.session_exercises as StoredExercise[])
          : [];
        setExercises(stored.map((ex, i) => ({ ...ex, key: `${i}-${ex.name}` })));
        setLoading(false);
      });
  }, [completionId]);

  // Load existing PRs for all exercises in this session.
  // Skipped in readOnly mode — historical views shouldn't trigger PR logic.
  useEffect(() => {
    if (readOnly || !session || exercises.length === 0) return;
    const names = [...new Set(exercises.map(e => e.name.toLowerCase()))];
    supabase
      .from('personal_records')
      .select('exercise_name, record_type, value, unit')
      .eq('user_id', session.user.id)
      .in('exercise_name', names)
      .then(({ data }) => setExistingPRs((data ?? []) as ExistingPR[]));
  }, [exercises, session, readOnly]);

  // Reactive: recomputes whenever the user ticks/unticks exercises.
  const prHits = readOnly ? [] : computePRHits(exercises, existingPRs);

  function toggleExercise(key: string) {
    setExercises(prev => prev.map(ex => ex.key === key ? { ...ex, completed: !ex.completed } : ex));
  }

  // Save final exercise state + upsert PR baselines / new records.
  async function handleDone() {
    if (readOnly) { router.back(); return; }
    setSaving(true);

    const updated: StoredExercise[] = exercises.map(({ key: _k, ...ex }) => ex);
    await supabase
      .from('workout_completions')
      .update({ session_exercises: updated })
      .eq('id', completionId);

    if (session) {
      await savePRsAndBaselines(session.user.id, completionId as string);
    }

    setSaving(false);
    router.replace('/add');
  }

  async function savePRsAndBaselines(userId: string, cid: string) {
    const completed = exercises.filter(e => e.completed);
    const now = new Date().toISOString();

    // Deduplicate: best value per (name, type) in this session.
    const bestReps = new Map<string, number>();
    const bestDuration = new Map<string, number>();
    for (const ex of completed) {
      const key = ex.name.toLowerCase();
      if (ex.reps !== null && ex.reps > 0) {
        if ((bestReps.get(key) ?? 0) < ex.reps) bestReps.set(key, ex.reps);
      }
      if (ex.duration_seconds !== null && ex.duration_seconds > 0) {
        if ((bestDuration.get(key) ?? 0) < ex.duration_seconds) bestDuration.set(key, ex.duration_seconds);
      }
    }

    const ops: Promise<unknown>[] = [];

    for (const [key, reps] of bestReps) {
      const existing = existingPRs.find(pr => pr.exercise_name === key && pr.record_type === 'max_reps');
      if (!existing) {
        // First completion — store as baseline (no PR celebration for firsts).
        ops.push(supabase.from('personal_records').insert({
          user_id: userId, exercise_name: key, record_type: 'max_reps',
          value: reps, unit: 'reps', achieved_at: now, workout_completion_id: cid,
        }));
      } else if (reps > existing.value) {
        ops.push(supabase.from('personal_records')
          .update({ value: reps, achieved_at: now, workout_completion_id: cid })
          .eq('user_id', userId).eq('exercise_name', key).eq('record_type', 'max_reps'));
      }
    }

    for (const [key, duration] of bestDuration) {
      const existing = existingPRs.find(pr => pr.exercise_name === key && pr.record_type === 'longest_duration');
      if (!existing) {
        ops.push(supabase.from('personal_records').insert({
          user_id: userId, exercise_name: key, record_type: 'longest_duration',
          value: duration, unit: 'seconds', achieved_at: now, workout_completion_id: cid,
        }));
      } else if (duration > existing.value) {
        ops.push(supabase.from('personal_records')
          .update({ value: duration, achieved_at: now, workout_completion_id: cid })
          .eq('user_id', userId).eq('exercise_name', key).eq('record_type', 'longest_duration'));
      }
    }

    await Promise.all(ops);
  }

  const completedExercises = exercises.filter(e => e.completed);
  const muscleGroups = inferMuscleGroups(completedExercises);
  const completedCount = completedExercises.length;
  const totalCount = exercises.length;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <>
            {/* Hero */}
            <View style={styles.hero}>
              <View style={styles.heroCircle}>
                <Text style={styles.heroCheck}>✓</Text>
              </View>
              <Text style={styles.heroName}>{workoutName ?? 'Workout'}</Text>
            </View>

            {/* Duration */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>DURATION</Text>
              <Text style={styles.durationText}>{formatDuration(durationSeconds)}</Text>
            </View>

            {/* ── PR celebration ── */}
            {!readOnly && prHits.length > 0 && (
              <View style={styles.prSection}>
                <Text style={styles.prSectionLabel}>NEW PERSONAL RECORDS</Text>
                {prHits.map(hit => (
                  <View key={`${hit.exerciseName}-${hit.recordType}`} style={styles.prItem}>
                    <Text style={styles.prExerciseName}>{hit.exerciseName}</Text>
                    <Text style={styles.prDetail}>
                      {formatPRValue(hit.newValue, hit.unit)}
                      {'  '}
                      <Text style={styles.prPrev}>was {formatPRValue(hit.oldValue, hit.unit)}</Text>
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Exercise checklist */}
            {exercises.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionLabel}>EXERCISES</Text>
                  <Text style={styles.countBadge}>{completedCount}/{totalCount} completed</Text>
                </View>
                <Text style={styles.hint}>Tap to adjust before confirming</Text>
                {exercises.map(ex => (
                  <TouchableOpacity
                    key={ex.key}
                    style={styles.checkItem}
                    onPress={() => toggleExercise(ex.key)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, ex.completed && styles.checkboxChecked]}>
                      {ex.completed && <Text style={styles.checkboxTick}>✓</Text>}
                    </View>
                    <View style={styles.checkItemBody}>
                      <Text style={[styles.checkItemName, !ex.completed && styles.checkItemSkipped]}>
                        {ex.name}
                      </Text>
                      {!!formatExLine(ex) && (
                        <Text style={styles.checkItemMeta}>{formatExLine(ex)}</Text>
                      )}
                      {!!ex.source_workout_name && (
                        <Text style={styles.checkItemSource}>from {ex.source_workout_name}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Muscle groups */}
            {muscleGroups.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>MUSCLES WORKED</Text>
                <View style={styles.muscleGroups}>
                  {muscleGroups.map(group => (
                    <View key={group} style={styles.musclePill}>
                      <Text style={styles.musclePillText}>{group}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.doneButton, saving && styles.doneButtonDisabled]}
              onPress={handleDone}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color={colors.accentFg} />
                : <Text style={styles.doneButtonText}>{readOnly ? 'Close' : 'Done'}</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 200 },
  content: { padding: spacing.xl, gap: spacing.xl, paddingBottom: 48 },

  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  heroCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.accentDim, borderWidth: 2, borderColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  heroCheck: { color: colors.accent, fontSize: 28, fontWeight: '700' },
  heroName: { color: colors.textPrimary, fontSize: 22, fontWeight: '700', textAlign: 'center' },

  section: { gap: spacing.md },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1.5 },
  countBadge: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: -spacing.sm },
  durationText: { color: colors.textPrimary, fontSize: 32, fontWeight: '200', letterSpacing: 0.5 },

  // PR celebration
  prSection: {
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  prSectionLabel: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  prItem: { gap: 2 },
  prExerciseName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  prDetail: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  prPrev: { color: colors.textMuted, fontSize: 13, fontWeight: '400' },

  // Checklist
  checkItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: 4 },
  checkbox: {
    width: 24, height: 24, borderRadius: 5, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgInput, marginTop: 1,
  },
  checkboxChecked: { borderColor: colors.accent, backgroundColor: colors.accent },
  checkboxTick: { color: colors.accentFg, fontSize: 13, fontWeight: '800' },
  checkItemBody: { flex: 1, gap: 2 },
  checkItemName: { color: colors.textPrimary, fontSize: 15, fontWeight: '500' },
  checkItemSkipped: { color: colors.textMuted },
  checkItemMeta: { color: colors.textMuted, fontSize: 12 },
  checkItemSource: { color: colors.accent, fontSize: 11, fontWeight: '600' },

  // Muscle groups
  muscleGroups: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  musclePill: {
    borderWidth: 1, borderColor: colors.accent, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: 5, backgroundColor: colors.accentDim,
  },
  musclePillText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

  doneButton: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: 16, alignItems: 'center', marginTop: spacing.sm,
  },
  doneButtonDisabled: { opacity: 0.6 },
  doneButtonText: { color: colors.accentFg, fontSize: 16, fontWeight: '700' },
});
