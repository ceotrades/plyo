import { useState, useCallback, useRef } from 'react';
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
  Image,
} from 'react-native';
import ExtractionModal from '../../../components/ExtractionModal';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../../../services/supabase';
import { useSession } from '../../../utils/auth';
import { type PickedImage, pickImage, uploadBase64Image } from '../../../utils/imageUpload';
import { colors, spacing, radius } from '../../../constants/theme';
import { WORKOUT_CATEGORIES } from '../../../constants/categories';
import { fetchWorkoutStats } from '../../../utils/workoutStats';

type Folder = { id: string; name: string; cover_url?: string | null };
type WorkoutSummary = { category: string | null; folder_id: string | null };

export default function HomeScreen() {
  const { session } = useSession();

  // Extraction
  const [url, setUrl] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [modalStage, setModalStage] = useState(0);
  const [modalError, setModalError] = useState<string | null>(null);
  const stageTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Greeting
  const [username, setUsername] = useState<string | null>(null);

  // Library
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});

  const [actionRatio, setActionRatio] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);

  // Create-folder inline form
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [pendingFolderCover, setPendingFolderCover] = useState<PickedImage | null>(null);
  const [savingFolder, setSavingFolder] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      loadData();
    }, [session]),
  );

  async function loadData() {
    setLoadingLibrary(true);
    const [profileRes, workoutsRes, foldersRes] = await Promise.all([
      supabase
        .from('user_profile')
        .select('username')
        .eq('user_id', session!.user.id)
        .maybeSingle(),
      supabase
        .from('workouts')
        .select('category, folder_id')
        .eq('user_id', session!.user.id),
      supabase
        .from('folders')
        .select('id, name, cover_url')
        .eq('user_id', session!.user.id)
        .order('created_at'),
    ]);

    setUsername(profileRes.data?.username ?? null);

    const folderList: Folder[] = foldersRes.data ?? [];
    const workouts: WorkoutSummary[] = workoutsRes.data ?? [];

    const catCounts: Record<string, number> = {};
    const fdrCounts: Record<string, number> = {};
    for (const w of workouts) {
      if (w.folder_id) {
        fdrCounts[w.folder_id] = (fdrCounts[w.folder_id] ?? 0) + 1;
      } else {
        const cat = w.category ?? 'Other';
        catCounts[cat] = (catCounts[cat] ?? 0) + 1;
      }
    }

    const stats = await fetchWorkoutStats(session!.user.id, workouts.length);
    setActionRatio(stats.actionRatio);
    setStreak(stats.streak);

    setFolders(folderList);
    setCategoryCounts(catCounts);
    setFolderCounts(fdrCounts);
    setLoadingLibrary(false);
  }

  async function handleExtract() {
    const trimmed = url.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Please paste a TikTok or Instagram Reel URL.');
      return;
    }

    const isTikTok =
      trimmed.includes('tiktok.com') ||
      trimmed.includes('vm.tiktok.com') ||
      trimmed.includes('vt.tiktok.com');
    const isInstagram =
      trimmed.includes('instagram.com') || trimmed.includes('instagr.am');
    if (!isTikTok && !isInstagram) {
      Alert.alert('Unsupported link', 'Paste a TikTok video link or an Instagram Reel link.');
      return;
    }

    // Show the progress modal immediately.
    setModalVisible(true);
    setModalStage(0);
    setModalError(null);

    // Simulate stage advancement with timers. These are best-estimate durations;
    // the real function result (success or error) always takes precedence.
    //   Stage 0 "Finding video"   ~0–4 s
    //   Stage 1 "Extracting audio" ~4–10 s
    //   Stage 2 "Transcribing"    ~10–33 s (Whisper is the longest step)
    //   Stage 3 "Building workout" shown until the function actually returns
    stageTimers.current = [
      setTimeout(() => setModalStage(1), 4000),
      setTimeout(() => setModalStage(2), 10000),
      setTimeout(() => setModalStage(3), 33000),
    ];

    const { data, error } = await supabase.functions.invoke('extract-workout', {
      body: { url: trimmed },
    });

    // Clear timers — the real result is in.
    stageTimers.current.forEach(clearTimeout);
    stageTimers.current = [];

    if (error || !data) {
      setModalError(error?.message ?? 'Extraction failed. Please try again.');
      return;
    }

    // Flash "all done" briefly so every checkmark appears before navigating.
    setModalStage(4);
    const workoutJson = JSON.stringify(data.workout);

    setTimeout(() => {
      setModalVisible(false);
      setUrl('');
      router.push({ pathname: '/review', params: { workout: workoutJson } });
    }, 550);
  }

  function handleModalClose() {
    stageTimers.current.forEach(clearTimeout);
    stageTimers.current = [];
    setModalVisible(false);
    setModalError(null);
    setModalStage(0);
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setSavingFolder(true);

    const { data, error } = await supabase
      .from('folders')
      .insert({ user_id: session!.user.id, name })
      .select('id, name')
      .single();

    if (error || !data) {
      setSavingFolder(false);
      Alert.alert('Error', error?.message ?? 'Failed to create folder');
      return;
    }

    let coverUrl: string | null = null;
    if (pendingFolderCover) {
      try {
        coverUrl = await uploadBase64Image(
          pendingFolderCover.base64,
          `folders/${session!.user.id}/${data.id}`,
        );
        await supabase.from('folders').update({ cover_url: coverUrl }).eq('id', data.id);
      } catch {
        // Cover image upload failed — folder still created, just without a cover
      }
    }

    setSavingFolder(false);
    const newFolder: Folder = { ...data, cover_url: coverUrl };
    setFolders(prev => [...prev, newFolder]);
    setFolderCounts(prev => ({ ...prev, [newFolder.id]: 0 }));
    setNewFolderName('');
    setPendingFolderCover(null);
    setCreatingFolder(false);
  }

  function openCategory(cat: string) {
    router.push({ pathname: '/folder', params: { type: 'category', id: cat, name: cat } });
  }

  function openFolder(folder: Folder) {
    router.push({ pathname: '/folder', params: { type: 'custom', id: folder.id, name: folder.name } });
  }

  const emailPrefix = session?.user.email?.split('@')[0] ?? null;
  const displayName = username ?? emailPrefix;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Logo + Greeting ── */}
        <View style={styles.header}>
          <View style={styles.logo}>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>P</Text>
            </View>
            <Text style={styles.logoWordmark}>PLYO</Text>
          </View>
          <Text style={styles.greeting}>
            {'Welcome back'}
            {displayName != null ? (
              <Text>
                {', '}
                <Text style={styles.greetingName}>{displayName}</Text>
              </Text>
            ) : null}
          </Text>
        </View>

        {/* ── Extraction flow ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PASTE A WORKOUT LINK</Text>
          <TextInput
            style={styles.input}
            placeholder="TikTok or Instagram Reel URL…"
            placeholderTextColor={colors.textMuted}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TouchableOpacity
            style={[styles.primaryButton, modalVisible && styles.buttonDisabled]}
            onPress={handleExtract}
            disabled={modalVisible}
          >
            <Text style={styles.primaryButtonText}>Extract Workout</Text>
          </TouchableOpacity>
        </View>

        {/* ── Library ── */}
        {loadingLibrary ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
        ) : (
          <>
            {/* ── Stat cards: Action Ratio + Streak ── */}
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

            {/* Fixed categories */}
            <Text style={styles.sectionLabel}>CATEGORIES</Text>
            {WORKOUT_CATEGORIES.map(cat => {
              const count = categoryCounts[cat] ?? 0;
              return (
                <TouchableOpacity
                  key={cat}
                  style={styles.folderCard}
                  onPress={() => openCategory(cat)}
                  activeOpacity={0.7}
                >
                  <View style={styles.folderCardBody}>
                    <Text style={styles.folderCardName}>{cat}</Text>
                    <Text style={styles.folderCardCount}>
                      {count} {count === 1 ? 'workout' : 'workouts'}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              );
            })}

            {/* Custom folders */}
            <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>MY FOLDERS</Text>

            {folders.map(folder => {
              const count = folderCounts[folder.id] ?? 0;
              return (
                <TouchableOpacity
                  key={folder.id}
                  style={styles.folderCard}
                  onPress={() => openFolder(folder)}
                  activeOpacity={0.7}
                >
                  {!!folder.cover_url && (
                    <Image source={{ uri: folder.cover_url }} style={styles.folderCoverThumbnail} />
                  )}
                  <View style={styles.folderCardBody}>
                    <Text style={styles.folderCardName}>{folder.name}</Text>
                    <Text style={styles.folderCardCount}>
                      {count} {count === 1 ? 'workout' : 'workouts'}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              );
            })}

            {/* Create folder */}
            {creatingFolder ? (
              <View style={styles.newFolderCard}>
                {/* Optional cover photo for the folder */}
                <TouchableOpacity
                  style={styles.folderCoverPicker}
                  onPress={async () => {
                    const picked = await pickImage({ aspect: [1, 1] });
                    if (picked) setPendingFolderCover(picked);
                  }}
                  activeOpacity={0.8}
                >
                  {pendingFolderCover ? (
                    <Image source={{ uri: pendingFolderCover.uri }} style={styles.folderCoverPreview} />
                  ) : (
                    <Text style={styles.folderCoverPickerText}>+ Cover photo (optional)</Text>
                  )}
                </TouchableOpacity>

                <TextInput
                  style={styles.newFolderInput}
                  placeholder="Folder name"
                  placeholderTextColor={colors.textMuted}
                  value={newFolderName}
                  onChangeText={setNewFolderName}
                  autoFocus
                  maxLength={40}
                  returnKeyType="done"
                  onSubmitEditing={handleCreateFolder}
                />
                <View style={styles.newFolderRow}>
                  <TouchableOpacity
                    onPress={() => { setCreatingFolder(false); setNewFolderName(''); setPendingFolderCover(null); }}
                    hitSlop={8}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.createBtn, savingFolder && styles.createBtnDisabled]}
                    onPress={handleCreateFolder}
                    disabled={savingFolder}
                  >
                    {savingFolder
                      ? <ActivityIndicator size="small" color={colors.accentFg} />
                      : <Text style={styles.createBtnText}>Create</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.addFolderCard}
                onPress={() => setCreatingFolder(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.addFolderText}>+ New Folder</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>

      <ExtractionModal
        visible={modalVisible}
        currentStage={modalStage}
        error={modalError}
        onClose={handleModalClose}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.xl, paddingBottom: 48 },

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

  // Header
  header: { gap: spacing.sm, paddingTop: spacing.sm },
  logo: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  logoMark: {
    width: 30,
    height: 30,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoMarkText: { color: colors.accentFg, fontSize: 17, fontWeight: '900', fontStyle: 'italic' },
  logoWordmark: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', letterSpacing: 3 },
  greeting: { color: colors.textPrimary, fontSize: 22, fontWeight: '700', marginTop: spacing.xs },
  greetingName: { color: colors.accent },

  // Extraction section
  section: { gap: spacing.md },
  sectionLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1.5 },
  sectionLabelSpaced: { marginTop: spacing.xs },
  input: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.textPrimary,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: colors.accentFg, fontSize: 16, fontWeight: '700' },
  hint: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },

  // Folder grid
  folderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
  },
  folderCardBody: { flex: 1, gap: 3 },
  folderCardName: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  folderCardCount: { color: colors.textSecondary, fontSize: 13 },
  chevron: { color: colors.textMuted, fontSize: 20, fontWeight: '300' },

  // Create-folder form
  newFolderCard: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  folderCoverThumbnail: {
    width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.bgInput,
  },
  folderCoverPicker: {
    height: 80, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    borderStyle: 'dashed', backgroundColor: colors.bgInput,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  folderCoverPreview: { width: '100%', height: '100%' },
  folderCoverPickerText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  newFolderInput: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, paddingVertical: 4 },
  newFolderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.lg,
  },
  cancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  createBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    minWidth: 72,
    alignItems: 'center',
  },
  createBtnDisabled: { opacity: 0.6 },
  createBtnText: { color: colors.accentFg, fontSize: 14, fontWeight: '700' },

  addFolderCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    paddingVertical: 14,
    alignItems: 'center',
  },
  addFolderText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
