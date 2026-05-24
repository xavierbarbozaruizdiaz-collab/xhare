import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text, Image } from 'react-native';
import { BrandScreenBackdrop } from './BrandScreenBackdrop';
import { appBrand } from './theme/brand';

export function LoadingScreen() {
  return (
    <BrandScreenBackdrop>
      <View style={styles.center}>
        <Image source={appBrand.logo} style={styles.logoImage} resizeMode="contain" accessibilityLabel={appBrand.appName} />
        <ActivityIndicator size="large" color={appBrand.colors.primary} style={styles.spinner} />
        <Text style={styles.text}>Cargando…</Text>
      </View>
    </BrandScreenBackdrop>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  logoImage: {
    width: '82%',
    maxWidth: 300,
    aspectRatio: 390 / 313,
    maxHeight: 140,
    marginBottom: 32,
    backgroundColor: 'transparent',
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
