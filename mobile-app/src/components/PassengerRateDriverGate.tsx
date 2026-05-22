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
  type AppStateStatus,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { rateDriver } from '../backend/api';
import { getAppFlavor } from '../core/flavor';
import {
  DEFAULT_RATING_STARS,
  PROFILE_RATING_WINDOW,
} from '../lib/profileRating';
import {
  fetchPendingPassengerDriverRating,
  loadSkippedDriverRatingRideIds,
  markDriverRatingRideSkipped,
  type PendingDriverRatingPrompt,
} from '../lib/passengerRateDriverPrompt';

const POLL_MS = 22_000;

export function PassengerRateDriverGate() {
  const { session } = useAuth();
  const flavor = getAppFlavor();
  const [prompt, setPrompt] = useState<PendingDriverRatingPrompt | null>(null);
  const [stars, setStars] = useState(DEFAULT_RATING_STARS);
  const [submitting, setSubmitting] = useState(false);
  const skippedRef = useRef<Set<string>>(new Set());
  const checkingRef = useRef(false);

  const refreshSkipped = useCallback(async () => {
    skippedRef.current = await loadSkippedDriverRatingRideIds();
  }, []);

  const checkPending = useCallback(async () => {
    if (flavor !== 'passenger' || !session?.id || checkingRef.current || submitting) return;
    checkingRef.current = true;
    try {
      await refreshSkipped();
      const pending = await fetchPendingPassengerDriverRating(session.id, skippedRef.current);
      if (pending) {
        setPrompt(pending);
        setStars(DEFAULT_RATING_STARS);
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

  const close = () => {
    setPrompt(null);
    setStars(DEFAULT_RATING_STARS);
  };

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
    setSubmitting(true);
    try {
      await rateDriver(prompt.rideId, stars);
      close();
      Alert.alert('Gracias', 'Tu calificación del conductor fue registrada.');
      void checkPending();
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
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Calificar conductor</Text>
          <Text style={styles.subtitle}>
            ¿Cómo fue tu viaje con {prompt.driverName}? Podés cambiar las estrellas (por defecto 5). El
            promedio público del conductor se recalcula cuando acumula {PROFILE_RATING_WINDOW} calificaciones.
          </Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <TouchableOpacity
                key={n}
                style={[styles.starBtn, stars >= n && styles.starBtnActive]}
                onPress={() => setStars(n)}
                accessibilityRole="button"
                accessibilityLabel={`${n} estrella${n !== 1 ? 's' : ''}`}
              >
                <Text style={[styles.starText, stars >= n && styles.starTextActive]}>★</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.footer}>
            <TouchableOpacity style={styles.skipBtn} onPress={() => void onSkip()}>
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
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
  subtitle: { fontSize: 14, color: '#4b5563', lineHeight: 20, marginBottom: 12 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginVertical: 12 },
  starBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  starBtnActive: { backgroundColor: '#f59e0b' },
  starText: { fontSize: 22, color: '#6b7280' },
  starTextActive: { color: '#fff' },
  footer: { flexDirection: 'row', gap: 10, marginTop: 8 },
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
