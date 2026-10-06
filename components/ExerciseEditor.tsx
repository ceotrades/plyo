import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';

export type RawExercise = {
  name: string;
  sets: number | null;
  reps: number | null;
  duration_seconds: number | null;
  rest_seconds: number | null;
  notes: string | null;
};

// String-valued version used for controlled TextInputs.
// Numeric fields are converted back to number|null on save via toDbRow().
export type Exercise = {
  id: string;
  name: string;
  sets: string;
  reps: string;
  duration_seconds: string;
  rest_seconds: string;
  notes: string;
};

export function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function toEditable(raw: RawExercise): Exercise {
  return {
    id: genId(),
    name: raw.name ?? '',
    sets: raw.sets?.toString() ?? '',
    reps: raw.reps?.toString() ?? '',
    duration_seconds: raw.duration_seconds?.toString() ?? '',
    rest_seconds: raw.rest_seconds?.toString() ?? '',
    notes: raw.notes ?? '',
  };
}

export function blankExercise(): Exercise {
  return {
    id: genId(),
    name: '',
    sets: '',
    reps: '',
    duration_seconds: '',
    rest_seconds: '',
    notes: '',
  };
}

export function toDbRow(ex: Exercise): RawExercise {
  return {
    name: ex.name.trim(),
    sets: ex.sets ? parseInt(ex.sets, 10) : null,
    reps: ex.reps ? parseInt(ex.reps, 10) : null,
    duration_seconds: ex.duration_seconds ? parseInt(ex.duration_seconds, 10) : null,
    rest_seconds: ex.rest_seconds ? parseInt(ex.rest_seconds, 10) : null,
    notes: ex.notes.trim() || null,
  };
}

export function generateWorkoutTitle(exercises: Array<{ name: string }>): string {
  const named = exercises.filter(e => e.name.trim());
  if (!named.length) return 'New Workout';
  const first = named[0].name;
  if (named.length === 1) return first;
  if (named.length === 2) return `${first} & ${named[1].name}`;
  return `${first}, ${named[1].name} +${named.length - 2} more`;
}

type CardProps = {
  index: number;
  exercise: Exercise;
  onChange: (field: keyof Exercise, value: string) => void;
  onDelete: () => void;
};

export function ExerciseCard({ index, exercise, onChange, onDelete }: CardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardIndex}>{index + 1}</Text>
        <TextInput
          style={styles.nameInput}
          placeholder="Exercise name"
          placeholderTextColor={colors.textMuted}
          value={exercise.name}
          onChangeText={v => onChange('name', v)}
        />
        <TouchableOpacity onPress={onDelete} style={styles.deleteButton} hitSlop={8}>
          <Text style={styles.deleteText}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.numericRow}>
        <NumericField label="Sets" value={exercise.sets} onChange={v => onChange('sets', v)} />
        <NumericField label="Reps" value={exercise.reps} onChange={v => onChange('reps', v)} />
        <NumericField
          label="Duration (s)"
          value={exercise.duration_seconds}
          onChange={v => onChange('duration_seconds', v)}
        />
        <NumericField
          label="Rest (s)"
          value={exercise.rest_seconds}
          onChange={v => onChange('rest_seconds', v)}
        />
      </View>

      <TextInput
        style={[styles.textInput, styles.notesInput]}
        placeholder="Notes (optional)"
        placeholderTextColor={colors.textMuted}
        value={exercise.notes}
        onChangeText={v => onChange('notes', v)}
        multiline
      />
    </View>
  );
}

function NumericField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.numericField}>
      <Text style={styles.numericLabel}>{label}</Text>
      <TextInput
        style={styles.numericInput}
        placeholder="—"
        placeholderTextColor={colors.textMuted}
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        maxLength={4}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm + 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardIndex: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    width: 20,
    textAlign: 'center',
  },
  nameInput: {
    flex: 1,
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  deleteButton: {
    padding: spacing.xs,
  },
  deleteText: {
    color: colors.textMuted,
    fontSize: 16,
  },
  numericRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  numericField: {
    flex: 1,
    gap: spacing.xs,
  },
  numericLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  numericInput: {
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  textInput: {
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.textPrimary,
  },
  notesInput: {
    minHeight: 36,
    color: colors.textSecondary,
  },
});
