import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text, Image } from 'react-native';
import { appBrand } from './theme/brand';

export function LoadingScreen() {
  return (
    <View style={styles.container}>
      <Image source={appBrand.logo} style={styles.logoImage} resizeMode="contain" accessibilityLabel={appBrand.appName} />
      <Text style={styles.tagline}>{appBrand.tagline}</Text>
      <ActivityIndicator size="large" color={appBrand.colors.primary} style={styles.spinner} />
      <Text style={styles.text}>Cargando…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: appBrand.colors.background,
    paddingHorizontal: 28,
  },
  logoImage: {
    width: '88%',
    maxWidth: 340,
    height: 200,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 15,
    color: appBrand.colors.textMuted,
    fontFamily: appBrand.fonts.medium,
    marginBottom: 28,
    textAlign: 'center',
  },
  spinner: {
    marginBottom: 16,
  },
  text: {
    fontSize: 15,
    color: appBrand.colors.primaryMuted,
    fontFamily: appBrand.fonts.regular,
  },
});
