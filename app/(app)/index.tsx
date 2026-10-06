import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { supabase } from '../../services/supabase';
import { useSession } from '../../utils/auth';
import { getWeekStart } from '../../utils/weekStart';
import { colors } from '../../constants/theme';

// On every app launch this component runs two checks in parallel:
//
//  1. Active workout session — routes to the in-progress timer screen so
//     the user never loses track of a running workout.
//
//  2. Proposed weekly plan — if the current week's plan hasn't been
//     approved yet, land on the Calendar tab so the user sees the
//     "Review and approve" banner before doing anything else.
//     They can navigate away freely; the banner stays until approved.
//
// NOTE: week_start is always Monday for now. The partial-first-week
// boundary (e.g. a user who signs up on Wednesday has a Wed–Sun first
// week) is deferred — it requires changes to the generate-calendar edge
// function prompt and the calendar display logic.

export default function Index() {
  const { session } = useSession();
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setHref('/add');
      return;
    }

    const weekStart = getWeekStart();

    Promise.all([
      // Check 1: in-progress workout session
      supabase
        .from('workout_completions')
        .select('workout_id')
        .eq('user_id', session.user.id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Check 2: unapproved plan for this week
      supabase
        .from('weekly_plans')
        .select('id')
        .eq('user_id', session.user.id)
        .eq('week_start', weekStart)
        .eq('status', 'proposed')
        .maybeSingle(),
    ]).then(([sessionRes, planRes]) => {
      if (sessionRes.data?.workout_id) {
        // Active timer — go there first
        setHref(`/workout/${sessionRes.data.workout_id}`);
      } else if (planRes.data) {
        // Proposed plan awaiting approval — land on Calendar
        setHref('/calendar');
      } else {
        setHref('/add');
      }
    });
  }, [session]);

  if (!href) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return <Redirect href={href as Parameters<typeof Redirect>[0]['href']} />;
}
