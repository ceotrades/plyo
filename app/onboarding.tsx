import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useForm, Controller, type Control } from 'react-hook-form';
import * as Notifications from 'expo-notifications';
import { supabase } from '../services/supabase';
import { useSession } from '../utils/auth';
import { pickImage, uploadBase64Image } from '../utils/imageUpload';
import { colors, spacing, radius } from '../constants/theme';

// ── Types & constants ─────────────────────────────────────────────────────────

type FormValues = {
  username: string;
  referralSource: string;
  goal: string;
  trainingDays: string;
  equipment: string[];
  dailyGoal: string;
};

const HOW_HEARD = [
  'App Store',
  'TikTok',
  'Instagram',
  'Friend or family',
  'Google / Search',
  'Other',
];

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

const DAILY_GOALS = [
  'Stay consistent',
  'Burn calories',
  'Learn new exercises',
  'Keep active',
  'Build strength',
  'Track my progress',
];

// step 0 = welcome; steps 1-6 show progress dots; step 7 = profile setup (submit)
const TOTAL_FORM_STEPS = 6;

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const { session, setHasProfile } = useSession();

  const { control, handleSubmit, trigger, setValue } = useForm<FormValues>({
    defaultValues: {
      username: '',
      referralSource: '',
      goal: '',
      trainingDays: '',
      equipment: [],
      dailyGoal: '',
    },
  });

  // Pre-fill username from email prefix
  useEffect(() => {
    if (session?.user.email) {
      setValue('username', session.user.email.split('@')[0]);
    }
  }, [session]);

  async function advance() {
    let valid = true;
    if (step === 1) valid = await trigger('referralSource');
    else if (step === 2) valid = await trigger('goal');
    else if (step === 3) valid = await trigger('trainingDays');
    else if (step === 4) valid = await trigger('equipment');
    else if (step === 5) valid = await trigger('dailyGoal');
    if (valid) setStep(s => s + 1);
  }

  async function handlePickAvatar() {
    if (!session) return;

    const picked = await pickImage();
    if (!picked) return;

    setAvatarUrl(picked.uri); // Show immediately
    setUploadingAvatar(true);

    try {
      const url = await uploadBase64Image(picked.base64, `avatars/${session.user.id}/avatar`);
      setAvatarUrl(url); // Switch to network URL with cache-buster
    } catch (err) {
      Alert.alert('Upload failed', (err as Error).message);
    }
    setUploadingAvatar(false);
  }

  async function onSubmit(data: FormValues) {
    if (!session) return;
    setSaving(true);
    const { error } = await supabase.from('user_profile').insert({
      user_id: session.user.id,
      username: data.username.trim() || session.user.email?.split('@')[0] || 'Athlete',
      goal: data.goal,
      training_days: parseInt(data.trainingDays, 10),
      equipment: data.equipment,
      referral_source: data.referralSource || null,
      daily_goal: data.dailyGoal || null,
      avatar_url: avatarUrl || null,
      has_seen_sharing_explainer: false,
    });
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setHasProfile(true);
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress dots — shown for steps 1-7 */}
      {step > 0 && (
        <View style={styles.progressRow}>
          {step > 1 && (
            <TouchableOpacity onPress={() => setStep(s => s - 1)} hitSlop={12}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
          )}
          <View style={styles.dots}>
            {Array.from({ length: TOTAL_FORM_STEPS + 1 }, (_, i) => (
              <View key={i} style={[styles.dot, i < step && styles.dotActive]} />
            ))}
          </View>
        </View>
      )}

      {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
      {step === 1 && <HowHeardStep control={control} onNext={advance} />}
      {step === 2 && <GoalStep control={control} onNext={advance} />}
      {step === 3 && <DaysStep control={control} onNext={advance} />}
      {step === 4 && <EquipmentStep control={control} onNext={advance} />}
      {step === 5 && <DailyGoalStep control={control} onNext={advance} />}
      {step === 6 && <NotificationsStep onNext={advance} />}
      {step === 7 && (
        <ProfileSetupStep
          control={control}
          onSubmit={handleSubmit(onSubmit)}
          saving={saving}
          avatarUrl={avatarUrl}
          onPickAvatar={handlePickAvatar}
          uploadingAvatar={uploadingAvatar}
        />
      )}
    </SafeAreaView>
  );
}

// ── Step components ───────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <View style={styles.step}>
      <View style={styles.welcomeContent}>
        <View style={styles.logo}>
          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>P</Text>
          </View>
          <Text style={styles.logoWordmark}>PLYO</Text>
        </View>
        <Text style={styles.welcomeTitle}>
          Turn any workout video into your personalized plan.
        </Text>
        <Text style={styles.welcomeSubtitle}>
          Let's set up your profile so we can tailor your experience.
        </Text>
      </View>
      <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
        <Text style={styles.primaryButtonText}>Get Started</Text>
      </TouchableOpacity>
    </View>
  );
}

