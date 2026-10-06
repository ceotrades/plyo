import { useState, useEffect } from 'react';
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
  Switch,
  Modal,
  Image,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { pickImage, uploadBase64Image } from '../../utils/imageUpload';
import { supabase } from '../../services/supabase';
import { useSession } from '../../utils/auth';
import { colors, spacing, radius } from '../../constants/theme';
import {
  WORKOUT_CATEGORIES,
  type Placement,
  guessCategory,
} from '../../constants/categories';
import {
  type RawExercise,
  type Exercise,
  toEditable,
  blankExercise,
  toDbRow,
  ExerciseCard,
  generateWorkoutTitle,
} from '../../components/ExerciseEditor';

type Folder = { id: string; name: string };

export default function ReviewScreen() {
  const { workout: workoutParam } = useLocalSearchParams<{ workout: string }>();
  const { session } = useSession();

  const [exercises, setExercises] = useState<Exercise[]>(() => {
    const parsed = JSON.parse(workoutParam ?? '{"exercises":[]}');
    return (parsed.exercises as RawExercise[]).map(toEditable);
  });

  const [workoutName, setWorkoutName] = useState<string>(() => {
    const parsed = JSON.parse(workoutParam ?? '{"exercises":[]}');
    return generateWorkoutTitle(parsed.exercises ?? []);
  });

  const [workoutNotes, setWorkoutNotes] = useState<string>(() => {
    const parsed = JSON.parse(workoutParam ?? '{}');
    return parsed.notes ?? '';
  });

  const [isPublic, setIsPublic] = useState(true); // on by default — opt-out to keep private
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);

  const [placement, setPlacement] = useState<Placement>(() => {
    const parsed = JSON.parse(workoutParam ?? '{"exercises":[]}');
    return { kind: 'category', value: guessCategory(parsed.exercises ?? []) };
  });

  const [folders, setFolders] = useState<Folder[]>([]);
  const [saving, setSaving] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  // null = still loading; false = hasn't seen it; true = has seen it
  const [hasSeenExplainer, setHasSeenExplainer] = useState<boolean | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);

  useEffect(() => {
    if (!session) return;
    // Load folders and the sharing-explainer flag in parallel
    Promise.all([
      supabase.from('folders').select('id, name').eq('user_id', session.user.id).order('created_at'),
      supabase.from('user_profile').select('has_seen_sharing_explainer').eq('user_id', session.user.id).maybeSingle(),
    ]).then(([foldersRes, profileRes]) => {
      if (foldersRes.data) setFolders(foldersRes.data as Folder[]);
      setHasSeenExplainer(profileRes.data?.has_seen_sharing_explainer ?? false);
    });
  }, [session]);

  function updateField(id: string, field: keyof Exercise, value: string) {
    setExercises(prev => prev.map(ex => ex.id === id ? { ...ex, [field]: value } : ex));
  }

  function deleteExercise(id: string) {
    setExercises(prev => prev.filter(ex => ex.id !== id));
  }

  function addExercise() {
    setExercises(prev => [...prev, blankExercise()]);
  }

  async function handleSave() {
    if (!session) return;

    const named = exercises.filter(ex => ex.name.trim().length > 0);
    if (named.length === 0) {
      Alert.alert('No exercises', 'Add at least one exercise with a name.');
      return;
    }

    // Show the sharing explainer the first time a user saves any workout.
    // hasSeenExplainer === null means the profile is still loading — in that
    // case we skip the modal and save directly rather than blocking the user.
    if (hasSeenExplainer === false) {
      setShowExplainer(true);
      return;
    }

    await performSave();
  }

  // Called when the user taps "Got it" in the explainer modal.
  async function handleExplainerAcknowledged() {
    setShowExplainer(false);
    setHasSeenExplainer(true);
    // Mark as seen — fire and forget; local state is the source of truth.
    supabase
      .from('user_profile')
      .update({ has_seen_sharing_explainer: true })
      .eq('user_id', session!.user.id);
    await performSave();
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
      const url = await uploadBase64Image(
        picked.base64,
        `workouts/${session.user.id}/${Date.now()}`,
      );
      setCoverUrl(url);
    } catch (err) {
      Alert.alert('Upload failed', (err as Error).message);
    }
    setUploadingCover(false);
  }

  async function performSave() {
    setSaving(true);
    const named = exercises.filter(ex => ex.name.trim().length > 0);
    const { error } = await supabase.from('workouts').insert({
      user_id: session!.user.id,
      name: workoutName.trim() || null,
      exercises: named.map(toDbRow),
      notes: workoutNotes.trim() || null,
      category: placement.kind === 'category' ? placement.value : 'Other',
      folder_id: placement.kind === 'folder' ? placement.id : null,
      is_public: isPublic,
      cover_url: coverUrl,
    });
    setSaving(false);

    if (error) {
      Alert.alert('Save failed', error.message);
      return;
    }

    router.back();
  }

  const isSelected = (p: Placement) => {
    if (placement.kind === 'category' && p.kind === 'category') {
      return placement.value === p.value;
    }
    if (placement.kind === 'folder' && p.kind === 'folder') {
      return placement.id === p.id;
    }
    return false;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>Edit anything the AI got wrong, then save.</Text>

        {/* ── Cover image ── */}
        <TouchableOpacity
          style={styles.coverPicker}
          onPress={handleCoverPress}
          disabled={uploadingCover}
          activeOpacity={0.8}
        >
          {coverUrl ? (
            <Image source={{ uri: coverUrl }} style={styles.coverImage} />
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

        {/* ── Placement dropdown ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CATEGORY</Text>
          <TouchableOpacity
            style={styles.dropdownButton}
            onPress={() => setShowCategoryPicker(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.dropdownButtonText}>
              {placement.kind === 'category' ? placement.value : placement.name}
            </Text>
            <Text style={styles.dropdownArrow}>▾</Text>
          </TouchableOpacity>
        </View>

        {/* ── Share to Feed ── */}
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
          {saving ? (
            <ActivityIndicator color={colors.accentFg} />
          ) : (
            <Text style={styles.primaryButtonText}>Save Workout</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* ── Category / folder picker modal ── */}
      <Modal
        visible={showCategoryPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCategoryPicker(false)}
      >
        <SafeAreaView style={styles.pickerModal}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Select Category</Text>
            <TouchableOpacity onPress={() => setShowCategoryPicker(false)} hitSlop={12}>
              <Text style={styles.pickerClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            contentContainerStyle={styles.pickerList}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.pickerSectionLabel}>CATEGORIES</Text>
            {WORKOUT_CATEGORIES.map(cat => {
              const p: Placement = { kind: 'category', value: cat };
              const selected = isSelected(p);
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
                <Text style={[styles.pickerSectionLabel, { marginTop: spacing.lg }]}>
                  MY FOLDERS
                </Text>
                {folders.map(folder => {
                  const p: Placement = { kind: 'folder', id: folder.id, name: folder.name };
                  const selected = isSelected(p);
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

      {/* ── Sharing explainer — shown once, first time a workout is saved ── */}
      <Modal
        visible={showExplainer}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowExplainer(false)}
      >
        <SafeAreaView style={styles.explainerContainer}>
          <View style={styles.explainerContent}>
            <Text style={styles.explainerTitle}>Workouts are shared by default</Text>

            <Text style={styles.explainerBody}>
              When you save a workout, it's added to the community Discover feed
              so other Plyo athletes can find it and add it to their own libraries.
            </Text>

            <Text style={styles.explainerBody}>
              You can turn this off per-workout using the{' '}
              <Text style={styles.explainerEmphasis}>"Share to Discover Feed"</Text>
              {' '}toggle on this screen, or change it anytime from a saved
              workout's edit view.
            </Text>

            <View style={styles.explainerSpacer} />

            <TouchableOpacity
              style={[styles.explainerButton, saving && styles.explainerButtonDisabled]}
              onPress={handleExplainerAcknowledged}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color={colors.accentFg} />
                : <Text style={styles.explainerButtonText}>Got it — Save Workout</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.explainerDismiss}
              onPress={() => setShowExplainer(false)}
            >
              <Text style={styles.explainerDismissText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  coverPicker: {
    height: 160, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    borderStyle: 'dashed', backgroundColor: colors.bgCard,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  coverImage: { width: '100%', height: '100%' },
  coverPickerText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },

  // Category dropdown
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  dropdownButtonText: { color: colors.textPrimary, fontSize: 15, fontWeight: '500', flex: 1 },
  dropdownArrow: { color: colors.textMuted, fontSize: 18, marginLeft: spacing.sm },

  // Category picker modal
  pickerModal: { flex: 1, backgroundColor: colors.bg },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  pickerClose: { color: colors.textMuted, fontSize: 18 },
  pickerList: { padding: spacing.xl, gap: spacing.sm, paddingBottom: 48 },
  pickerSectionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pickerItemSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  pickerItemText: { color: colors.textPrimary, fontSize: 15 },
  pickerItemTextSelected: { color: colors.accent, fontWeight: '600' },
  pickerItemCheck: { color: colors.accent, fontSize: 15, fontWeight: '700' },

  // Sharing explainer modal
  explainerContainer: { flex: 1, backgroundColor: colors.bg },
  explainerContent: {
    flex: 1,
    padding: spacing.xl,
    paddingTop: spacing.xxl,
    gap: spacing.lg,
  },
  explainerTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
  },
  explainerBody: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 23,
  },
  explainerEmphasis: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  explainerSpacer: { flex: 1 },
  explainerButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  explainerButtonDisabled: { opacity: 0.6 },
  explainerButtonText: {
    color: colors.accentFg,
    fontSize: 16,
    fontWeight: '700',
  },
  explainerDismiss: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  explainerDismissText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  hint: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  section: { gap: spacing.sm },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
  },
  subLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.2,
    marginTop: spacing.sm,
  },
  workoutNameInput: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  options: { gap: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  optionText: { color: colors.textPrimary, fontSize: 15 },
  optionTextSelected: { color: colors.accent, fontWeight: '600' },
  checkmark: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  textInput: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.textPrimary,
  },
  multilineInput: { minHeight: 64 },
  addButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    paddingVertical: 14,
    alignItems: 'center',
  },
  addButtonText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: colors.accentFg, fontSize: 16, fontWeight: '700' },

  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.lg,
  },
  shareText: { flex: 1, gap: 3 },
  shareLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  shareHint: { color: colors.textMuted, fontSize: 12 },
});
