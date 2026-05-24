import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  value: number;
  onChange: (stars: number) => void;
  max?: number;
  size?: number;
  disabled?: boolean;
};

export function StarRatingInput({ value, onChange, max = 5, size = 40, disabled }: Props) {
  return (
    <View style={styles.row} accessibilityRole="adjustable">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const filled = value >= n;
        return (
          <TouchableOpacity
            key={n}
            onPress={() => !disabled && onChange(n)}
            disabled={disabled}
            style={styles.starHit}
            accessibilityRole="button"
            accessibilityLabel={`${n} estrella${n !== 1 ? 's' : ''}`}
            accessibilityState={{ selected: filled }}
          >
            <Ionicons
              name={filled ? 'star' : 'star-outline'}
              size={size}
              color={filled ? '#f59e0b' : '#cbd5e1'}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  starHit: {
    padding: 4,
  },
});
