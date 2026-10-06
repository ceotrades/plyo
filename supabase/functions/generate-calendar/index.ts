import { createClient } from 'jsr:@supabase/supabase-js@2';

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

type RawExercise = {
  name: string;
  sets: number | null;
  reps: number | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
  notes: string | null;
};

type WorkoutRow = {
  id: string;
  name: string | null;
  exercises: RawExercise[];
  category?: string | null;
};

type GeneratedWorkout = {
  name: string;
  exercises: RawExercise[];
  notes: string | null;
};

// ── Prompts ───────────────────────────────────────────────────────────────────

// Step 1: filter saved workouts to only those that fit the user's goal.
const RELEVANCE_PROMPT = `You are a fitness coach assessing whether saved workouts are compatible with a user's current training goal.

Each workout has a "category" field (user-assigned) and an "exercises" list. Use category as the PRIMARY signal and exercises as confirmation.

Category-goal compatibility rules (be strict):
- Goal "Complete a Hyrox":
    ACCEPT category "Hyrox".
    REJECT category "Gym/Strength" UNLESS exercises include functional Hyrox movements (sled, carries, wall balls, ski erg, rowing, etc.).
    REJECT "Yoga/Mobility", "Running" (running alone doesn't prepare for Hyrox stations).
- Goal "Build muscle":
    ACCEPT "Gym/Strength".
    ACCEPT "HIIT" as a conditioning complement.
    REJECT "Running", "Yoga/Mobility", "Hyrox".
- Goal "Lose weight":
    ACCEPT "HIIT" and "Running".
    ACCEPT "Gym/Strength" if exercises are circuit-style or full-body (not pure isolation splits).
    REJECT pure bodybuilding isolation splits.
- Goal "Strength & conditioning":
    ACCEPT "Gym/Strength" and "HIIT".
    ACCEPT "Hyrox" for conditioning days.
    REJECT "Yoga/Mobility" and "Running" unless exercises include relevant strength work.
- Goal "HIIT & general fitness":
    ACCEPT "HIIT".
    ACCEPT "Running" and "Gym/Strength" circuits.
    REJECT pure bodybuilding isolation splits.
- Goal "Running performance":
    ACCEPT "Running".
    ACCEPT "Gym/Strength" ONLY if exercises include single-leg work, hip stability, or plyometrics.
    REJECT "Yoga/Mobility" and pure bodybuilding.
- Goal "Hybrid athlete":
    ACCEPT "Gym/Strength", "HIIT", "Running", "Hyrox".
    REJECT "Yoga/Mobility" unless exercises are explicitly performance-focused mobility.

Return ONLY this JSON, no prose, no markdown:
{ "relevant_ids": ["uuid1", "uuid2"] }

If no workouts are relevant, return: { "relevant_ids": [] }`;

// Step 2: generate fresh goal-appropriate workouts to fill gaps.
const GENERATE_PROMPT = `You are a certified strength and conditioning coach. Generate the number of complete, distinct workouts specified by the "count" field in the user message.

Rules:
- Target different muscle groups or energy systems across workouts so the training week is balanced
- Every exercise must have sets AND either reps OR duration_seconds filled (not both null)
- rest_seconds must be a number for every exercise (e.g. 60 for strength, 30 for HIIT)
- Include 4–8 exercises per workout
- Workouts must match the stated equipment — no barbell exercises if equipment includes only "Bodyweight only"
- Workout names must be descriptive and goal-specific (e.g. "Hyrox Interval Run", "Upper Body Strength", "HIIT Cardio Circuit")

Return ONLY this JSON, no prose, no markdown:
{
  "workouts": [
    {
      "name": "string",
      "exercises": [
        {
          "name": "string",
          "sets": number,
          "reps": number | null,
          "duration_seconds": number | null,
          "rest_seconds": number,
          "notes": "string | null"
        }
      ],
      "notes": "string | null"
    }
  ]
}`;

