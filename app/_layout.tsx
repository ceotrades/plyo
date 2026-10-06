import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, router } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { SessionProvider, useSession } from '../utils/auth';
import { supabase } from '../services/supabase';

// Suppress foreground notification banners — the user is already in the app
// and can see the active timer. Background/killed app: OS handles display.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function handleDeepLink(url: string) {
  const fragment = url.split('#')[1];
  if (fragment) {
    const params = new URLSearchParams(fragment);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token && refresh_token) {
      await supabase.auth.setSession({ access_token, refresh_token });
      return;
    }
  }

  const query = url.split('?')[1];
  if (query) {
    const params = new URLSearchParams(query);
    const code = params.get('code');
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
    }
  }
}

function RootNavigator() {
  const { session, isLoading, hasProfile } = useSession();

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url);
    });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url);
    });

    return () => subscription.remove();
  }, []);

  // Create the Android notification channel for workout reminders.
  useEffect(() => {
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('workout-reminders', {
        name: 'Workout Reminders',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
  }, []);

  // Handle notification taps while the app is running in the background.
  // Cold-launch taps are handled by the active-session check in (app)/index.tsx.
  useEffect(() => {
    if (!session) return;
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const workoutId = response.notification.request.content.data?.workoutId as string | undefined;
      if (workoutId) {
        router.navigate(`/workout/${workoutId}`);
      }
    });
    return () => sub.remove();
  }, [session]);

  if (isLoading || (session && hasProfile === null)) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d0d' }}>
        <ActivityIndicator color="#c8f000" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session && hasProfile === true}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!!session && hasProfile === false}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
}
