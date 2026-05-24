/**
 * Login (and optional sign-up). Supabase email/password.
 * Incluye "¿Olvidaste tu contraseña?" → reset por email.
 * On success, AuthContext updates and RootNavigator switches to Main.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Linking,
  Image,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandScreenBackdrop } from '../ui/BrandScreenBackdrop';
import { appBrand } from '../ui/theme/brand';
import { ensureDriverPendingProfile } from '../backend/api';
import { supabase, isEnvConfigured } from '../backend/supabase';
import { useAuth } from '../auth/AuthContext';
import { getAppFlavor } from '../core/flavor';
import { env } from '../core/env';

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { refreshSession } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const termsUrl = `${env.apiBaseUrl?.trim().replace(/\/$/, '') || ''}/legal/terms`;
  const privacyUrl = `${env.apiBaseUrl?.trim().replace(/\/$/, '') || ''}/legal/privacy`;
  const isDriverApp = getAppFlavor() === 'driver';

  async function registerDriverProfileAfterAuth(profile?: {
    full_name?: string;
    phone?: string;
  }): Promise<void> {
    if (!isDriverApp) return;
    const ensured = await ensureDriverPendingProfile({
      full_name: profile?.full_name,
      phone: profile?.phone,
    });
    if (!ensured.ok) {
      throw new Error(
        ensured.error ||
          'No se pudo registrar la solicitud de conductor. Revisá la conexión o contactá soporte.'
      );
    }
    await refreshSession(null);
  }

  async function handleSubmit() {
    if (!isEnvConfigured()) {
      setMessage('Configurá EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY en .env');
      return;
    }
    setLoading(true);
    setMessage('');
    setResetSent(false);
    try {
      // Diagnóstico: en release a veces falla la inicialización del cliente.
      // Si un método no existe, mostramos un error claro en vez de "undefined is not a function".
      const authAny = supabase.auth as any;
      console.log('[SUPABASE_DEBUG]', {
        hasAuth: Boolean(supabase.auth),
        signInWithPassword: typeof authAny?.signInWithPassword,
        signUp: typeof authAny?.signUp,
        getSession: typeof authAny?.getSession,
      });

      if (isSignUp) {
        if (typeof (authAny?.signUp) !== 'function') {
          throw new Error('Supabase auth no tiene signUp');
        }
        let driverFullName: string | undefined;
        let driverPhone: string | undefined;
        if (isDriverApp) {
          const fn = firstName.trim();
          const ln = lastName.trim();
          driverPhone = phone.trim();
          driverFullName = [fn, ln].filter(Boolean).join(' ');
          if (!fn || !ln) {
            setMessage('Ingresá nombre y apellido para registrarte como conductor.');
            setLoading(false);
            return;
          }
          if (!driverPhone) {
            setMessage('Ingresá tu número de teléfono.');
            setLoading(false);
            return;
          }
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: isDriverApp
            ? {
                data: {
                  role: 'driver',
                  full_name: driverFullName,
                  phone: driverPhone,
                },
              }
            : undefined,
        });
        console.log('MOBILE signUp result:', !!data?.session, error);
        if (error) throw error;
        if (isDriverApp) {
          if (data.session) {
            await refreshSession(data.session);
          } else {
            await new Promise((r) => setTimeout(r, 1000));
            const {
              data: { session: delayedSession },
            } = await supabase.auth.getSession();
            if (delayedSession) await refreshSession(delayedSession);
          }
          await registerDriverProfileAfterAuth({
            full_name: driverFullName,
            phone: driverPhone,
          });
        }
        setMessage('Cuenta creada. Antes de continuar te pediremos aceptar TyC y Privacidad.');
      } else {
        if (typeof (authAny?.signInWithPassword) !== 'function') {
          throw new Error('Supabase auth no tiene signInWithPassword');
        }
        // No usar `raceWithTimeout` corto aquí: si el POST tarda (red móvil) devolvíamos TIMEOUT
        // aunque Supabase igual persistía la sesión → error en pantalla pero al reabrir ya entraba.
        // El tope real lo pone la carga de `profiles` en `getSessionProfileFromSession` (timeout + perfil mínimo).
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        console.log('MOBILE signInWithPassword result:', !!data?.session, error);
        if (error) throw error;
        await refreshSession((data as any)?.session ?? null);
        if (isDriverApp) {
          await registerDriverProfileAfterAuth();
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error';
      setMessage(msg.includes('422') ? 'Email ya registrado o contraseña inválida (mín. 6 caracteres).' : msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    const e = email.trim();
    if (!e) {
      setMessage('Ingresá tu email para enviarte el enlace de restablecimiento.');
      return;
    }
    if (!isEnvConfigured()) {
      setMessage('Configuración de Supabase faltante.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const authAny = supabase.auth as any;
      if (typeof authAny?.resetPasswordForEmail !== 'function') {
        throw new Error('Supabase auth no tiene resetPasswordForEmail');
      }
      const { error } = await supabase.auth.resetPasswordForEmail(e, {
        redirectTo: undefined,
      });
      if (error) throw error;
      setResetSent(true);
      setMessage('Revisá tu correo. Te enviamos un enlace para restablecer la contraseña. Si no aparece, revisá la carpeta de spam.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'No se pudo enviar el enlace.');
    } finally {
      setLoading(false);
    }
  }

  function showForgotPasswordPrompt() {
    Alert.alert(
      '¿Olvidaste tu contraseña?',
      'Ingresá el email de tu cuenta y te enviamos un enlace para restablecer la contraseña.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Enviar enlace',
          onPress: () => {
            if (email.trim()) {
              handleForgotPassword();
            } else {
              setMessage('Escribí tu email arriba y tocá de nuevo "¿Olvidaste tu contraseña?"');
            }
          },
        },
      ]
    );
  }

  return (
    <BrandScreenBackdrop>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
        accessibilityLabel="Pantalla de inicio de sesión"
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              minHeight: windowHeight - insets.top - insets.bottom,
              paddingTop: insets.top + 12,
              paddingBottom: Math.max(insets.bottom, 20),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.centerBlock}>
          <View style={styles.card}>
        <View style={styles.logoWrap}>
          <Image
            source={appBrand.logo}
            style={styles.logoImage}
            resizeMode="contain"
            accessibilityLabel={appBrand.appName}
          />
        </View>
        {isSignUp && isDriverApp ? (
          <>
            <Text style={styles.driverSignupTitle}>Datos del conductor</Text>
            <TextInput
              style={styles.input}
              placeholder="Nombre"
              placeholderTextColor="#888"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              editable={!loading}
              accessibilityLabel="Nombre"
            />
            <TextInput
              style={styles.input}
              placeholder="Apellido"
              placeholderTextColor="#888"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              editable={!loading}
              accessibilityLabel="Apellido"
            />
            <TextInput
              style={styles.input}
              placeholder="Teléfono (ej. 0981 123 456)"
              placeholderTextColor="#888"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              editable={!loading}
              accessibilityLabel="Teléfono"
            />
          </>
        ) : null}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#888"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!loading}
          accessibilityLabel="Correo electrónico"
          accessibilityHint="Escribí tu email para iniciar sesión o recuperar contraseña"
        />
        <TextInput
          style={styles.input}
          placeholder="Contraseña"
          placeholderTextColor="#888"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
          accessibilityLabel="Contraseña"
          accessibilityHint="Tu contraseña de la cuenta"
        />

        {message ? <Text style={[styles.message, resetSent && styles.messageSuccess]} accessibilityLiveRegion="polite">{message}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
          accessibilityLabel={isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
          accessibilityHint="Toca para entrar con email y contraseña"
          accessibilityRole="button"
        >
          {loading ? (
            <ActivityIndicator color="#fff" accessibilityLabel="Cargando" />
          ) : (
            <Text style={styles.buttonText}>{isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}</Text>
          )}
        </TouchableOpacity>

        {!isSignUp && (
          <TouchableOpacity
            style={styles.forgotLink}
            onPress={showForgotPasswordPrompt}
            disabled={loading}
            accessibilityLabel="¿Olvidaste tu contraseña?"
            accessibilityHint="Recibir enlace por email para restablecer la contraseña"
            accessibilityRole="button"
          >
            <Text style={styles.forgotLinkText}>¿Olvidaste tu contraseña?</Text>
          </TouchableOpacity>
        )}
        {isSignUp && (
          <View style={styles.legalWrap}>
            <Text style={styles.legalText}>
              Al crear tu cuenta, te mostraremos una sola pantalla para aceptar TyC y Privacidad.
            </Text>
            <View style={styles.legalLinksRow}>
              <TouchableOpacity onPress={() => { if (env.apiBaseUrl) void Linking.openURL(termsUrl); }}>
                <Text style={styles.legalLink}>Ver TyC</Text>
              </TouchableOpacity>
              <Text style={styles.legalSeparator}>•</Text>
              <TouchableOpacity onPress={() => { if (env.apiBaseUrl) void Linking.openURL(privacyUrl); }}>
                <Text style={styles.legalLink}>Ver Privacidad</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={styles.switch}
          onPress={() => {
            setIsSignUp(!isSignUp);
            setMessage('');
            setResetSent(false);
            if (isSignUp) {
              setFirstName('');
              setLastName('');
              setPhone('');
            }
          }}
          disabled={loading}
          accessibilityLabel={isSignUp ? 'Ya tenés cuenta, ir a iniciar sesión' : 'No tenés cuenta, crear cuenta'}
          accessibilityRole="button"
        >
          <Text style={styles.switchText}>
            {isSignUp ? '¿Ya tenés cuenta? Iniciar sesión' : '¿No tenés cuenta? Crear cuenta'}
          </Text>
        </TouchableOpacity>
          </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </BrandScreenBackdrop>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centerBlock: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 8,
  },
  logoWrap: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  logoImage: {
    width: '82%',
    maxWidth: 300,
    aspectRatio: 390 / 313,
    maxHeight: 128,
    backgroundColor: 'transparent',
  },
  driverSignupTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: appBrand.colors.text,
    marginBottom: 8,
    fontFamily: appBrand.fonts.semibold,
  },
  input: {
    borderWidth: 1,
    borderColor: appBrand.colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
    color: appBrand.colors.text,
    fontFamily: appBrand.fonts.regular,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  message: {
    fontSize: 13,
    color: appBrand.colors.danger,
    marginBottom: 12,
    fontFamily: appBrand.fonts.regular,
  },
  messageSuccess: {
    color: appBrand.colors.primary,
  },
  forgotLink: {
    marginTop: 12,
    alignItems: 'center',
  },
  forgotLinkText: {
    fontSize: 14,
    color: appBrand.colors.primary,
    fontFamily: appBrand.fonts.medium,
  },
  button: {
    backgroundColor: appBrand.colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: appBrand.colors.white,
    fontSize: 16,
    fontFamily: appBrand.fonts.semibold,
  },
  switch: {
    marginTop: 16,
    alignItems: 'center',
  },
  switchText: {
    color: appBrand.colors.textMuted,
    fontSize: 14,
    fontFamily: appBrand.fonts.regular,
  },
  legalWrap: {
    marginTop: 12,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: appBrand.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: appBrand.colors.primary,
    borderColor: appBrand.colors.primary,
  },
  checkboxTick: {
    color: appBrand.colors.white,
    fontSize: 12,
    fontFamily: appBrand.fonts.semibold,
  },
  legalText: {
    color: appBrand.colors.text,
    fontSize: 13,
    flex: 1,
    marginLeft: 8,
    fontFamily: appBrand.fonts.regular,
  },
  legalLinksRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  legalLink: {
    color: appBrand.colors.primary,
    fontSize: 13,
    fontFamily: appBrand.fonts.semibold,
    marginHorizontal: 6,
  },
  legalSeparator: {
    color: appBrand.colors.textMuted,
  },
});
