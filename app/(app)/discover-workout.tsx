import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { supabase } from '../../services/supabase';
import { useSession } from '../../utils/auth';
import { colors, spacing, radius } from '../../constants/theme';
import { type RawExercise, generateWorkoutTitle } from '../../components/ExerciseEditor';

// 'notes' is intentionally absent: the public_feed_workouts view strips both
// workout-level notes (not in SELECT) and exercise-level notes (removed from
// each JSONB object) before the data is transmitted to any client device.
type PublicWorkout = {
  id: string;
  name: string | null;
  exercises: RawExercise[];
  category: string | null;
  is_featured: boolean;
  user_id: string;
  cover_url: string | null;
};

function formatExerciseLine(ex: RawExercise): string {
  const parts: string[] = [];
  if (ex.sets) parts.push(`${ex.sets} sets`);
  if (ex.reps) parts.push(`× ${ex.reps} reps`);
  else if (ex.duration_seconds) parts.push(`× ${ex.duration_seconds}s`);
  if (ex.rest_seconds) parts.push(`· ${ex.rest_seconds}s rest`);
  return parts.join('  ');
}

export default function DiscoverWorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [workout, setWorkout] = useState<PublicWorkout | null>(null);
  const [creatorUsername, setCreatorUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    supabase
      .from('public_feed_workouts') // notes stripped at query level; view filters is_public = true
      .select('id, name, exercises, category, is_featured, user_id, cover_url')
      .eq('id', id)
      .single()
      .then(async ({ data, error }) => {
        if (error || !data) { setNotFound(true); setLoading(false); return; }
        setWorkout(data as PublicWorkout);

        // Fetch creator username
        const { data: profile } = await supabase
          .from('user_profile')
          .select('username')
          .eq('user_id', data.user_id)
          .maybeSingle();
        setCreatorUsername(profile?.username ?? null);
        setLoading(false);
      });
  }, [id]);

  async function handleSaveCopy() {
    if (!session || !workout) return;
    setSaving(true);
    const { data: copy, error } = await supabase
      .from('workouts')
      .insert({
        user_id: session.user.id,
        name: workout.name,
        exercises: workout.exercises,
        category: workout.category ?? 'Other',
        folder_id: null,
        notes: null, // original creator's notes are never copied; the new owner starts fresh
        is_public: true,
        is_featured: false,
      })
      .select('id')
      .single();
    setSaving(false);

    if (error || !copy) {
      Alert.alert('Error', error?.message ?? 'Failed to save workout');
      return;
    }

    Alert.alert(
      'Saved!',
      'Workout added to your library.',
      [
        {
          text: 'View in Library',
          onPress: () => router.replace(`/workout/${copy.id}`),
        },
        { text: 'OK' },
      ],
    );
  }

  const isOwn = workout?.user_id === session?.user.id;
  const displayName = workout?.name ?? (workout ? generateWorkoutTitle(workout.exercises) : '');
  const creatorLabel = workout?.is_featured
    ? 'Plyo · Featured'
    : creatorUsername
    ? `@${creatorUsername}`
    : 'Plyo user';

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  if (notFound || !workout) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Workout not available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Cover image */}
        {!!workout.cover_url && (
          <Image source={{ uri: workout.cover_url }} style={styles.coverImage} />
        )}

        {/* Header */}
        <View style={styles.header}>
          {workout.is_featured && (
            <View style={styles.featuredPill}>
              <Text style={styles.featuredPillText}>Featured</Text>
            </View>
          )}
          <Text style={styles.workoutName}>{displayName}</Text>
          <Text style={styles.creator}>{creatorLabel}</Text>
          {!!workout.category && workout.category !== 'Other' && (
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>{workout.category}</Text>
            </View>
          )}
        </View>

        {/* Exercises */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>EXERCISES</Text>
          {workout.exercises.map((ex, i) => (
            <View key={i} style={styles.exerciseRow}>
              <Text style={styles.exerciseNum}>{i + 1}</Text>
              <View style={styles.exerciseBody}>
                <Text style={styles.exerciseName}>{ex.name}</Text>
                {!!formatExerciseLine(ex) && (
                  <Text style={styles.exerciseMeta}>{formatExerciseLine(ex)}</Text>
                )}
                {/* exercise notes intentionally not shown in community feed */}
              </View>
            </View>
          ))}
        </View>

        {/* workout notes intentionally not shown in community feed */}

        {/* CTA */}
        {isOwn ? (
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => router.replace(`/workout/${workout.id}`)}
          >
            <Text style={styles.editButtonText}>Edit in My Library</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSaveCopy}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color={colors.accentFg} />
              : <Text style={styles.saveButtonText}>Save to My Library</Text>}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: colors.textSecondary, fontSize: 16 },
  content: { padding: spacing.xl, gap: spacing.xl, paddingBottom: 48 },

  coverImage: {
    width: '100%',
    height: 200,
    borderRadius: radius.md,
    backgroundColor: colors.bgCard,
  },
  header: { gap: spacing.sm },
  featuredPill: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  featuredPillText: { color: colors.accentFg, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  workoutName: { color: colors.textPrimary, fontSize: 24, fontWeight: '800' },
  creator: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  categoryBadge: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  categoryBadgeText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },

  section: { gap: spacing.sm },
  sectionLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1.5 },

  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  exerciseNum: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    width: 20,
    textAlign: 'center',
    paddingTop: 2,
  },
  exerciseBody: { flex: 1, gap: 4 },
  exerciseName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  exerciseMeta: { color: colors.textSecondary, fontSize: 13 },

  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: colors.accentFg, fontSize: 16, fontWeight: '700' },

  editButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  editButtonText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
});
