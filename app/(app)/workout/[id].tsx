import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  Switch,
  Image,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../../../services/supabase';
import { useSession } from '../../../utils/auth';
import { getWeekStart } from '../../../utils/weekStart';
import { pickImage, uploadBase64Image } from '../../../utils/imageUpload';
import { colors, spacing, radius } from '../../../constants/theme';
import {
  WORKOUT_CATEGORIES,
  type WorkoutCategory,
  type Placement,
} from '../../../constants/categories';
import {
  type RawExercise,
  type Exercise,
  toEditable,
  blankExercise,
  toDbRow,
  ExerciseCard,
  generateWorkoutTitle,
} from '../../../components/ExerciseEditor';

// ── Types ────────────────────────────────────────────────────────────────────

type WorkoutRow = {
  id: string;
  name: string | null;
  exercises: RawExercise[];
  notes: string | null;
  category: string | null;
  folder_id: string | null;
  folders: { name: string } | null;
  is_public: boolean;
  cover_url: string | null;
};

type Folder = { id: string; name: string };

type Snapshot = {
  name: string;
  exercises: Exercise[];
  notes: string;
  placement: Placement;
  isPublic: boolean;
  coverUrl: string | null;
};

type InProgressCompletion = { id: string; started_at: string };

// Exercises tracked during an active session: both original and user-added.
// `checked` drives the live checklist; `sourceWorkoutName` marks added-from-library entries.
type SessionExercise = {
  localId: string;
  name: string;
  sets: number | null;
  reps: number | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
  notes: string | null;
  checked: boolean;
  sourceWorkoutName?: string;
};

