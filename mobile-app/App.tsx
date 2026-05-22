import React, { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { LogBox, ScrollView, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
} from '@expo-google-fonts/montserrat';
import { AuthProvider } from './src/auth/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { PushRegistrationEffect } from './src/push/PushRegistrationEffect';
import { LoadingScreen } from './src/ui/LoadingScreen';
import { appBrand } from './src/ui/theme/brand';

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
  fatalScroll: { flex: 1, backgroundColor: appBrand.colors.background },
  fatalContent: { padding: 20, paddingTop: 48 },
  fatalTitle: { fontSize: 18, fontFamily: appBrand.fonts.semibold, color: appBrand.colors.danger, marginBottom: 12 },
  fatalMsg: { fontSize: 15, fontFamily: appBrand.fonts.regular, color: appBrand.colors.text, marginBottom: 12 },
  fatalStack: { fontSize: 11, fontFamily: appBrand.fonts.regular, color: appBrand.colors.textMuted },
});

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
  });

  useEffect(() => {
    if (!__DEV__) return;
    LogBox.ignoreLogs([
      'ExpoKeepAwake.activate has been rejected',
      'The current activity is no longer available',
    ]);
  }, []);

  useEffect(() => {
    if (fontError) console.error('[App] fonts', fontError);
  }, [fontError]);

  if (!fontsLoaded) {
    return (
      <RootErrorBoundary>
        <SafeAreaProvider>
          <LoadingScreen />
        </SafeAreaProvider>
      </RootErrorBoundary>
    );
  }

  return (
    <RootErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <PushRegistrationEffect />
          <RootNavigator />
          <StatusBar style="light" />
        </AuthProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}
