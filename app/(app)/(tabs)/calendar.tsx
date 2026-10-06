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
  Modal,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../../../services/supabase';
import { useSession } from '../../../utils/auth';
import { colors, spacing, radius } from '../../../constants/theme';

// ── Types ─────────────────────────────────────────────────────────────────────

type DayPlan = {
  day: string;
  type: 'workout' | 'rest';
  workout_id?: string;
  workout_name?: string;
};

type PlanStatus = 'proposed' | 'approved';

type WorkoutPickerItem = {
  id: string;
  name: string | null;
  exercises: Array<{ name: string }>;
  category: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeekStart(): string {
  // NOTE: always Monday-based. Partial first week (signup mid-week) is a
  // planned enhancement that requires edge-function + display changes.
  const today = new Date();
  const dow = today.getDay();
  const toMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + toMonday);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatWeekLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
}

function workoutDisplayName(w: WorkoutPickerItem): string {
  if (w.name) return w.name;
  const exs = w.exercises ?? [];
  if (!exs.length) return 'Untitled Workout';
  if (exs.length === 1) return exs[0].name;
  return `${exs[0].name} +${exs.length - 1} more`;
}

const TODAY_NAME = new Date().toLocaleDateString('en-US', { weekday: 'long' });

// ── Component ─────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const { session } = useSession();
  const [weekStart] = useState(() => getWeekStart());

  // Plan data
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<DayPlan[] | null>(null);
  const [planStatus, setPlanStatus] = useState<PlanStatus | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // Approval
  const [approving, setApproving] = useState(false);

  // Completion indicators
  const [completionCounts, setCompletionCounts] = useState<Record<string, number>>({});
  const [inProgressIds, setInProgressIds] = useState<Set<string>>(new Set());

  // Workout picker modal (for assigning workouts to days)
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTargetDay, setPickerTargetDay] = useState<string | null>(null);
  const [pickerWorkouts, setPickerWorkouts] = useState<WorkoutPickerItem[]>([]);
  const [loadingPicker, setLoadingPicker] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      setLoading(true);

      const [y, m, d] = weekStart.split('-').map(Number);
      const weekStartDate = new Date(y, m - 1, d);
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekEndDate.getDate() + 7);

      Promise.all([
        supabase
          .from('weekly_plans')
          .select('plan, status')
          .eq('user_id', session.user.id)
          .eq('week_start', weekStart)
          .maybeSingle(),
        supabase
          .from('workout_completions')
          .select('workout_id, ended_at')
          .eq('user_id', session.user.id)
          .gte('started_at', weekStartDate.toISOString())
          .lt('started_at', weekEndDate.toISOString()),
      ]).then(([planRes, completionsRes]) => {
        const planData = planRes.data;
        setPlan(
          Array.isArray(planData?.plan?.days)
            ? (planData!.plan.days as DayPlan[])
            : null,
        );
        setPlanStatus(
          planData?.status === 'approved' ? 'approved'
          : planData?.status === 'proposed' ? 'proposed'
          : null,
        );

        const counts: Record<string, number> = {};
        const inProg = new Set<string>();
        for (const c of completionsRes.data ?? []) {
          if (c.ended_at) {
            counts[c.workout_id] = (counts[c.workout_id] ?? 0) + 1;
          } else {
            inProg.add(c.workout_id);
          }
        }
        setCompletionCounts(counts);
        setInProgressIds(inProg);
        setLoading(false);
      });
    }, [session, weekStart]),
  );

  // ── Approve ───────────────────────────────────────────────────────────────

  async function handleApprove() {
    if (!session) return;
    setApproving(true);
    const { error } = await supabase
      .from('weekly_plans')
      .update({ status: 'approved' })
      .eq('user_id', session.user.id)
      .eq('week_start', weekStart);
    setApproving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setPlanStatus('approved');
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);

    const { data, error } = await supabase.functions.invoke('generate-calendar');

    if (error) {
      setGenError(error.message ?? 'Generation failed. Please try again.');
      setGenerating(false);
      return;
    }

    const days: DayPlan[] | undefined = data?.plan?.days;
    if (!days || days.length === 0) {
      setGenError('The AI returned an empty plan. Please try again.');
      setGenerating(false);
      return;
    }

    // New or regenerated plans always start as 'proposed' — require user review.
    const { error: saveErr } = await supabase
      .from('weekly_plans')
      .upsert(
        { user_id: session!.user.id, week_start: weekStart, plan: { days }, status: 'proposed' },
        { onConflict: 'user_id,week_start' },
      );

    if (saveErr) {
      setGenError(saveErr.message);
      setGenerating(false);
      return;
    }

    setPlan(days);
    setPlanStatus('proposed');
    setGenerating(false);
  }

  // ── Day-level editing ─────────────────────────────────────────────────────

  // Uses UPDATE (not upsert) so status is never overwritten by day edits.
  async function updateDayInPlan(
    dayName: string,
    update: { type: 'rest' } | { type: 'workout'; workout_id: string; workout_name: string },
  ) {
    if (!session || !plan) return;
    const updatedDays = plan.map(d =>
      d.day === dayName ? { day: d.day, ...update } : d,
    );
    setPlan(updatedDays);
    const { error } = await supabase
      .from('weekly_plans')
      .update({ plan: { days: updatedDays } })
      .eq('user_id', session.user.id)
      .eq('week_start', weekStart);
    if (error) {
      Alert.alert('Error', error.message);
      setPlan(plan);
    }
  }

  function setDayAsRest(dayName: string) {
    updateDayInPlan(dayName, { type: 'rest' });
  }

  // ── Workout picker ────────────────────────────────────────────────────────

  async function openPickerForDay(dayName: string) {
    setPickerTargetDay(dayName);
    setShowPicker(true);
    setLoadingPicker(true);
    const { data } = await supabase
      .from('workouts')
      .select('id, name, exercises, category')
      .eq('user_id', session!.user.id)
      .order('created_at', { ascending: false });
    setPickerWorkouts((data ?? []) as WorkoutPickerItem[]);
    setLoadingPicker(false);
  }

  function assignWorkoutToDay(workout: WorkoutPickerItem) {
    if (!pickerTargetDay) return;
    updateDayInPlan(pickerTargetDay, {
      type: 'workout',
      workout_id: workout.id,
      workout_name: workoutDisplayName(workout),
    });
    setShowPicker(false);
  }

  function openDayOptions(dayName: string, currentWorkoutName: string) {
    Alert.alert(
      currentWorkoutName,
      undefined,
      [
        { text: 'Change Workout', onPress: () => openPickerForDay(dayName) },
        { text: 'Set as Rest Day', style: 'destructive', onPress: () => setDayAsRest(dayName) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Week header */}
        <View style={styles.weekHeader}>
          <View>
            <Text style={styles.weekLabel}>Week of {formatWeekLabel(weekStart)}</Text>
            {plan && (
              <Text style={styles.weekSub}>Generated based on your profile</Text>
            )}
          </View>
          {plan && !generating && (
            <TouchableOpacity onPress={handleGenerate} hitSlop={12}>
              <Text style={styles.regenerateText}>↺ Regenerate</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Review banner — shown while plan is proposed ── */}
        {plan && planStatus === 'proposed' && !generating && (
          <View style={styles.reviewBanner}>
            <View>
              <Text style={styles.reviewBannerTitle}>Review your week plan</Text>
              <Text style={styles.reviewBannerBody}>
                Edit any day below, then approve to lock in your week.
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.approveButton, approving && styles.approveButtonDisabled]}
              onPress={handleApprove}
              disabled={approving}
            >
              {approving ? (
                <ActivityIndicator color={colors.accentFg} size="small" />
              ) : (
                <Text style={styles.approveButtonText}>Approve This Week</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {genError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{genError}</Text>
          </View>
        )}

        {generating && (
          <View style={styles.generatingRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.generatingText}>Building your week…</Text>
          </View>
        )}

        {!plan && !generating && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No plan for this week</Text>
            <Text style={styles.emptyBody}>
              Generate a personalised schedule based on your goal and saved workouts. The AI picks
              from your library — it won't invent exercises you haven't saved.
            </Text>
            <TouchableOpacity style={styles.generateButton} onPress={handleGenerate}>
              <Text style={styles.generateButtonText}>Generate My Week</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Calendar — 7 day rows */}
        {plan && !generating && (
          <View style={styles.days}>
            {plan.map(day => {
              const isToday = day.day === TODAY_NAME;
              const isWorkout = day.type === 'workout' && !!day.workout_id;

              return (
                <View key={day.day} style={styles.dayBlock}>
                  <View style={styles.dayLabelRow}>
                    <Text style={[styles.dayName, isToday && styles.dayNameToday]}>
                      {day.day.toUpperCase()}
                    </Text>
                    {isToday && (
                      <View style={styles.todayPill}>
                        <Text style={styles.todayPillText}>TODAY</Text>
                      </View>
                    )}
                  </View>

                  {isWorkout ? (
                    <TouchableOpacity
                      style={[styles.workoutCard, isToday && styles.workoutCardToday]}
                      onPress={() => router.push(`/workout/${day.workout_id}`)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.workoutCardRow}>
                        <Text style={styles.workoutName} numberOfLines={1}>
                          {day.workout_name}
                        </Text>
                        <TouchableOpacity
                          onPress={() => openDayOptions(day.day, day.workout_name ?? 'Workout')}
                          hitSlop={8}
                          style={styles.dayOptionsBtn}
                        >
                          <Text style={styles.dayOptionsBtnText}>•••</Text>
                        </TouchableOpacity>
                        <Text style={styles.workoutArrow}>→</Text>
                      </View>
                      {(() => {
                        const wid = day.workout_id!;
                        const count = completionCounts[wid] ?? 0;
                        const isActive = inProgressIds.has(wid);
                        if (count > 0) {
                          return (
                            <Text style={styles.completionText}>
                              ✓ {count === 1 ? 'Completed' : `${count}× completed`}
                            </Text>
                          );
                        }
                        if (isActive) {
                          return <Text style={styles.inProgressText}>● In progress</Text>;
                        }
                        return null;
                      })()}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.restCard}
                      onPress={() => openPickerForDay(day.day)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.restText}>Rest day</Text>
                      <Text style={styles.restAssignHint}>+ Assign</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Workout picker modal */}
      <Modal
        visible={showPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPicker(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {pickerTargetDay ? `Assign — ${pickerTargetDay}` : 'Assign Workout'}
            </Text>
            <TouchableOpacity onPress={() => setShowPicker(false)} hitSlop={12}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          {loadingPicker ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : pickerWorkouts.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.pickerEmpty}>No saved workouts yet.</Text>
              <Text style={styles.pickerEmptyHint}>
                Extract workouts from the Home tab, then come back to assign them.
              </Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.pickerList}
              showsVerticalScrollIndicator={false}
            >
              {pickerWorkouts.map(w => (
                <TouchableOpacity
                  key={w.id}
                  style={styles.pickerItem}
                  onPress={() => assignWorkoutToDay(w)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.pickerItemName}>{workoutDisplayName(w)}</Text>
                  {!!w.category && w.category !== 'Other' && (
                    <Text style={styles.pickerItemCategory}>{w.category}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  content: { padding: spacing.xl, gap: spacing.xl, paddingBottom: 48 },

  // Week header
  weekHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  weekLabel: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  weekSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  regenerateText: { color: colors.textSecondary, fontSize: 14, paddingTop: 4 },

  // Review banner
  reviewBanner: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  reviewBannerTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  reviewBannerBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  approveButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  approveButtonDisabled: { opacity: 0.6 },
  approveButtonText: { color: colors.accentFg, fontSize: 15, fontWeight: '700' },

  // Error
  errorBox: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  errorText: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },

  // Generating
  generatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  generatingText: { color: colors.textSecondary, fontSize: 15 },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: spacing.lg },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  generateButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    paddingHorizontal: 36,
    marginTop: spacing.sm,
  },
  generateButtonText: { color: colors.accentFg, fontSize: 16, fontWeight: '700' },

  // Day list
  days: { gap: spacing.md },
  dayBlock: { gap: spacing.sm },
  dayLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayName: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  dayNameToday: { color: colors.textPrimary },
  todayPill: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  todayPillText: { color: colors.accentFg, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },

  // Workout card
  workoutCard: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    gap: 4,
  },
  workoutCardToday: { borderColor: colors.accent },
  workoutCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  workoutName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', flex: 1 },
  dayOptionsBtn: { paddingHorizontal: 6 },
  dayOptionsBtnText: { color: colors.textMuted, fontSize: 14, letterSpacing: 1 },
  workoutArrow: { color: colors.accent, fontSize: 16, marginLeft: 4 },
  completionText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  inProgressText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },

  // Rest card
  restCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
  },
  restText: { color: colors.textMuted, fontSize: 14 },
  restAssignHint: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },

  // Workout picker modal
  modal: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  modalClose: { color: colors.textMuted, fontSize: 18 },
  pickerList: { padding: spacing.xl, gap: spacing.md, paddingBottom: 48 },
  pickerItem: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    gap: 3,
  },
  pickerItemName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  pickerItemCategory: { color: colors.textMuted, fontSize: 12 },
  pickerEmpty: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  pickerEmptyHint: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
    maxWidth: 280,
  },
});
