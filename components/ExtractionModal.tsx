import { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { colors, spacing, radius } from '../constants/theme';

// ── Stage definitions ─────────────────────────────────────────────────────────

export const EXTRACTION_STAGES = [
  'Finding your video...',
  'Extracting audio...',
  'Transcribing...',
  'Building your workout...',
] as const;

// currentStage:
//   0-3  → that stage is active, previous ones are done
//   4    → all complete (briefly shown before navigation)
// error  → replaces the stage list with an error state

export type ExtractionModalProps = {
  visible: boolean;
  currentStage: number;
  error: string | null;
  onClose: () => void; // called from error state "Try Again" button
};

// ── Sub-components ────────────────────────────────────────────────────────────

const DOT = 18;

function PulsingDot() {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.45, duration: 650, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 650, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.45, duration: 650, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View
      style={[styles.dot, styles.dotActive, { transform: [{ scale }], opacity }]}
    />
  );
}

function CheckDot() {
  const scale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      tension: 120,
      friction: 7,
    }).start();
  }, []);
  return (
    <Animated.View style={[styles.dot, styles.dotDone, { transform: [{ scale }] }]}>
      <Text style={styles.checkMark}>✓</Text>
    </Animated.View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ExtractionModal({
  visible,
  currentStage,
  error,
  onClose,
}: ExtractionModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {error ? (
            // ── Error state ──────────────────────────────────────────────────
            <>
              <View style={styles.errorCircle}>
                <Text style={styles.errorX}>✕</Text>
              </View>
              <Text style={styles.errorTitle}>Extraction failed</Text>
              <Text style={styles.errorBody}>{error}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={onClose}>
                <Text style={styles.retryText}>Try Again</Text>
              </TouchableOpacity>
            </>
          ) : (
            // ── Progress state ───────────────────────────────────────────────
            <>
              <Text style={styles.heading}>Extracting workout</Text>

              <View style={styles.stages}>
                {EXTRACTION_STAGES.map((label, i) => {
                  const allDone = currentStage === 4;
                  const isDone = allDone || i < currentStage;
                  const isActive = !allDone && i === currentStage;

                  return (
                    <View key={i} style={styles.stageRow}>
                      {isDone ? (
                        <CheckDot />
                      ) : isActive ? (
                        <PulsingDot />
                      ) : (
                        <View style={[styles.dot, styles.dotPending]} />
                      )}
                      <Text
                        style={[
                          styles.stageLabel,
                          isActive && styles.stageLabelActive,
                          isDone && styles.stageLabelDone,
                        ]}
                      >
                        {label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    width: '100%',
    alignItems: 'center',
    gap: spacing.xl,
  },

  heading: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },

  // Stage rows
  stages: { gap: spacing.lg + 2, alignSelf: 'stretch' },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },

  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: { backgroundColor: colors.accent },
  dotDone: { backgroundColor: colors.accent },
  dotPending: { backgroundColor: colors.border },

  checkMark: { color: colors.accentFg, fontSize: 10, fontWeight: '900' },

  stageLabel: { fontSize: 15, flex: 1, color: colors.textMuted },
  stageLabelActive: { color: colors.textPrimary, fontWeight: '600' },
  stageLabelDone: { color: colors.textSecondary },

  // Error state
  errorCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.bgInput,
    borderWidth: 2,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorX: { color: colors.danger, fontSize: 22, fontWeight: '700' },
  errorTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  errorBody: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.xxl,
  },
  retryText: { color: colors.accentFg, fontSize: 15, fontWeight: '700' },
});
