import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../../../services/supabase';
import { useSession } from '../../../utils/auth';
import { colors, spacing, radius } from '../../../constants/theme';
import { type RawExercise, generateWorkoutTitle } from '../../../components/ExerciseEditor';

type FeedItem = {
  id: string;
  name: string | null;
  exercises: RawExercise[];
  category: string | null;
  is_featured: boolean;
  user_id: string;
  created_at: string;
  username: string | null;
  avatar_url: string | null;
  cover_url: string | null;
};

function feedDisplayName(item: FeedItem): string {
  return item.name ?? generateWorkoutTitle(item.exercises);
}

function creatorLabel(item: FeedItem): string {
  if (item.is_featured) return 'Plyo · Featured';
  return item.username ? `@${item.username}` : 'Plyo user';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export default function DiscoverScreen() {
  const { session } = useSession();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      loadFeed();
    }, [session]),
  );

  async function loadFeed(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const { data: workouts, error } = await supabase
      .from('public_feed_workouts') // view strips workout notes + exercise notes at DB level
      .select('id, name, exercises, category, is_featured, user_id, created_at, cover_url')
      .order('is_featured', { ascending: false }) // featured content first
      .order('created_at', { ascending: false })
      .limit(60);

    if (error || !workouts) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    // Fetch usernames for all creators in this batch
    const userIds = [...new Set(workouts.map(w => w.user_id))];
    const { data: profiles } = await supabase
      .from('user_profile')
      .select('user_id, username, avatar_url')
      .in('user_id', userIds);

    const profileMap = Object.fromEntries(
      (profiles ?? []).map(p => [p.user_id, p as { username: string | null; avatar_url: string | null }]),
    );

    setFeed(
      workouts.map(w => ({
        ...w,
        exercises: (w.exercises ?? []) as RawExercise[],
        is_featured: w.is_featured ?? false,
        username: profileMap[w.user_id]?.username ?? null,
        avatar_url: profileMap[w.user_id]?.avatar_url ?? null,
        cover_url: (w as Record<string, unknown>).cover_url as string | null ?? null,
      })),
    );
    setLoading(false);
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadFeed(true)}
            tintColor={colors.accent}
          />
        }
      >
        <Text style={styles.heading}>Discover</Text>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : feed.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyBody}>
              Public workouts from the Plyo community will appear here.
              Share your own by enabling "Share to Feed" when saving a workout.
            </Text>
          </View>
        ) : (
          feed.map(item => (
            <TouchableOpacity
              key={item.id}
              style={[styles.card, item.is_featured && styles.cardFeatured]}
              onPress={() =>
                router.push({
                  pathname: '/discover-workout',
                  params: { id: item.id },
                })
              }
              activeOpacity={0.75}
            >
              {!!item.cover_url && (
                <Image
                  source={{ uri: item.cover_url }}
                  style={styles.cardCover}
                />
              )}
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {feedDisplayName(item)}
                </Text>
                {item.is_featured && (
                  <View style={styles.featuredPill}>
                    <Text style={styles.featuredPillText}>Featured</Text>
                  </View>
                )}
              </View>

              <View style={styles.cardMeta}>
                <Text style={styles.cardCreator}>{creatorLabel(item)}</Text>
                <Text style={styles.cardDot}>·</Text>
                <Text style={styles.cardMetaText}>
                  {item.exercises.length}{' '}
                  {item.exercises.length === 1 ? 'exercise' : 'exercises'}
                </Text>
                {!!item.category && item.category !== 'Other' && (
                  <>
                    <Text style={styles.cardDot}>·</Text>
                    <Text style={styles.cardMetaText}>{item.category}</Text>
                  </>
                )}
              </View>

              <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 200 },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: 48 },

  heading: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },

  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.md },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },

  card: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: 6,
  },
  cardFeatured: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  cardCover: {
    width: '100%',
    height: 160,
    borderRadius: radius.sm,
    backgroundColor: colors.bgInput,
    marginBottom: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  featuredPill: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  featuredPillText: {
    color: colors.accentFg,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  cardCreator: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  cardDot: { color: colors.textMuted, fontSize: 13 },
  cardMetaText: { color: colors.textSecondary, fontSize: 13 },
  cardDate: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
