import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { CommonActions, useNavigation, type NavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { MainStackParamList, MainTabParamList } from '../navigation/types';

type DriverTabNav = BottomTabNavigationProp<MainTabParamList, 'Driver'>;

/**
 * Tab "Conductor" (flavor conductor): publicar viaje y acceso a solicitudes / demanda.
 */
export function DriverScreen() {
  const navigation = useNavigation<DriverTabNav>();
  const parentNav = navigation.getParent<NavigationProp<MainStackParamList>>();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Conductor</Text>
        <Text style={styles.hint}>
          Publicá un trayecto nuevo o revisá las solicitudes que dejaron los pasajeros y las rutas con demanda.
        </Text>
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={() =>
            parentNav?.dispatch(
              CommonActions.navigate({
                name: 'PublishRide',
                params: {},
                merge: false,
              })
            )
          }
          accessibilityRole="button"
          accessibilityLabel="Publicar viaje"
        >
          <Text style={styles.btnPrimaryText}>Publicar viaje</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnSecondary}
          onPress={() => parentNav?.navigate('DriverTripRequests')}
          accessibilityRole="button"
          accessibilityLabel="Solicitudes de viaje"
        >
          <Text style={styles.btnSecondaryText}>Solicitudes de viaje</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f0fdf4' },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 28,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#14532d',
    marginBottom: 10,
  },
  hint: {
    fontSize: 16,
    color: '#4b5563',
    lineHeight: 22,
    marginBottom: 20,
  },
  btnPrimary: {
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#14532d',
    alignItems: 'center',
    marginBottom: 12,
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnSecondary: {
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#166534',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  btnSecondaryText: { color: '#166534', fontSize: 15, fontWeight: '600' },
});