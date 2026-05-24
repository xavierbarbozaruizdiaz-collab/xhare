import React from 'react';
import { ImageBackground, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { appBrand } from './theme/brand';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Fondo decorativo a pantalla completa (splash / carga / login). */
export function BrandScreenBackdrop({ children, style }: Props) {
  return (
    <ImageBackground
      source={appBrand.splashBackground}
      style={[styles.root, style]}
      resizeMode="cover"
      accessibilityIgnoresInvertColors
    >
      <View style={styles.content}>{children}</View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  content: {
    flex: 1,
  },
});
