/**
 * Popup global: pasajero califica al conductor tras bajada, en cualquier pantalla.
 */
import { appBrand } from '../ui/theme/brand';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  AppState,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type AppStateStatus,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { rateDriver } from '../backend/api';
import { getAppFlavor } from '../core/flavor';
import { DEFAULT_RATING_STARS } from '../lib/profileRating';
import {
  fetchPendingPassengerDriverRating,
  loadSkippedDriverRatingRideIds,
  markDriverRatingRideSkipped,
  type PendingDriverRatingPrompt,
} from '../lib/passengerRateDriverPrompt';
import { StarRatingInput } from './StarRatingInput';

const POLL_MS = 22_000;
const COMMENT_MAX = 500;

export function PassengerRateDriverGate() {
  const { session } = useAuth();
  const flavor = getAppFlavor();
  const [prompt, setPrompt] = useState<PendingDriverRatingPrompt | null>(null);
  const [stars, setStars] = useState(DEFAULT_RATING_STARS);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const skippedRef = useRef<Set<string>>(new Set());
  const ratedLocallyRef = useRef<Set<string>>(new Set());
  const checkingRef = useRef(false);

  const refreshSkipped = useCallback(async () => {
    skippedRef.current = await loadSkippedDriverRatingRideIds();
  }, []);

  const checkPending = useCallback(async () => {
    if (flavor !== 'passenger' || !session?.id || checkingRef.current || submitting) return;
    checkingRef.current = true;
    try {
      await refreshSkipped();
      const excluded = new Set([...skippedRef.current, ...ratedLocallyRef.current]);
      const pending = await fetchPendingPassengerDriverRating(session.id, skippedRef.current, excluded);
      if (pending) {
        setPrompt(pending);
        setStars(DEFAULT_RATING_STARS);
        setComment('');
      } else if (!submitting) {
        setPrompt(null);
      }
    } finally {
      checkingRef.current = false;
    }
  }, [flavor, session?.id, submitting, refreshSkipped]);

  useEffect(() => {
    void refreshSkipped();
  }, [refreshSkipped, session?.id]);

  useEffect(() => {
    if (flavor !== 'passenger' || !session?.id) {
      setPrompt(null);
      return;
    }
    void checkPending();
    const t = setInterval(() => void checkPending(), POLL_MS);
    const sub = AppState.addEventListener('change', (st: AppStateStatus) => {
      if (st === 'active') void checkPending();
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [flavor, session?.id, checkPending]);

  const close = useCallback(() => {
    setPrompt(null);
    setStars(DEFAULT_RATING_STARS);
    setComment('');
  }, []);

  const onSkip = async () => {
    if (prompt?.rideId) {
      await markDriverRatingRideSkipped(prompt.rideId);
      skippedRef.current.add(prompt.rideId);
    }
    close();
    void checkPending();
  };

  const onSubmit = async () => {
    if (!prompt || stars < 1 || stars > 5 || submitting) return;
    const rideId = prompt.rideId;
    setSubmitting(true);
    try {
      await rateDriver(rideId, stars, comment);
      ratedLocallyRef.current.add(rideId);
      close();
      setTimeout(() => void checkPending(), 800);
    } catch (e) {
      Alert.alert(
        'No se pudo calificar',
        e instanceof Error ? e.message : 'Intentá de nuevo en un momento.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!prompt) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void onSkip()}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <View style={styles.card}>
            <Text style={styles.title}>Calificar conductor</Text>
            <Text style={styles.subtitle}>
              ¿Cómo te fue tu viaje con {prompt.driverName}?
            </Text>
            <StarRatingInput value={stars} onChange={setStars} disabled={submitting} />
            <Text style={styles.commentLabel}>Comentario (opcional)</Text>
            <TextInput
              style={styles.commentInput}
              value={comment}
              onChangeText={(t) => setComment(t.slice(0, COMMENT_MAX))}
              placeholder="Contanos cómo fue el viaje…"
              placeholderTextColor="#9ca3af"
              multiline
              maxLength={COMMENT_MAX}
              editable={!submitting}
              textAlignVertical="top"
            />
            <View style={styles.footer}>
              <TouchableOpacity style={styles.skipBtn} onPress={() => void onSkip()} disabled={submitting}>
                <Text style={styles.skipText}>Omitir</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sendBtn, submitting && styles.sendBtnDisabled]}
                disabled={submitting || stars < 1}
                onPress={() => void onSubmit()}
              >
                <Text style={styles.sendText}>{submitting ? 'Enviando…' : 'Enviar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#374151', lineHeight: 22, marginBottom: 16, textAlign: 'center' },
  commentLabel: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginTop: 16, marginBottom: 6 },
  commentInput: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  footer: { flexDirection: 'row', gap: 10, marginTop: 16 },
  skipBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
  },
  skipText: { color: '#374151', fontWeight: '600' },
  sendBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: appBrand.colors.primary,
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.6 },
  sendText: { color: '#fff', fontWeight: '700' },
});
