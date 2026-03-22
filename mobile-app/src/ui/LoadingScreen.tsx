import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';

export function LoadingScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>Xhare</Text>
      <ActivityIndicator size="large" color="#166534" style={styles.spinner} />
      <Text style={styles.text}>Cargando…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
  },
  logo: {
    fontSize: 28,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 24,
    letterSpacing: 0.5,
  },
  spinner: {
    marginBottom: 16,
  },
  text: {
    fontSize: 15,
    color: '#15803d',
  },
});
