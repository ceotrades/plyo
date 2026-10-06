import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Linking,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { colors, spacing, radius } from '../../constants/theme';

const PREF_KEY = 'notification_workout_reminder';

export default function NotificationsScreen() {
  const [permissionStatus, setPermissionStatus] = useState<string>('loading');
  const [workoutReminderEnabled, setWorkoutReminderEnabled] = useState(true);

  useEffect(() => {
    Notifications.getPermissionsAsync().then(({ status }) => setPermissionStatus(status));
    SecureStore.getItemAsync(PREF_KEY).then(value => {
      // Default is enabled (null means never set → treat as true)
      setWorkoutReminderEnabled(value !== 'false');
    });
  }, []);

  async function toggleWorkoutReminder(value: boolean) {
    setWorkoutReminderEnabled(value);
    await SecureStore.setItemAsync(PREF_KEY, value ? 'true' : 'false');
    if (!value) {
      // Cancel any pending workout reminder if the user turns it off
      await Notifications.cancelAllScheduledNotificationsAsync();
    }
  }

  const isGranted = permissionStatus === 'granted';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Permission status banner */}
        {!isGranted && permissionStatus !== 'loading' && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Notifications are currently disabled for Plyo. Enable them in your device settings to receive workout reminders.
            </Text>
            <TouchableOpacity
              style={styles.bannerButton}
              onPress={() => Linking.openSettings()}
            >
              <Text style={styles.bannerButtonText}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Workout reminders */}
        <Text style={styles.sectionHeader}>WORKOUT REMINDERS</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>Workout timer reminder</Text>
              <Text style={styles.rowSub}>
                Notifies you 40 minutes after starting a workout if you haven't ended it yet.
              </Text>
            </View>
            <Switch
              value={workoutReminderEnabled && isGranted}
              onValueChange={isGranted ? toggleWorkoutReminder : undefined}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={workoutReminderEnabled && isGranted ? colors.accentFg : colors.textMuted}
              ios_backgroundColor={colors.border}
              disabled={!isGranted}
            />
          </View>
        </View>

        {/* Future placeholders */}
        <Text style={styles.sectionHeader}>COMING SOON</Text>
        <View style={styles.group}>
          {['Weekly plan reminders', 'Streak alerts', 'Community activity'].map((label, i) => (
            <View key={label} style={[styles.row, i > 0 && styles.rowBorder, styles.rowDisabled]}>
              <Text style={styles.rowLabelMuted}>{label}</Text>
              <Switch
                value={false}
                disabled
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.textMuted}
                ios_backgroundColor={colors.border}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: 48 },

  banner: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  bannerText: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  bannerButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  bannerButtonText: { color: colors.accentFg, fontSize: 14, fontWeight: '700' },

  sectionHeader: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
  },
  group: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowDisabled: { opacity: 0.45 },
  rowBody: { flex: 1, gap: 3 },
  rowLabel: { color: colors.textPrimary, fontSize: 15 },
  rowLabelMuted: { color: colors.textSecondary, fontSize: 15, flex: 1 },
  rowSub: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
});