// Step 3: assign the curated + generated library to 7 days.
const SCHEDULE_PROMPT = `You are a fitness programming assistant. Given a user's goal, available equipment, number of training days per week, and their workout library, build a 7-day (Monday–Sunday) weekly training calendar.

Rules:
- Schedule EXACTLY the number of workout days specified by training_days_per_week
- Fill the remaining days with rest
- Spread training days sensibly — avoid 4+ consecutive training days where possible
- Use ONLY workout IDs that appear in the workout_library — never invent or guess IDs
- If the library has fewer unique workouts than training days, repeat workouts rather than inventing new ones
- Every "workout" day must include a valid workout_id from the library

Return ONLY this JSON, no prose, no markdown:
{
  "days": [
    { "day": "Monday",    "type": "workout", "workout_id": "<uuid from library>", "workout_name": "<name>" },
    { "day": "Tuesday",   "type": "rest" },
    { "day": "Wednesday", "type": "workout", "workout_id": "<uuid>", "workout_name": "<name>" },
    { "day": "Thursday",  "type": "rest" },
    { "day": "Friday",    "type": "workout", "workout_id": "<uuid>", "workout_name": "<name>" },
    { "day": "Saturday",  "type": "rest" },
    { "day": "Sunday",    "type": "rest" }
  ]
}`;

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonError('Missing Authorization header', 401);

    // Use the user's JWT so RLS applies automatically to all DB queries.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonError('Unauthorized', 401);

    // ── Fetch profile ──────────────────────────────────────────────────────────
    const { data: profile, error: profileErr } = await supabase
      .from('user_profile')
      .select('goal, training_days, equipment')
      .eq('user_id', user.id)
      .single();

    if (profileErr || !profile) {
      return jsonError('Profile not found. Complete onboarding first.', 404);
    }

    // ── Fetch workout library ─────────────────────────────────────────────────
    const { data: fetched, error: workoutsErr } = await supabase
      .from('workouts')
      .select('id, name, exercises, category')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (workoutsErr) throw new Error(`Failed to fetch workouts: ${workoutsErr.message}`);

    const allSaved: WorkoutRow[] = fetched ?? [];

    // ── Relevance filter ──────────────────────────────────────────────────────
    // Ask GPT-4o which saved workouts actually fit the user's current goal.
    // A user whose library only contains bodybuilding work but whose goal is
    // "Complete a Hyrox" will get an empty relevant set, triggering generation
    // of proper Hyrox workouts below — same path as having no saved workouts.
    let relevantLibrary: WorkoutRow[];
    if (allSaved.length === 0) {
      relevantLibrary = [];
    } else {
      const relevantIds = await callRelevanceFilter(allSaved, profile);
      relevantLibrary = allSaved.filter((w) => relevantIds.has(w.id));
    }

    // ── Generate workouts to fill gaps ────────────────────────────────────────
    // Gaps = training days that can't be covered by relevant saved workouts.
    // Generated workouts are persisted to the library so they appear on the
    // Home tab and are reused (and re-evaluated) on future plan generations.
    const gaps = Math.max(0, profile.training_days - relevantLibrary.length);
    const generatedIds = new Set<string>();

    if (gaps > 0) {
      const generated = await callGenerateWorkouts(gaps, profile);

      for (const w of generated) {
        const { data: inserted, error: insertErr } = await supabase
          .from('workouts')
          .insert({
            user_id: user.id,
            name: w.name,
            exercises: w.exercises,
            notes: w.notes ?? null,
          })
          .select('id, name, exercises')
          .single();

        if (insertErr || !inserted) {
          throw new Error(
            `Failed to save generated workout "${w.name}": ${insertErr?.message}`,
          );
        }

        relevantLibrary.push(inserted as WorkoutRow);
        generatedIds.add(inserted.id);
      }
    }

    // ── Build schedule input ──────────────────────────────────────────────────
    const libraryForGpt = relevantLibrary.map((w) => ({
      id: w.id,
      name: displayName(w),
      exercises: (w.exercises ?? []).map((e: RawExercise) => e.name).filter(Boolean).join(', '),
    }));

    const scheduleInput = JSON.stringify(
      {
        profile: {
          goal: profile.goal,
          training_days_per_week: profile.training_days,
          equipment: profile.equipment,
        },
        workout_library: libraryForGpt,
      },
      null,
      2,
    );

    // ── Schedule the week ─────────────────────────────────────────────────────
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.3,
        messages: [
          { role: 'system', content: SCHEDULE_PROMPT },
          { role: 'user', content: scheduleInput },
        ],
      }),
    });

    if (!gptRes.ok) {
      const msg = await gptRes.text();
      throw new Error(`OpenAI error: ${msg}`);
    }

    const completion = await gptRes.json();
    const plan = JSON.parse(completion.choices[0].message.content);

    if (!Array.isArray(plan?.days) || plan.days.length !== 7) {
      throw new Error('AI returned a malformed plan (expected 7 days).');
    }

    // Validate workout_ids and annotate source for internal tracking.
    // The calendar ignores the source field; it's stored in the weekly_plans
    // JSON so we can audit which workouts were user-saved vs AI-generated.
    const validIds = new Set(relevantLibrary.map((w) => w.id));
    for (const day of plan.days as Array<{
      type: string;
      workout_id?: string;
      day: string;
      source?: string;
    }>) {
      if (day.type === 'workout') {
        if (day.workout_id && !validIds.has(day.workout_id)) {
          throw new Error(
            `AI referenced an unknown workout ID on ${day.day}. Please try regenerating.`,
          );
        }
        day.source = day.workout_id && generatedIds.has(day.workout_id)
          ? 'generated'
          : 'saved';
      }
    }

    return json({ plan });
  } catch (err) {
    return jsonError((err as Error).message, 500);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callRelevanceFilter(
  library: WorkoutRow[],
  profile: { goal: string; equipment: string[] },
): Promise<Set<string>> {
  const libraryForFilter = library.map((w) => ({
    id: w.id,
    name: displayName(w),
    category: w.category ?? 'Other',
    exercises: (w.exercises ?? []).map((e: RawExercise) => e.name).filter(Boolean).join(', '),
  }));

  const userMessage = JSON.stringify(
    {
      goal: profile.goal,
      equipment: profile.equipment,
      workout_library: libraryForFilter,
    },
    null,
    2,
  );

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: RELEVANCE_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`OpenAI relevance filter error: ${msg}`);
  }

  const data = await res.json();
  const result = JSON.parse(data.choices[0].message.content);

  return new Set<string>(Array.isArray(result?.relevant_ids) ? result.relevant_ids : []);
}

async function callGenerateWorkouts(
  count: number,
  profile: { goal: string; training_days: number; equipment: string[] },
): Promise<GeneratedWorkout[]> {
  const userMessage = JSON.stringify(
    {
      count,
      goal: profile.goal,
      training_days_per_week: profile.training_days,
      equipment: profile.equipment,
    },
    null,
    2,
  );

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.7,
      messages: [
        { role: 'system', content: GENERATE_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`OpenAI workout generation error: ${msg}`);
  }

  const data = await res.json();
  const result = JSON.parse(data.choices[0].message.content);

  if (!Array.isArray(result?.workouts) || result.workouts.length === 0) {
    throw new Error('AI failed to generate workouts. Please try again.');
  }

  return result.workouts as GeneratedWorkout[];
}

function displayName(w: { name?: string | null; exercises?: RawExercise[] }): string {
  if (w.name) return w.name;
  const exs = w.exercises ?? [];
  if (!exs.length) return 'Untitled Workout';
  if (exs.length === 1) return exs[0].name;
  if (exs.length === 2) return `${exs[0].name} & ${exs[1].name}`;
  return `${exs[0].name}, ${exs[1].name} +${exs.length - 2} more`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function jsonError(message: string, status: number): Response {
  return json({ error: message }, status);
}
