import { View, Text, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { colors, spacing } from '../../constants/theme';

export default function PrivacyScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: [DATE]</Text>

        <Text style={styles.body}>
          This Privacy Policy explains how [COMPANY NAME] ("we," "us," or "our") collects, uses, and protects your information when you use the Plyo application ("the App").
        </Text>

        <Text style={styles.heading}>1. Information We Collect</Text>
        <Text style={styles.body}>
          We collect information you provide directly, including your display name, fitness goals, training preferences, and workout data. We also collect your email address for account authentication via Supabase.
        </Text>

        <Text style={styles.heading}>2. How We Use Your Information</Text>
        <Text style={styles.body}>
          We use your information to provide and personalise the App's features, including AI-generated workout plans, progress tracking, and the Discover community feed (for workouts you choose to share publicly). We do not sell your personal data to third parties.
        </Text>

        <Text style={styles.heading}>3. Data Storage</Text>
        <Text style={styles.body}>
          Your data is stored securely using Supabase infrastructure. Workout data you mark as private is only accessible to you. Data you share publicly (via the Discover feed) is visible to other App users.
        </Text>

        <Text style={styles.heading}>4. Third-Party Services</Text>
        <Text style={styles.body}>
          We use the following third-party services: OpenAI (for workout transcription and AI plan generation), Apify (for Instagram Reel processing), and Supabase (for authentication and data storage). Each service has its own privacy policy.
        </Text>

        <Text style={styles.heading}>5. Data Retention</Text>
        <Text style={styles.body}>
          We retain your data for as long as your account is active. You can permanently delete your account and all associated data at any time from the Settings screen within the App.
        </Text>

        <Text style={styles.heading}>6. Your Rights</Text>
        <Text style={styles.body}>
          Depending on your location, you may have rights to access, correct, or delete your personal data. To exercise these rights, contact us at support@getstackd.fit.
        </Text>

        <Text style={styles.heading}>7. Children's Privacy</Text>
        <Text style={styles.body}>
          The App is not intended for users under 13 years of age. We do not knowingly collect personal information from children.
        </Text>

        <Text style={styles.heading}>8. Changes to This Policy</Text>
        <Text style={styles.body}>
          We may update this Privacy Policy periodically. We will notify you of significant changes via the App. Continued use of the App constitutes acceptance of the updated policy.
        </Text>

        <Text style={styles.heading}>9. Contact</Text>
        <Text style={styles.body}>
          For privacy-related questions, contact us at support@getstackd.fit.
        </Text>

        <Text style={styles.placeholder}>
          [PLACEHOLDER — Full policy to be reviewed by legal counsel before launch.]
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: 48 },
  updated: { color: colors.textMuted, fontSize: 12 },
  heading: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: spacing.sm },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 22 },
  placeholder: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: spacing.xl,
    lineHeight: 18,
  },
});
