import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../../services/supabase';
import { useSession } from '../../utils/auth';
import { colors, spacing, radius } from '../../constants/theme';

type PRRecord = {
  id: string;
  exercise_name: string;
  record_type: string;
  value: number;
  unit: string;
  achieved_at: string;
};

function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function recordTypeLabel(type: string): string {
  switch (type) {
    case 'max_reps':         return 'Most Reps';
    case 'longest_duration': return 'Longest Duration';
    case 'max_weight':       return 'Max Weight';
    case 'best_time':        return 'Best Time';
    default:                 return type;
  }
}

function formatValue(value: number, unit: string): string {
  if (unit === 'seconds') {
    if (value >= 60) return `${Math.floor(value / 60)}m ${value % 60}s`;
    return `${value}s`;
  }
  return `${value} ${unit}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function PersonalRecordsScreen() {
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PRRecord[]>([]);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('personal_records')
      .select('id, exercise_name, record_type, value, unit, achieved_at')
      .eq('user_id', session.user.id)
      .order('exercise_name', { ascending: true })
      .order('record_type', { ascending: true })
      .then(({ data }) => {
        setRecords((data ?? []) as PRRecord[]);
        setLoading(false);
      });
  }, [session]);

  // Group by exercise_name
  const grouped = records.reduce<Record<string, PRRecord[]>>((acc, pr) => {
    const key = pr.exercise_name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(pr);
    return acc;
  }, {});

  const exerciseNames = Object.keys(grouped).sort();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : exerciseNames.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No personal records yet</Text>
            <Text style={styles.emptyBody}>
              Complete the same exercise twice to start tracking PRs. The first session
              sets your baseline; the second can beat it.
            </Text>
          </View>
        ) : (
          exerciseNames.map(name => (
            <View key={name} style={styles.exerciseGroup}>
              <Text style={styles.exerciseName}>{toTitleCase(name)}</Text>
              {grouped[name].map(pr => (
                <View key={pr.id} style={styles.prRow}>
                  <View style={styles.prRowLeft}>
                    <Text style={styles.prTypeLabel}>{recordTypeLabel(pr.record_type)}</Text>
                    <Text style={styles.prDate}>{formatDate(pr.achieved_at)}</Text>
                  </View>
                  <Text style={styles.prValue}>{formatValue(pr.value, pr.unit)}</Text>
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 200 },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: 48 },

  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.md },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  emptyBody: {
    color: colors.textSecondary, fontSize: 14, textAlign: 'center',
    lineHeight: 20, maxWidth: 300,
  },

  exerciseGroup: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  exerciseName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  prRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  prRowLeft: { gap: 2 },
  prTypeLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  prDate: { color: colors.textMuted, fontSize: 11 },
  prValue: { color: colors.accent, fontSize: 18, fontWeight: '700' },
});