function HowHeardStep({ control, onNext }: { control: Control<FormValues>; onNext: () => void }) {
  return (
    <Controller
      name="referralSource"
      control={control}
      rules={{ required: 'Please select an option' }}
      render={({ field: { value, onChange }, fieldState: { error } }) => (
        <View style={styles.step}>
          <Text style={styles.stepTitle}>How did you hear about Plyo?</Text>
          <ScrollView style={styles.optionScroll} showsVerticalScrollIndicator={false}>
            {HOW_HEARD.map(option => {
              const selected = value === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => onChange(option)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {option}
                  </Text>
                  {selected && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {error && <Text style={styles.errorText}>{error.message}</Text>}
          <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
            <Text style={styles.primaryButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      )}
    />
  );
}

function GoalStep({ control, onNext }: { control: Control<FormValues>; onNext: () => void }) {
  return (
    <Controller
      name="goal"
      control={control}
      rules={{ required: 'Please select a goal' }}
      render={({ field: { value, onChange }, fieldState: { error } }) => (
        <View style={styles.step}>
          <Text style={styles.stepTitle}>What's your main goal?</Text>
          <ScrollView style={styles.optionScroll} showsVerticalScrollIndicator={false}>
            {GOALS.map(goal => {
              const selected = value === goal;
              return (
                <TouchableOpacity
                  key={goal}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => onChange(goal)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {goal}
                  </Text>
                  {selected && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {error && <Text style={styles.errorText}>{error.message}</Text>}
          <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
            <Text style={styles.primaryButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      )}
    />
  );
}

function DaysStep({ control, onNext }: { control: Control<FormValues>; onNext: () => void }) {
  return (
    <Controller
      name="trainingDays"
      control={control}
      rules={{ required: 'Please select a number' }}
      render={({ field: { value, onChange }, fieldState: { error } }) => (
        <View style={styles.step}>
          <Text style={styles.stepTitle}>How many days a week can you train?</Text>
          <View style={styles.daysGrid}>
            {[1, 2, 3, 4, 5, 6, 7].map(n => {
              const selected = value === String(n);
              return (
                <TouchableOpacity
                  key={n}
                  style={[styles.dayButton, selected && styles.dayButtonSelected]}
                  onPress={() => onChange(String(n))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.dayButtonText, selected && styles.dayButtonTextSelected]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {error && <Text style={styles.errorText}>{error.message}</Text>}
          <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
            <Text style={styles.primaryButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      )}
    />
  );
}

function EquipmentStep({ control, onNext }: { control: Control<FormValues>; onNext: () => void }) {
  return (
    <Controller
      name="equipment"
      control={control}
      rules={{ validate: v => v.length > 0 || 'Select at least one option' }}
      render={({ field: { value, onChange }, fieldState: { error } }) => {
        function toggle(item: string) {
          onChange(value.includes(item) ? value.filter(e => e !== item) : [...value, item]);
        }
        return (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>What equipment do you have access to?</Text>
            <Text style={styles.stepSubtitle}>Select all that apply</Text>
            <View style={styles.optionList}>
              {EQUIPMENT.map(item => {
                const selected = value.includes(item);
                return (
                  <TouchableOpacity
                    key={item}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => toggle(item)}
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
            {error && <Text style={styles.errorText}>{error.message}</Text>}
            <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
              <Text style={styles.primaryButtonText}>Next</Text>
            </TouchableOpacity>
          </View>
        );
      }}
    />
  );
}

function DailyGoalStep({ control, onNext }: { control: Control<FormValues>; onNext: () => void }) {
  return (
    <Controller
      name="dailyGoal"
      control={control}
      rules={{ required: 'Please select an option' }}
      render={({ field: { value, onChange }, fieldState: { error } }) => (
        <View style={styles.step}>
          <Text style={styles.stepTitle}>What's driving you day to day?</Text>
          <ScrollView style={styles.optionScroll} showsVerticalScrollIndicator={false}>
            {DAILY_GOALS.map(opt => {
              const selected = value === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => onChange(opt)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {opt}
                  </Text>
                  {selected && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {error && <Text style={styles.errorText}>{error.message}</Text>}
          <TouchableOpacity style={styles.primaryButton} onPress={onNext}>
            <Text style={styles.primaryButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      )}
    />
  );
}

function NotificationsStep({ onNext }: { onNext: () => void }) {
  async function handleAllow() {
    try { await Notifications.requestPermissionsAsync(); } catch { /* ignore */ }
    onNext();
  }
  return (
    <View style={styles.step}>
      <View style={styles.welcomeContent}>
        <Text style={styles.stepTitle}>Stay on track</Text>
        <Text style={styles.stepSubtitle}>
          Get reminders when it's time to train, alerts when a workout timer is still running,
          and updates when your weekly plan is ready to approve.
        </Text>
      </View>
      <TouchableOpacity style={styles.primaryButton} onPress={handleAllow}>
        <Text style={styles.primaryButtonText}>Allow Notifications</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onNext} style={styles.skipButton}>
        <Text style={styles.skipText}>Maybe later</Text>
      </TouchableOpacity>
    </View>
  );
}

function ProfileSetupStep({
  control,
  onSubmit,
  saving,
  avatarUrl,
  onPickAvatar,
  uploadingAvatar,
}: {
  control: Control<FormValues>;
  onSubmit: () => void;
  saving: boolean;
  avatarUrl: string | null;
  onPickAvatar: () => void;
  uploadingAvatar: boolean;
}) {
  return (
    <View style={styles.step}>
      <Text style={styles.stepTitle}>You're almost there</Text>
      <Text style={styles.stepSubtitle}>
        Add a photo and confirm your display name. You can always update these from your profile.
      </Text>

      {/* Avatar picker */}
      <TouchableOpacity
        style={styles.avatarPicker}
        onPress={onPickAvatar}
        disabled={uploadingAvatar}
        activeOpacity={0.8}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatarPickerImage} />
        ) : uploadingAvatar ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <View style={styles.avatarPickerPlaceholder}>
            <Text style={styles.avatarPickerPlus}>+</Text>
            <Text style={styles.avatarPickerLabel}>Add photo</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Display name */}
      <Controller
        name="username"
        control={control}
        render={({ field: { value, onChange } }) => (
          <TextInput
            style={styles.nameInput}
            placeholder="Display name"
            placeholderTextColor={colors.textMuted}
            value={value}
            onChangeText={onChange}
            autoCorrect={false}
            autoCapitalize="words"
            maxLength={30}
          />
        )}
      />

      <TouchableOpacity
        style={[styles.primaryButton, (saving || uploadingAvatar) && styles.buttonDisabled]}
        onPress={onSubmit}
        disabled={saving || uploadingAvatar}
      >
        {saving
          ? <ActivityIndicator color={colors.accentFg} />
          : <Text style={styles.primaryButtonText}>Get Started</Text>}
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    minHeight: 48,
  },
  backText: { color: colors.textSecondary, fontSize: 15, marginRight: spacing.lg },
  dots: { flexDirection: 'row', gap: 6, flex: 1, justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent },
  step: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },

  // Welcome
  welcomeContent: { flex: 1, justifyContent: 'center', gap: spacing.lg },
  logo: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  logoMark: {
    width: 40, height: 40, backgroundColor: colors.accent,
    borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
  },
  logoMarkText: { color: colors.accentFg, fontSize: 22, fontWeight: '900', fontStyle: 'italic' },
  logoWordmark: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: 4 },
  welcomeTitle: { fontSize: 28, fontWeight: '800', color: colors.textPrimary, lineHeight: 36 },
  welcomeSubtitle: { fontSize: 16, color: colors.textSecondary, lineHeight: 24 },

  // Form steps
  stepTitle: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.xs },
  stepSubtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.xs, lineHeight: 20 },

  // Options
  optionScroll: { flex: 1, marginVertical: spacing.lg },
  optionList: { marginTop: spacing.lg, gap: spacing.sm, marginBottom: spacing.lg },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg,
    marginBottom: spacing.sm,
  },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  optionText: { color: colors.textPrimary, fontSize: 16 },
  optionTextSelected: { color: colors.accent, fontWeight: '600' },
  checkmark: { color: colors.accent, fontSize: 16, fontWeight: '700' },

  // Training days grid
  daysGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md,
    marginTop: spacing.xxl, marginBottom: spacing.xxl,
  },
  dayButton: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dayButtonSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayButtonText: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  dayButtonTextSelected: { color: colors.accentFg },

  // Profile setup avatar picker
  avatarPicker: {
    alignSelf: 'center',
    width: 100, height: 100, borderRadius: 50,
    marginTop: spacing.xl, marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  avatarPickerImage: { width: 100, height: 100, borderRadius: 50 },
  avatarPickerPlaceholder: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: colors.bgCard, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  avatarPickerPlus: { color: colors.accent, fontSize: 24, fontWeight: '300' },
  avatarPickerLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  nameInput: {
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 14,
    fontSize: 20, color: colors.textPrimary, marginBottom: spacing.md,
  },

  // Skip / notifications
  skipButton: { paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  skipText: { color: colors.textSecondary, fontSize: 15 },

  // Shared buttons
  primaryButton: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: 16, alignItems: 'center', marginTop: 'auto',
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: colors.accentFg, fontSize: 16, fontWeight: '700' },
  errorText: { color: colors.danger, fontSize: 14, marginBottom: spacing.md },
});
