import React, { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { LogBox, ScrollView, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { PushRegistrationEffect } from './src/push/PushRegistrationEffect';

type EbProps = { children: ReactNode };
type EbState = { error: Error | null; componentStack: string | null };

class RootErrorBoundary extends Component<EbProps, EbState> {
  state: EbState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<EbState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[App]', error.message, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (error) {
      return (
        <ScrollView style={styles.fatalScroll} contentContainerStyle={styles.fatalContent}>
          <Text style={styles.fatalTitle}>No se pudo abrir la app</Text>
          <Text style={styles.fatalMsg} selectable>
            {error.message}
          </Text>
          {error.stack ? (
            <Text style={styles.fatalStack} selectable>
              {error.stack}
            </Text>
          ) : null}
          {componentStack ? (
            <Text style={styles.fatalStack} selectable>
              {componentStack}
            </Text>
          ) : null}
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fatalScroll: { flex: 1, backgroundColor: '#ffffff' },
  fatalContent: { padding: 20, paddingTop: 48 },
  fatalTitle: { fontSize: 18, fontWeight: '800', color: '#b91c1c', marginBottom: 12 },
  fatalMsg: { fontSize: 15, color: '#111827', marginBottom: 12 },
  fatalStack: { fontSize: 11, color: '#4b5563' },
});

export default function App() {
  useEffect(() => {
    if (!__DEV__) return;
    // Expo Dev Client (RN 0.83 / bridgeless): al arrancar puede intentar keep-awake
    // antes de que la Activity esté lista y dispara un rechazo no fatal.
    LogBox.ignoreLogs([
      'ExpoKeepAwake.activate has been rejected',
      'The current activity is no longer available',
    ]);
  }, []);

  return (
    <RootErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <PushRegistrationEffect />
          <RootNavigator />
          <StatusBar style="auto" />
        </AuthProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}
