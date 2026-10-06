import { Stack } from 'expo-router';
import { colors } from '../../constants/theme';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="review" options={{ title: 'Review Workout' }} />
      <Stack.Screen name="workout/[id]" options={{ title: 'Workout' }} />
      <Stack.Screen name="folder" options={{ title: '' }} />
      <Stack.Screen
        name="workout-summary"
        options={{ title: 'Workout Complete', headerBackVisible: false }}
      />
      <Stack.Screen name="personal-records" options={{ title: 'Personal Records' }} />
      <Stack.Screen name="settings-notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="settings-terms" options={{ title: 'Terms of Service' }} />
      <Stack.Screen name="settings-privacy" options={{ title: 'Privacy Policy' }} />
      <Stack.Screen name="discover-workout" options={{ title: 'Workout' }} />
    </Stack>
  );
}
