/**
 * Viajes a oferta: hub Busco viaje / Tengo lugar (como en web /offer).
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'Offer'>;

export function OfferScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        Negociá el precio con conductores o pasajeros. Publicá lo que buscás o lo que ofrecés y recibí ofertas.
      </Text>
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('OfferBusco')}
        activeOpacity={0.8}
      >
        <Text style={styles.cardEmoji}>🔍</Text>
        <Text style={styles.cardTitle}>Busco viaje</Text>
        <Text style={styles.cardHint}>Publicá tu trayecto y recibí ofertas de conductores.</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('OfferTengo')}
        activeOpacity={0.8}
      >
        <Text style={styles.cardEmoji}>🚗</Text>
        <Text style={styles.cardTitle}>Tengo lugar</Text>
        <Text style={styles.cardHint}>Publicá que tenés lugar y recibí ofertas de pasajeros.</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  intro: { fontSize: 14, color: '#6b7280', marginBottom: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  cardEmoji: { fontSize: 40, marginBottom: 12 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 4 },
  cardHint: { fontSize: 14, color: '#6b7280', textAlign: 'center' },
});