// An exercise from a different saved workout, available to add to this session.
type LibraryExercise = {
  key: string;
  exercise: RawExercise;
  workoutName: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatExerciseMeta(ex: Exercise): string {
  const parts: string[] = [];
  if (ex.sets) parts.push(`${ex.sets} sets`);
  if (ex.reps) parts.push(`× ${ex.reps} reps`);
  else if (ex.duration_seconds) parts.push(`× ${ex.duration_seconds}s`);
  if (ex.rest_seconds) parts.push(`Rest ${ex.rest_seconds}s`);
  return parts.join('  ·  ');
}

function formatSessionExMeta(ex: SessionExercise): string {
  const parts: string[] = [];
  if (ex.sets) parts.push(`${ex.sets} sets`);
  if (ex.reps) parts.push(`× ${ex.reps} reps`);
  else if (ex.duration_seconds) parts.push(`× ${ex.duration_seconds}s`);
  if (ex.rest_seconds) parts.push(`· ${ex.rest_seconds}s rest`);
  return parts.join('  ');
}

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function rawToSession(ex: RawExercise, index: number, sessionId: string): SessionExercise {
  return {
    localId: `orig-${index}-${sessionId}`,
    name: ex.name,
    sets: ex.sets,
    reps: ex.reps,
    duration_seconds: ex.duration_seconds,
    rest_seconds: ex.rest_seconds,
    notes: ex.notes,
    checked: false,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();

  // Workout data
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [workoutName, setWorkoutName] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [placement, setPlacement] = useState<Placement>({ kind: 'category', value: 'Other' });
  const [isPublic, setIsPublic] = useState(true);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [saved, setSaved] = useState<Snapshot | null>(null);

  // Active session
  const [inProgress, setInProgress] = useState<InProgressCompletion | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [sessionExercises, setSessionExercises] = useState<SessionExercise[]>([]);

  // Category picker dropdown (edit mode)
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  // Exercise-from-library picker
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [libraryExercises, setLibraryExercises] = useState<LibraryExercise[]>([]);
  const [loadingPicker, setLoadingPicker] = useState(false);

  // Load workout data + check for an in-progress session in one round-trip.
  useEffect(() => {
    if (!id) return;
    setLoading(true);

    const workoutQ = supabase
      .from('workouts')
      .select('*, folders(name)')
      .eq('id', id)
      .single();

    const completionQ = session
      ? supabase
          .from('workout_completions')
          .select('id, started_at')
          .eq('workout_id', id)
          .eq('user_id', session.user.id)
          .is('ended_at', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null });

    Promise.all([workoutQ, completionQ]).then(([workoutRes, completionRes]) => {
      if (workoutRes.error || !workoutRes.data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const row = workoutRes.data as WorkoutRow;
      const p: Placement = row.folder_id
        ? { kind: 'folder', id: row.folder_id, name: row.folders?.name ?? 'Folder' }
        : { kind: 'category', value: (row.category as WorkoutCategory) ?? 'Other' };

      const snapshot: Snapshot = {
        name: row.name ?? generateWorkoutTitle(row.exercises),
        exercises: row.exercises.map(toEditable),
        notes: row.notes ?? '',
        placement: p,
        isPublic: row.is_public ?? true,
        coverUrl: row.cover_url ?? null,
      };
      applySnapshot(snapshot);
      setSaved(snapshot);

      const completion = completionRes.data;
      setInProgress(completion ? { id: completion.id, started_at: completion.started_at } : null);
      if (completion) {
        // Re-hydrate checklist from the raw workout exercises.
        // Checked state is not persisted on the DB during a session; it resets if the
        // screen unmounts and remounts — a known limitation for v1.
        setSessionExercises(
          row.exercises.map((ex, i) => rawToSession(ex, i, completion.id)),
        );
      }

      setLoading(false);
    });
  }, [id, session]);

  // Tick the timer every second, always derived from the stored started_at so it
  // stays accurate across app restarts or screen remounts.
  useEffect(() => {
    if (!inProgress) { setElapsedSeconds(0); return; }
    const calc = () =>
      Math.floor((Date.now() - new Date(inProgress.started_at).getTime()) / 1000);
    setElapsedSeconds(calc());
    const interval = setInterval(() => setElapsedSeconds(calc()), 1000);
    return () => clearInterval(interval);
  }, [inProgress]);

  // Fetch folders only when entering edit mode.
  useEffect(() => {
    if (!session || !isEditing) return;
    supabase
      .from('folders')
      .select('id, name')
      .eq('user_id', session.user.id)
      .order('created_at')
      .then(({ data }) => { if (data) setFolders(data as Folder[]); });
  }, [session, isEditing]);

  // ── Workout edit helpers ───────────────────────────────────────────────────

  function applySnapshot(s: Snapshot) {
    setWorkoutName(s.name);
    setExercises(s.exercises);
    setWorkoutNotes(s.notes);
    setPlacement(s.placement);
    setIsPublic(s.isPublic);
    setCoverUrl(s.coverUrl);
  }

  function handleCoverPress() {
    if (!coverUrl) { doPickCover(); return; }
    Alert.alert(
      'Cover Image',
      undefined,
      [
        { text: 'Change Cover', onPress: doPickCover },
        { text: 'Remove Cover', style: 'destructive', onPress: () => setCoverUrl(null) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  async function doPickCover() {
    if (!session) return;

    const picked = await pickImage({ aspect: [16, 9] });
    if (!picked) return;

    setCoverUrl(picked.uri); // Show immediately
    setUploadingCover(true);

    try {
      const url = await uploadBase64Image(picked.base64, `workouts/${session.user.id}/${id}`);
      setCoverUrl(url);
    } catch (err) {
      Alert.alert('Upload failed', (err as Error).message);
    }
    setUploadingCover(false);
  }

  function handleCancel() {
    if (saved) applySnapshot(saved);
    setIsEditing(false);
  }

  function updateField(exId: string, field: keyof Exercise, value: string) {
    setExercises(prev => prev.map(ex => ex.id === exId ? { ...ex, [field]: value } : ex));
  }

  function deleteExercise(exId: string) {
    setExercises(prev => prev.filter(ex => ex.id !== exId));
  }

  function addExercise() {
    setExercises(prev => [...prev, blankExercise()]);
  }

  async function handleSave() {
    const named = exercises.filter(ex => ex.name.trim().length > 0);
    if (named.length === 0) {
      Alert.alert('No exercises', 'Add at least one exercise with a name.');
      return;
    }
    const trimmedName = workoutName.trim();
    const trimmedNotes = workoutNotes.trim();
    setSaving(true);
    const { error } = await supabase
      .from('workouts')
      .update({
        name: trimmedName || null,
        exercises: named.map(toDbRow),
        notes: trimmedNotes || null,
        category: placement.kind === 'category' ? placement.value : 'Other',
        folder_id: placement.kind === 'folder' ? placement.id : null,
        is_public: isPublic,
        cover_url: coverUrl,
      })
      .eq('id', id);
    setSaving(false);
    if (error) { Alert.alert('Save failed', error.message); return; }
    const displayName = trimmedName || generateWorkoutTitle(named.map(toDbRow));
    const nextSnapshot: Snapshot = { name: displayName, exercises: named, notes: trimmedNotes, placement, isPublic, coverUrl };
    setWorkoutName(displayName);
    setExercises(named);
    setWorkoutNotes(trimmedNotes);
    setSaved(nextSnapshot);
    setIsEditing(false);
  }

  // ── Checklist helpers ──────────────────────────────────────────────────────

  function toggleExercise(localId: string) {
    setSessionExercises(prev =>
      prev.map(ex => ex.localId === localId ? { ...ex, checked: !ex.checked } : ex),
    );
  }

  async function openExercisePicker() {
    setShowExercisePicker(true);
    setLoadingPicker(true);
    // Exclude the current workout so we don't re-add its exercises.
    const { data } = await supabase
      .from('workouts')
      .select('id, name, exercises')
      .eq('user_id', session!.user.id)
      .neq('id', id)
      .order('created_at', { ascending: false });

    const items: LibraryExercise[] = [];
    for (const w of data ?? []) {
      const wName = (w.name ?? generateWorkoutTitle(w.exercises)) as string;
      for (const ex of (w.exercises as RawExercise[]) ?? []) {
        items.push({ key: `${w.id}-${ex.name}-${Math.random()}`, exercise: ex, workoutName: wName });
      }
    }
    setLibraryExercises(items);
    setLoadingPicker(false);
  }

  function addExerciseToSession(item: LibraryExercise) {
    const newEx: SessionExercise = {
      localId: `added-${Date.now()}-${item.exercise.name}`,
      ...item.exercise,
      checked: false,
      sourceWorkoutName: item.workoutName,
    };
    setSessionExercises(prev => [...prev, newEx]);
    setShowExercisePicker(false);
  }

  // ── Active session controls ────────────────────────────────────────────────

  async function handleStartWorkout() {
    if (!session) return;
    setStarting(true);
    const startedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('workout_completions')
      .insert({ user_id: session.user.id, workout_id: id, started_at: startedAt })
      .select('id, started_at')
      .single();
    setStarting(false);
    if (error || !data) {
      Alert.alert('Error', error?.message ?? 'Failed to start workout');
      return;
    }
    const completion: InProgressCompletion = { id: data.id, started_at: data.started_at };
    setInProgress(completion);
    // Initialize checklist from current workout exercises.
    setSessionExercises(
      exercises.map((ex, i) => ({
        localId: `orig-${i}-${completion.id}`,
        name: ex.name,
        sets: ex.sets ? parseInt(ex.sets, 10) : null,
        reps: ex.reps ? parseInt(ex.reps, 10) : null,
        duration_seconds: ex.duration_seconds ? parseInt(ex.duration_seconds, 10) : null,
        rest_seconds: ex.rest_seconds ? parseInt(ex.rest_seconds, 10) : null,
        notes: ex.notes || null,
        checked: false,
      })),
    );
    scheduleWorkoutReminder(id as string, workoutName);
  }

  async function handleEndWorkout() {
    if (!inProgress) return;
    setEnding(true);

    await Notifications.cancelAllScheduledNotificationsAsync();

    const endedAt = new Date().toISOString();
    const durationSeconds = Math.floor(
      (new Date(endedAt).getTime() - new Date(inProgress.started_at).getTime()) / 1000,
    );

    // Persist all session exercises (checked and unchecked) so the summary screen
    // can show the full list and allow final adjustments.
    const sessionExercisesForDb = sessionExercises.map(
      ({ localId: _l, checked, sourceWorkoutName, ...ex }) => ({
        ...ex,
        completed: checked,
        source_workout_name: sourceWorkoutName ?? null,
      }),
    );

    const { error } = await supabase
      .from('workout_completions')
      .update({
        ended_at: endedAt,
        duration_seconds: durationSeconds,
        session_exercises: sessionExercisesForDb,
      })
      .eq('id', inProgress.id);

    setEnding(false);
    if (error) { Alert.alert('Error', error.message); return; }

    setInProgress(null);
    router.replace({
      pathname: '/workout-summary',
      params: {
        completionId: inProgress.id,
        durationSeconds: String(durationSeconds),
        workoutName,
      },
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  function confirmDelete() {
    Alert.alert(
      'Delete Workout',
      "Are you sure you want to delete this workout? This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteWorkout },
      ],
    );
  }

  async function deleteWorkout() {
    const { error } = await supabase.from('workouts').delete().eq('id', id);
    if (error) { Alert.alert('Error', error.message); return; }
    if (session) patchCalendarAfterDelete(session.user.id, id as string);
    router.back();
  }

  const isPlacementSelected = (p: Placement) => {
    if (placement.kind === 'category' && p.kind === 'category') return placement.value === p.value;
    if (placement.kind === 'folder' && p.kind === 'folder') return placement.id === p.id;
    return false;
  };

  const placementLabel = placement.kind === 'category' ? placement.value : placement.name;

  // ── Loading / not-found ────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  if (notFound) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}><Text style={styles.errorText}>Workout not found.</Text></View>
      </SafeAreaView>
    );
  }

  // ── Read-only view ─────────────────────────────────────────────────────────

  if (!isEditing) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen
          options={{
            title: workoutName,
            headerRight: () => (
              <TouchableOpacity onPress={() => setIsEditing(true)} hitSlop={12}>
                <Text style={styles.headerBtn}>Edit</Text>
              </TouchableOpacity>
            ),
          }}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Cover image */}
          {coverUrl && (
            <Image source={{ uri: coverUrl }} style={styles.coverImage} />
          )}

          {/* Category + visibility badges */}
          <View style={styles.readMeta}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>{placementLabel}</Text>
            </View>
            <View style={[styles.visibilityBadge, isPublic && styles.visibilityBadgePublic]}>
              <Text style={[styles.visibilityBadgeText, isPublic && styles.visibilityBadgeTextPublic]}>
                {isPublic ? 'Public' : 'Private'}
              </Text>
            </View>
          </View>

          {/* Exercises (read-only, only shown when NOT in a session) */}
          {!inProgress && (
            <View style={styles.readSection}>
              <Text style={styles.sectionLabel}>EXERCISES</Text>
              {exercises.map((ex, i) => (
                <View key={ex.id} style={styles.readCard}>
                  <Text style={styles.readCardNum}>{i + 1}</Text>
                  <View style={styles.readCardBody}>
                    <Text style={styles.readCardName}>{ex.name}</Text>
                    {!!formatExerciseMeta(ex) && (
                      <Text style={styles.readCardMeta}>{formatExerciseMeta(ex)}</Text>
                    )}
                    {!!ex.notes && <Text style={styles.readCardNotes}>{ex.notes}</Text>}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Notes (only when not in session) */}
          {!inProgress && !!workoutNotes && (
            <View style={styles.readSection}>
              <Text style={styles.sectionLabel}>NOTES</Text>
              <Text style={styles.readNotes}>{workoutNotes}</Text>
            </View>
          )}

          {/* ── Active session ── */}
          {inProgress ? (
            <View style={styles.activeSection}>
              {/* Timer header */}
              <View style={styles.activeHeader}>
                <View style={styles.activeDot} />
                <Text style={styles.activeLabel}>IN PROGRESS</Text>
              </View>
              <Text style={styles.timerDisplay}>{formatElapsed(elapsedSeconds)}</Text>

              {/* Exercise checklist */}
              <Text style={styles.sectionLabel}>EXERCISES</Text>
              {sessionExercises.map(ex => (
                <TouchableOpacity
                  key={ex.localId}
                  style={styles.checkItem}
                  onPress={() => toggleExercise(ex.localId)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, ex.checked && styles.checkboxChecked]}>
                    {ex.checked && <Text style={styles.checkboxTick}>✓</Text>}
                  </View>
                  <View style={styles.checkItemBody}>
                    <Text style={[styles.checkItemName, ex.checked && styles.checkItemNameDone]}>
                      {ex.name}
                    </Text>
                    {!!formatSessionExMeta(ex) && (
                      <Text style={styles.checkItemMeta}>{formatSessionExMeta(ex)}</Text>
                    )}
                    {!!ex.sourceWorkoutName && (
                      <Text style={styles.checkItemSource}>from {ex.sourceWorkoutName}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}

              {/* Add exercise from library */}
              <TouchableOpacity
                style={styles.addExerciseBtn}
                onPress={openExercisePicker}
                activeOpacity={0.7}
              >
                <Text style={styles.addExerciseBtnText}>+ Add Exercise</Text>
              </TouchableOpacity>

              {/* End button */}
              <TouchableOpacity
                style={[styles.endButton, ending && styles.buttonDisabled]}
                onPress={handleEndWorkout}
                disabled={ending}
              >
                {ending
                  ? <ActivityIndicator color={colors.accentFg} />
                  : <Text style={styles.endButtonText}>End Workout</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.startButton, starting && styles.buttonDisabled]}
              onPress={handleStartWorkout}
              disabled={starting}
            >
              {starting
                ? <ActivityIndicator color={colors.accentFg} />
                : <Text style={styles.startButtonText}>Start Workout</Text>}
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.deleteButton} onPress={confirmDelete}>
            <Text style={styles.deleteButtonText}>Delete Workout</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* ── Add-exercise-from-library modal ── */}
        <Modal
          visible={showExercisePicker}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowExercisePicker(false)}
        >
          <SafeAreaView style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Exercise</Text>
              <TouchableOpacity onPress={() => setShowExercisePicker(false)} hitSlop={12}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {loadingPicker ? (
              <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
            ) : libraryExercises.length === 0 ? (
              <View style={styles.centered}>
                <Text style={styles.errorText}>No other saved workouts to pull from.</Text>
              </View>
            ) : (
              <ScrollView
                contentContainerStyle={styles.pickerList}
                showsVerticalScrollIndicator={false}
              >
                {libraryExercises.map(item => (
                  <TouchableOpacity
                    key={item.key}
                    style={styles.pickerItem}
                    onPress={() => addExerciseToSession(item)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.pickerItemBody}>
                      <Text style={styles.pickerItemName}>{item.exercise.name}</Text>
                      {!!formatSessionExMeta(item.exercise as unknown as SessionExercise) && (
                        <Text style={styles.pickerItemMeta}>
                          {formatSessionExMeta(item.exercise as unknown as SessionExercise)}
                        </Text>
                      )}
                      <Text style={styles.pickerItemSource}>from {item.workoutName}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>

      </SafeAreaView>
    );
  }

  // ── Edit view ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Edit Workout',
          headerRight: () => (
            <TouchableOpacity onPress={handleCancel} hitSlop={12}>
              <Text style={styles.headerBtn}>Cancel</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Cover image picker */}
        <TouchableOpacity
          style={styles.coverPicker}
          onPress={handleCoverPress}
          disabled={uploadingCover}
          activeOpacity={0.8}
        >
          {coverUrl ? (
            <Image source={{ uri: coverUrl }} style={styles.coverPickerImage} />
          ) : uploadingCover ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={styles.coverPickerText}>+ Add Cover Image (optional)</Text>
          )}
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WORKOUT NAME</Text>
          <TextInput
            style={styles.workoutNameInput}
            placeholder="Workout name"
            placeholderTextColor={colors.textMuted}
            value={workoutName}
            onChangeText={setWorkoutName}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CATEGORY</Text>
          <TouchableOpacity
            style={styles.dropdownButton}
            onPress={() => setShowCategoryPicker(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.dropdownButtonText}>{placementLabel}</Text>
            <Text style={styles.dropdownArrow}>▾</Text>
          </TouchableOpacity>
        </View>

        {/* ── Share to Feed toggle ── */}
        <View style={styles.shareRow}>
          <View style={styles.shareText}>
            <Text style={styles.shareLabel}>Share to Discover Feed</Text>
            <Text style={styles.shareHint}>
              {isPublic
                ? 'Visible to all Plyo users — toggle off to keep private'
                : 'Only visible to you'}
            </Text>
          </View>
          <Switch
            value={isPublic}
            onValueChange={setIsPublic}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={isPublic ? colors.accentFg : colors.textMuted}
            ios_backgroundColor={colors.border}
          />
        </View>

        {exercises.map((ex, i) => (
          <ExerciseCard
            key={ex.id}
            index={i}
            exercise={ex}
            onChange={(field, value) => updateField(ex.id, field, value)}
            onDelete={() => deleteExercise(ex.id)}
          />
        ))}

        <TouchableOpacity style={styles.addButton} onPress={addExercise}>
          <Text style={styles.addButtonText}>+ Add Exercise</Text>
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WORKOUT NOTES</Text>
          <TextInput
            style={[styles.textInput, styles.multilineInput]}
            placeholder="Overall notes (optional)"
            placeholderTextColor={colors.textMuted}
            value={workoutNotes}
            onChangeText={setWorkoutNotes}
            multiline
          />
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color={colors.accentFg} />
            : <Text style={styles.primaryButtonText}>Save Changes</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteButton} onPress={confirmDelete}>
          <Text style={styles.deleteButtonText}>Delete Workout</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Category picker modal (edit mode) ── */}
      <Modal
        visible={showCategoryPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCategoryPicker(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Category</Text>
            <TouchableOpacity onPress={() => setShowCategoryPicker(false)} hitSlop={12}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.pickerList} showsVerticalScrollIndicator={false}>
            <Text style={styles.pickerSectionLabel}>CATEGORIES</Text>
            {WORKOUT_CATEGORIES.map(cat => {
              const p: Placement = { kind: 'category', value: cat };
              const selected = isPlacementSelected(p);
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.pickerItem, selected && styles.pickerItemSelected]}
                  onPress={() => { setPlacement(p); setShowCategoryPicker(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pickerItemText, selected && styles.pickerItemTextSelected]}>
                    {cat}
                  </Text>
                  {selected && <Text style={styles.pickerItemCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
            {folders.length > 0 && (
              <>
                <Text style={[styles.pickerSectionLabel, { marginTop: 16 }]}>MY FOLDERS</Text>
                {folders.map(folder => {
                  const p: Placement = { kind: 'folder', id: folder.id, name: folder.name };
                  const selected = isPlacementSelected(p);
                  return (
                    <TouchableOpacity
                      key={folder.id}
                      style={[styles.pickerItem, selected && styles.pickerItemSelected]}
                      onPress={() => { setPlacement(p); setShowCategoryPicker(false); }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.pickerItemText, selected && styles.pickerItemTextSelected]}>
                        {folder.name}
                      </Text>
                      {selected && <Text style={styles.pickerItemCheck}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Module-level helpers ────────────────────────────────────────────────────

// Schedules a reminder 40 minutes after the workout starts.
// Non-critical: any error is swallowed so the workout flow is never interrupted.
async function scheduleWorkoutReminder(workoutId: string, workoutName: string) {
  try {
    // Respect the user's notification preference set in Settings → Notifications.
    const pref = await SecureStore.getItemAsync('notification_workout_reminder');
    if (pref === 'false') return;

    const { status } = await Notifications.getPermissionsAsync();
    let granted = status === 'granted';
    if (!granted) {
      const { status: requested } = await Notifications.requestPermissionsAsync();
      granted = requested === 'granted';
    }
    if (!granted) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Workout in progress',
        body: `${workoutName} is still running — tap to return.`,
        data: { workoutId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 40 * 60,
        repeats: false,
      },
    });
  } catch {
    // Silently ignore — notifications are a convenience, not a critical path.
  }
}

async function patchCalendarAfterDelete(userId: string, deletedWorkoutId: string) {
  const weekStart = getWeekStart();
  const { data: row } = await supabase
    .from('weekly_plans')
    .select('plan')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .maybeSingle();

  if (!row?.plan?.days) return;

  const days = row.plan.days as Array<{
    day: string; type: string; workout_id?: string; [key: string]: unknown;
  }>;
  if (!days.some(d => d.workout_id === deletedWorkoutId)) return;

  const updatedDays = days.map(d =>
    d.workout_id === deletedWorkoutId ? { day: d.day, type: 'rest' } : d,
  );
  await supabase
    .from('weekly_plans')
    .update({ plan: { ...row.plan, days: updatedDays } })
    .eq('user_id', userId)
    .eq('week_start', weekStart);
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 120 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  errorText: { color: colors.textSecondary, fontSize: 16 },
  headerBtn: { color: colors.accent, fontSize: 15, fontWeight: '600' },

  // Cover image
  coverImage: { width: '100%', height: 180, borderRadius: radius.md, backgroundColor: colors.bgCard },
  coverPicker: {
    height: 140, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    borderStyle: 'dashed', backgroundColor: colors.bgCard,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  coverPickerImage: { width: '100%', height: '100%' },
  coverPickerText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },

  // ── Read-only ────────────────────────────────────────────────────────────
  readMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  categoryBadge: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: 4,
  },
  categoryBadgeText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  visibilityBadge: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: 4,
  },
  visibilityBadgePublic: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  visibilityBadgeText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  visibilityBadgeTextPublic: { color: colors.accent },

  // Category dropdown button
  dropdownButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 14,
  },
  dropdownButtonText: { color: colors.textPrimary, fontSize: 15, fontWeight: '500', flex: 1 },
  dropdownArrow: { color: colors.textMuted, fontSize: 18, marginLeft: spacing.sm },

  // Category picker modal content
  pickerSectionLabel: {
    color: colors.textMuted, fontSize: 11, fontWeight: '600',
    letterSpacing: 1.5, marginBottom: spacing.sm,
  },
  pickerItemSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  pickerItemText: { color: colors.textPrimary, fontSize: 15 },
  pickerItemTextSelected: { color: colors.accent, fontWeight: '600' },
  pickerItemCheck: { color: colors.accent, fontSize: 15, fontWeight: '700' },

  // Share toggle (edit mode)
  shareRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    gap: spacing.lg,
  },
  shareText: { flex: 1, gap: 3 },
  shareLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  shareHint: { color: colors.textMuted, fontSize: 12 },
  readSection: { gap: spacing.sm },
  readCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, gap: spacing.md,
  },
  readCardNum: {
    color: colors.textMuted, fontSize: 13, fontWeight: '700',
    width: 20, textAlign: 'center', paddingTop: 2,
  },
  readCardBody: { flex: 1, gap: 4 },
  readCardName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  readCardMeta: { color: colors.textSecondary, fontSize: 13 },
  readCardNotes: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  readNotes: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },

  // ── Active session ───────────────────────────────────────────────────────
  activeSection: { gap: spacing.md },
  activeHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  activeLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  timerDisplay: {
    color: colors.accent, fontSize: 48, fontWeight: '200',
    letterSpacing: 2, fontVariant: ['tabular-nums'],
  },

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
  checkItemNameDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  checkItemMeta: { color: colors.textMuted, fontSize: 12 },
  checkItemSource: { color: colors.accent, fontSize: 11, fontWeight: '600' },

  addExerciseBtn: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    borderStyle: 'dashed', paddingVertical: 12, alignItems: 'center',
  },
  addExerciseBtnText: { color: colors.accent, fontSize: 14, fontWeight: '600' },

  endButton: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: 16, alignItems: 'center',
  },
  endButtonText: { color: colors.accentFg, fontSize: 16, fontWeight: '700' },

  startButton: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: 16, alignItems: 'center',
  },
  startButtonText: { color: colors.accentFg, fontSize: 16, fontWeight: '700' },

  // ── Exercise library modal ───────────────────────────────────────────────
  modal: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  modalClose: { color: colors.textMuted, fontSize: 18 },
  pickerList: { padding: spacing.xl, gap: spacing.sm, paddingBottom: 48 },
  pickerItem: {
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
  },
  pickerItemBody: { gap: 3 },
  pickerItemName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  pickerItemMeta: { color: colors.textSecondary, fontSize: 12 },
  pickerItemSource: { color: colors.accent, fontSize: 11, fontWeight: '600' },

  // ── Shared ───────────────────────────────────────────────────────────────
  sectionLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1.5 },
  subLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 1.2, marginTop: spacing.sm },

  // ── Edit mode ────────────────────────────────────────────────────────────
  section: { gap: spacing.sm },
  workoutNameInput: {
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 14,
    fontSize: 16, fontWeight: '600', color: colors.textPrimary,
  },
  options: { gap: spacing.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  optionText: { color: colors.textPrimary, fontSize: 15 },
  optionTextSelected: { color: colors.accent, fontWeight: '600' },
  checkmark: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  textInput: {
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 14, color: colors.textPrimary,
  },
  multilineInput: { minHeight: 64 },
  addButton: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    borderStyle: 'dashed', paddingVertical: 14, alignItems: 'center',
  },
  addButtonText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  primaryButton: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: 16, alignItems: 'center', marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: colors.accentFg, fontSize: 16, fontWeight: '700' },
  deleteButton: {
    borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md,
    paddingVertical: 14, alignItems: 'center',
  },
  deleteButtonText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
});
