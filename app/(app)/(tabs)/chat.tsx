import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../../constants/theme';

export default function ChatScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.centered}>
        <Ionicons name="chatbubbles-outline" size={52} color={colors.textMuted} />
        <Text style={styles.message}>
          Chat with your AI coach is coming soon
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 16,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
});
