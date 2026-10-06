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
  Image,
  Linking,
  Share,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { supabase } from '../../../services/supabase';
import { useSession } from '../../../utils/auth';
import { pickImage, uploadBase64Image } from '../../../utils/imageUpload';
import { colors, spacing, radius } from '../../../constants/theme';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

const GOALS = [
  'Complete a Hyrox',
  'Build muscle',
  'Lose weight',
  'Strength & conditioning',
  'HIIT & general fitness',
  'Running performance',
  'Hybrid athlete',
];

const EQUIPMENT = [
  'Full gym',
  'Home gym',
  'Kettlebells only',
  'Bodyweight only',
  'Running only',
];

type Field = 'username' | 'goal' | 'trainingDays' | 'equipment';

export default function ProfileScreen() {
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);

  // ── Authoritative state — mirrors what's saved in the DB. ────────────────
  // These are shown in read-only mode and only updated after a successful save.
  const [username, setUsername] = useState('');
  const [goal, setGoal] = useState('');
  const [trainingDays, setTrainingDays] = useState('');
  const [equipment, setEquipment] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // ── Draft state — only active while a field is being edited. ─────────────
  // Initialised from authoritative values when editing starts; discarded on cancel.
  const [draftUsername, setDraftUsername] = useState('');
  const [draftGoal, setDraftGoal] = useState('');
  const [draftTrainingDays, setDraftTrainingDays] = useState('');
  const [draftEquipment, setDraftEquipment] = useState<string[]>([]);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('user_profile')
      .select('username, goal, training_days, equipment, avatar_url')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setUsername(data.username ?? '');
          setGoal(data.goal ?? '');
          setTrainingDays(data.training_days ? String(data.training_days) : '');
          setEquipment(data.equipment ?? []);
          setAvatarUrl(data.avatar_url ?? null);
        }
        setLoading(false);
      });
  }, [session]);

  function startEdit(field: Field) {
    // Copy all authoritative values into drafts so every draft is fresh.
    setDraftUsername(username);
    setDraftGoal(goal);
    setDraftTrainingDays(trainingDays);
    setDraftEquipment([...equipment]);
    setEditingField(field);
  }

  async function confirmEdit() {
    if (!session || !editingField) return;

    if (editingField === 'goal' && !draftGoal) {
      Alert.alert('Please select a goal.');
      return;
    }
    if (editingField === 'trainingDays' && !draftTrainingDays) {
      Alert.alert('Please select training days.');
      return;
    }
    if (editingField === 'equipment' && draftEquipment.length === 0) {
      Alert.alert('Select at least one equipment option.');
      return;
    }

    // Only update the single field being edited — no risk of overwriting others.
    const updates: Record<string, unknown> =
      editingField === 'username'
        ? { username: draftUsername.trim() || null }
        : editingField === 'goal'
        ? { goal: draftGoal }
        : editingField === 'trainingDays'
        ? { training_days: parseInt(draftTrainingDays, 10) }
        : { equipment: draftEquipment };

    setSaving(true);
    const { error } = await supabase
      .from('user_profile')
      .update(updates)
      .eq('user_id', session.user.id);
    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    // Commit draft → authoritative only after DB write succeeds.
    if (editingField === 'username') setUsername(draftUsername.trim());
    else if (editingField === 'goal') setGoal(draftGoal);
    else if (editingField === 'trainingDays') setTrainingDays(draftTrainingDays);
    else if (editingField === 'equipment') setEquipment(draftEquipment);

    setEditingField(null);
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Error signing out', error.message);
  }

  const [deletingAccount, setDeletingAccount] = useState(false);

  const initial = (username?.[0] || session?.user.email?.[0] || '?').toUpperCase();

  async function handleReportBug() {
    const url = 'mailto:support@getstackd.fit?subject=Plyo%20-%20';
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      Linking.openURL(url);
    } else {
      Alert.alert('Email unavailable', 'Please email us at support@getstackd.fit');
    }
  }

  async function handleShareApp() {
    Share.share({
      message:
        'Check out Plyo — the app that turns workout videos into personalised training plans! https://apps.apple.com/app/plyo',
      title: 'Plyo',
    });
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all your data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: confirmDeleteAccount,
        },
      ],
    );
  }

  async function confirmDeleteAccount() {
    setDeletingAccount(true);
    const { error } = await supabase.functions.invoke('delete-account');
    if (error) {
      Alert.alert('Error', error.message);
      setDeletingAccount(false);
      return;
    }
    // Session is now invalid — sign out to clear local state and redirect to auth.
    await supabase.auth.signOut();
    setDeletingAccount(false);
  }

  function handleAvatarPress() {
    if (!avatarUrl) { doPickAvatar(); return; }
    Alert.alert(
      'Profile Photo',
      undefined,
      [
        { text: 'Change Photo', onPress: doPickAvatar },
        {
          text: 'Remove Photo',
          style: 'destructive',
          onPress: async () => {
            setAvatarUrl(null);
            await supabase
              .from('user_profile')
              .update({ avatar_url: null })
              .eq('user_id', session!.user.id);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  async function doPickAvatar() {
    if (!session) return;

    const picked = await pickImage();
    if (!picked) return;

    setAvatarUrl(picked.uri); // Show immediately
    setUploadingAvatar(true);

    try {
      const url = await uploadBase64Image(picked.base64, `avatars/${session.user.id}/avatar`);
      const { error } = await supabase
        .from('user_profile')
        .update({ avatar_url: url })
        .eq('user_id', session.user.id);
      if (error) throw new Error(error.message);
      setAvatarUrl(url);
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    }
    setUploadingAvatar(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Avatar ── */}
        <View style={styles.avatarRow}>
          <TouchableOpacity onPress={handleAvatarPress} disabled={uploadingAvatar} activeOpacity={0.8}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatar}>
                {uploadingAvatar
                  ? <ActivityIndicator color={colors.accentFg} />
                  : <Text style={styles.avatarText}>{initial}</Text>}
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              <Text style={styles.avatarEditBadgeText}>Edit</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.email}>
            {session?.user.created_at
              ? `Joined ${new Date(session.user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
              : ''}
          </Text>
        </View>

        {/* ── Display Name ── */}
        <View style={styles.field}>
          <FieldHeader
            label="DISPLAY NAME"
            editing={editingField === 'username'}
            saving={saving}
            onEdit={() => startEdit('username')}
            onDone={confirmEdit}
          />
          {editingField === 'username' ? (
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Sam"
              placeholderTextColor={colors.textMuted}
              value={draftUsername}
              onChangeText={setDraftUsername}
              autoCorrect={false}
              autoCapitalize="words"
              maxLength={30}
              autoFocus
            />
          ) : (
            <Text style={username ? styles.value : styles.valueEmpty}>
              {username || 'Not set'}
            </Text>
          )}
        </View>

        {/* ── Goal ── */}
        <View style={styles.field}>
          <FieldHeader
            label="GOAL"
            editing={editingField === 'goal'}
            saving={saving}
            onEdit={() => startEdit('goal')}
            onDone={confirmEdit}
          />
          {editingField === 'goal' ? (
            <View style={styles.options}>
              {GOALS.map(g => {
                const selected = draftGoal === g;
                return (
                  <TouchableOpacity
                    key={g}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => setDraftGoal(g)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                      {g}
                    </Text>
                    {selected && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={goal ? styles.value : styles.valueEmpty}>
              {goal || 'Not set'}
            </Text>
          )}
        </View>

        {/* ── Training Days ── */}
        <View style={styles.field}>
          <FieldHeader
            label="TRAINING DAYS / WEEK"
            editing={editingField === 'trainingDays'}
            saving={saving}
            onEdit={() => startEdit('trainingDays')}
            onDone={confirmEdit}
          />
          {editingField === 'trainingDays' ? (
            <View style={styles.daysGrid}>
              {[1, 2, 3, 4, 5, 6, 7].map(n => {
                const selected = draftTrainingDays === String(n);
                return (
                  <TouchableOpacity
                    key={n}
                    style={[styles.dayButton, selected && styles.dayButtonSelected]}
                    onPress={() => setDraftTrainingDays(String(n))}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dayButtonText, selected && styles.dayButtonTextSelected]}>
                      {n}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={trainingDays ? styles.value : styles.valueEmpty}>
              {trainingDays
                ? `${trainingDays} day${trainingDays === '1' ? '' : 's'} / week`
                : 'Not set'}
            </Text>
          )}
        </View>

        {/* ── Equipment ── */}
        <View style={styles.field}>
          <FieldHeader
            label="EQUIPMENT"
            editing={editingField === 'equipment'}
            saving={saving}
            onEdit={() => startEdit('equipment')}
            onDone={confirmEdit}
          />
          {editingField === 'equipment' ? (
            <View style={styles.options}>
              {EQUIPMENT.map(item => {
                const selected = draftEquipment.includes(item);
                return (
                  <TouchableOpacity
                    key={item}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() =>
                      setDraftEquipment(prev =>
                        prev.includes(item)
                          ? prev.filter(e => e !== item)
                          : [...prev, item]
                      )
                    }
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                      {item}
                    </Text>
                    {selected && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={equipment.length > 0 ? styles.value : styles.valueEmpty}>
              {equipment.length > 0 ? equipment.join(', ') : 'Not set'}
            </Text>
          )}
        </View>

        {/* ── Personal Records ── */}
        <TouchableOpacity
          style={styles.navLink}
          onPress={() => router.push('/personal-records')}
          activeOpacity={0.7}
        >
          <Text style={styles.navLinkText}>Personal Records</Text>
          <Text style={styles.navLinkArrow}>›</Text>
        </TouchableOpacity>

        {/* ── Settings ── */}
        <Text style={styles.settingsHeader}>GENERAL</Text>
        <View style={styles.settingsGroup}>
          <SettingRow icon="notifications-outline" label="Notifications" first
            onPress={() => router.push('/settings-notifications')} />
          <SettingRow icon="bug-outline" label="Report a Bug / Feature Request"
            onPress={handleReportBug} />
          <SettingRow icon="share-social-outline" label="Share App"
            onPress={handleShareApp} />
        </View>

        <Text style={styles.settingsHeader}>LEGAL</Text>
        <View style={styles.settingsGroup}>
          <SettingRow icon="document-text-outline" label="Terms of Service" first
            onPress={() => router.push('/settings-terms')} />
          <SettingRow icon="shield-checkmark-outline" label="Privacy Policy"
            onPress={() => router.push('/settings-privacy')} />
        </View>

        <Text style={styles.settingsHeader}>ACCOUNT</Text>
        <View style={styles.settingsGroup}>
          <SettingRow
            icon="trash-outline"
            label={deletingAccount ? 'Deleting…' : 'Delete Account'}
            first
            destructive
            onPress={deletingAccount ? undefined : handleDeleteAccount}
          />
          <SettingRow icon="log-out-outline" label="Sign Out" onPress={handleSignOut} />
        </View>

        <Text style={styles.appVersion}>Version {APP_VERSION}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── FieldHeader ──────────────────────────────────────────────────────────────

function FieldHeader({
  label,
  editing,
  saving,
  onEdit,
  onDone,
}: {
  label: string;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  return (
    <View style={styles.fieldHeader}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {editing ? (
        saving ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <TouchableOpacity onPress={onDone} hitSlop={12}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        )
      ) : (
        <TouchableOpacity onPress={onEdit} hitSlop={12}>
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── SettingRow ────────────────────────────────────────────────────────────────

type SettingRowProps = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress?: () => void;
  first?: boolean;
  destructive?: boolean;
};

function SettingRow({ icon, label, onPress, first, destructive }: SettingRowProps) {
  return (
    <TouchableOpacity
      style={[styles.settingRow, first && styles.settingRowFirst]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <Ionicons
        name={icon}
        size={20}
        color={destructive ? colors.danger : colors.textSecondary}
      />
      <Text style={[styles.settingRowLabel, destructive && styles.settingRowLabelDestructive]}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: spacing.xl, gap: spacing.xl, paddingBottom: 48 },

  avatarRow: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.lg },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { width: 80, height: 80, borderRadius: 40 },
  avatarText: { color: colors.accentFg, fontSize: 32, fontWeight: '800' },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 2,
  },
  avatarEditBadgeText: { color: colors.textSecondary, fontSize: 10, fontWeight: '600' },
  email: { color: colors.textSecondary, fontSize: 14 },

  // Field layout
  field: { gap: spacing.sm },
  fieldHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1.5 },
  editText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  doneText: { color: colors.accent, fontSize: 13, fontWeight: '700' },

  // Read-only display
  value: { color: colors.textPrimary, fontSize: 16, paddingVertical: spacing.xs },
  valueEmpty: { color: colors.textMuted, fontSize: 16, fontStyle: 'italic', paddingVertical: spacing.xs },

  // Username text input (accent border signals active editing)
  textInput: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
  },

  // Selection options (goal + equipment)
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

  // Training day circles
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingTop: spacing.xs },
  dayButton: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dayButtonSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayButtonText: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
  dayButtonTextSelected: { color: colors.accentFg },

  // Navigation links
  navLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  navLinkText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  navLinkArrow: { color: colors.accent, fontSize: 20, fontWeight: '300' },

  // Sign out
  // Settings section
  settingsHeader: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginTop: spacing.sm,
  },
  settingsGroup: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  settingRowFirst: { borderTopWidth: 0 },
  settingRowLabel: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  settingRowLabelDestructive: { color: colors.danger },
  appVersion: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
