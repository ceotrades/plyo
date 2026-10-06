import { View, Text, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { colors, spacing } from '../../constants/theme';

export default function TermsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: [DATE]</Text>

        <Text style={styles.body}>
          These Terms of Service ("Terms") govern your use of the Plyo application ("the App") operated by [COMPANY NAME] ("we," "us," or "our").
        </Text>

        <Text style={styles.heading}>1. Acceptance of Terms</Text>
        <Text style={styles.body}>
          By creating an account and using the App, you agree to be bound by these Terms. If you do not agree to these Terms, do not use the App.
        </Text>

        <Text style={styles.heading}>2. Use of the App</Text>
        <Text style={styles.body}>
          Plyo is a fitness tracking application. You agree to use the App only for lawful purposes and in accordance with these Terms. You are responsible for all content you upload or share through the App.
        </Text>

        <Text style={styles.heading}>3. User Accounts</Text>
        <Text style={styles.body}>
          You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorised use of your account.
        </Text>

        <Text style={styles.heading}>4. Content</Text>
        <Text style={styles.body}>
          By sharing workout content publicly through the Discover feed, you grant us a non-exclusive, royalty-free licence to display that content within the App. You retain ownership of your content. We reserve the right to remove any content that violates these Terms.
        </Text>

        <Text style={styles.heading}>5. Health Disclaimer</Text>
        <Text style={styles.body}>
          The App provides fitness tracking tools and AI-generated workout plans for informational purposes only. Always consult a qualified healthcare professional before beginning any new exercise programme. We are not responsible for any injury or health consequences arising from use of the App.
        </Text>

        <Text style={styles.heading}>6. Limitation of Liability</Text>
        <Text style={styles.body}>
          To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the App.
        </Text>

        <Text style={styles.heading}>7. Changes to Terms</Text>
        <Text style={styles.body}>
          We may update these Terms from time to time. We will notify you of significant changes via the App. Continued use of the App after changes constitutes acceptance of the updated Terms.
        </Text>

        <Text style={styles.heading}>8. Contact</Text>
        <Text style={styles.body}>
          If you have any questions about these Terms, please contact us at support@getstackd.fit.
        </Text>

        <Text style={styles.placeholder}>
          [PLACEHOLDER — Full terms to be drafted and reviewed by legal counsel before launch.]
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
