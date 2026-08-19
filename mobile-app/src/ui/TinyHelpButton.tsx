import React from 'react';
import { Alert, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function TinyHelpButton({
  title,
  message,
  onDark = false,
}: {
  title: string;
  message: string;
  onDark?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.tinyHelpBtn, onDark ? styles.tinyHelpBtnOnDark : null]}
      onPress={(e) => {
        e?.stopPropagation?.();
        Alert.alert(title, message, [{ text: 'Entendido', style: 'default' }]);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Ayuda: ${title}`}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Ionicons
        name="information-circle-outline"
        size={14}
        color={onDark ? 'rgba(255,255,255,0.85)' : '#94a3b8'}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tinyHelpBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 1,
  },
  tinyHelpBtnOnDark: {
    backgroundColor: 'transparent',
  },
});
