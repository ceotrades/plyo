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
import { useLocalSearchParams, router, Stack, useFocusEffect } from 'expo-router';
import { supabase } from '../../services/supabase';
import { useSession } from '../../utils/auth';
import { colors, spacing, radius } from '../../constants/theme';
import { type RawExercise, generateWorkoutTitle } from '../../components/ExerciseEditor';

type Workout = {
  id: string;
  name: string | null;
  exercises: RawExercise[];
  category: string | null;
  created_at: string;
};

type PickerWorkout = {
  id: string;
  name: string | null;
  exercises: RawExercise[];
  category: string | null;
  folder_id: string | null;
  folders: { name: string } | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function currentLocationLabel(w: PickerWorkout): string {
  return w.folders?.name ?? w.category ?? 'Other';
}

export default function FolderScreen() {
  const { type, id, name } = useLocalSearchParams<{
    type: 'category' | 'custom';
    id: string;
    name: string;
  }>();
  const { session } = useSession();

  const [loading, setLoading] = useState(true);
  const [workouts, setWorkouts] = useState<Workout[]>([]);

  const [showPicker, setShowPicker] = useState(false);
  const [pickerWorkouts, setPickerWorkouts] = useState<PickerWorkout[]>([]);
  const [loadingPicker, setLoadingPicker] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      loadWorkouts();
    }, [session, id, type]),
  );

  async function loadWorkouts() {
    setLoading(true);
    let query = supabase
      .from('workouts')
      .select('id, name, exercises, category, created_at')
      .eq('user_id', session!.user.id)
      .order('created_at', { ascending: false });

    if (type === 'category') {
      query = query.eq('category', id).is('folder_id', null);
    } else {
      query = query.eq('folder_id', id);
    }

    const { data, error } = await query;
    if (!error && data) setWorkouts(data as Workout[]);
    setLoading(false);
  }

  async function openPicker() {
    setShowPicker(true);
    setLoadingPicker(true);
    const { data } = await supabase
      .from('workouts')
      .select('id, name, exercises, category, folder_id, folders(name)')
      .eq('user_id', session!.user.id)
      .order('created_at', { ascending: false });
    setPickerWorkouts((data ?? []) as PickerWorkout[]);
    setLoadingPicker(false);
  }

  // Same update logic as workout/[id].tsx handleSave — just called from here.
  async function assignWorkout(workoutId: string) {
    setAssigningId(workoutId);

    const updates =
      type === 'category'
        ? { category: id, folder_id: null }
        : { category: 'Other', folder_id: id };

    const { error } = await supabase
      .from('workouts')
      .update(updates)
      .eq('id', workoutId);

    setAssigningId(null);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setShowPicker(false);
    loadWorkouts();
  }

  function isAlreadyHere(w: PickerWorkout): boolean {
    if (type === 'category') return w.category === id && !w.folder_id;
    return w.folder_id === id;
  }

  function confirmDeleteFolder() {
    Alert.alert(
      'Delete Folder',
      "Workouts in this folder won't be deleted — they'll move to \"Other\". This action can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete Folder', style: 'destructive', onPress: deleteFolder },
      ],
    );
  }

  async function deleteFolder() {
    const { error } = await supabase.from('folders').delete().eq('id', id);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    router.back();
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          title: name,
          headerRight:
            type === 'custom'
              ? () => (
                  <TouchableOpacity onPress={confirmDeleteFolder} hitSlop={12}>
                    <Text style={styles.deleteHeaderBtn}>Delete</Text>
                  </TouchableOpacity>
                )
              : undefined,
        }}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <>
            {workouts.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No workouts here yet</Text>
                <Text style={styles.emptySubtitle}>
                  Tap "Add Workout" below to move an existing workout here.
                </Text>
              </View>
            ) : (
              workouts.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.card}
                  onPress={() => router.push(`/workout/${item.id}`)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.name ?? generateWorkoutTitle(item.exercises)}
                  </Text>
                  <View style={styles.cardMeta}>
                    <Text style={styles.cardMetaText}>
                      {item.exercises.length}{' '}
                      {item.exercises.length === 1 ? 'exercise' : 'exercises'}
                    </Text>
                    <Text style={styles.cardMetaDot}>·</Text>
                    <Text style={styles.cardMetaText}>{formatDate(item.created_at)}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}

            <TouchableOpacity
              style={styles.addBtn}
              onPress={openPicker}
              activeOpacity={0.7}
            >
              <Text style={styles.addBtnText}>+ Add Workout</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* ── All-workouts picker modal ── */}
      <Modal
        visible={showPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPicker(false)}
      >
        <SafeAreaView style={styles.modal}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add to {name}</Text>
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
              <Text style={styles.emptyTitle}>No saved workouts</Text>
              <Text style={styles.emptySubtitle}>
                Extract a workout first, then come back to assign it.
              </Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.pickerList}
              showsVerticalScrollIndicator={false}
            >
              {pickerWorkouts.map(w => {
                const alreadyHere = isAlreadyHere(w);
                const isAssigning = assigningId === w.id;
                return (
                  <TouchableOpacity
                    key={w.id}
                    style={[styles.pickerItem, alreadyHere && styles.pickerItemHere]}
                    onPress={() => !alreadyHere && assignWorkout(w.id)}
                    activeOpacity={alreadyHere ? 1 : 0.7}
                  >
                    <View style={styles.pickerItemBody}>
                      <Text
                        style={[styles.pickerItemName, alreadyHere && styles.pickerItemNameHere]}
                        numberOfLines={1}
                      >
                        {w.name ?? generateWorkoutTitle(w.exercises)}
                      </Text>
                      <Text style={styles.pickerItemLocation}>
                        {alreadyHere
                          ? 'already here'
                          : `currently in: ${currentLocationLabel(w)}`}
                      </Text>
                    </View>
                    {isAssigning && (
                      <ActivityIndicator size="small" color={colors.accent} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: 48 },

  deleteHeaderBtn: { color: colors.danger, fontSize: 15, fontWeight: '600' },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.md },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  emptySubtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },

  card: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardMetaText: { color: colors.textSecondary, fontSize: 13 },
  cardMetaDot: { color: colors.textSecondary, fontSize: 13 },

  addBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    paddingVertical: 14,
    alignItems: 'center',
  },
  addBtnText: { color: colors.accent, fontSize: 15, fontWeight: '600' },

  // ── Modal ──────────────────────────────────────────────────────────────────
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
  modalClose: { color: colors.textMuted, fontSize: 18, fontWeight: '400' },

  pickerList: { padding: spacing.xl, gap: spacing.sm, paddingBottom: 48 },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    gap: spacing.md,
  },
  pickerItemHere: {
    opacity: 0.45,
  },
  pickerItemBody: { flex: 1, gap: 3 },
  pickerItemName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  pickerItemNameHere: { color: colors.textSecondary },
  pickerItemLocation: { color: colors.textMuted, fontSize: 12 },
});
