import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { PushRegistrationEffect } from './src/push/PushRegistrationEffect';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PushRegistrationEffect />
        <RootNavigator />
        <StatusBar style="auto" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
