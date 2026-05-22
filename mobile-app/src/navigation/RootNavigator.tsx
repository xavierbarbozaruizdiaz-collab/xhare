/**
 * Root: Auth stack (Login) vs Main stack (Tabs + RideDetail, BookRide, PublishRide).
 * Deep links: xhare://ride/{rideId} → RideDetail, xhare://chat/{conversationId} → Chat.
 */
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { getAppFlavor } from '../core/flavor';
import { useAuth } from '../auth/AuthContext';
import { LoadingScreen } from '../ui/LoadingScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PassengerScreen } from '../screens/PassengerScreen';
import { RideDetailScreen } from '../screens/RideDetailScreen';
import { BookRideScreen } from '../screens/BookRideScreen';
import { PublishRideScreen } from '../screens/PublishRideScreen';
import { SearchPublishedRidesScreen } from '../screens/SearchPublishedRidesScreen';
import { AvailableRidesScreen } from '../screens/AvailableRidesScreen';
import { NearbyEnRouteRidesScreen } from '../screens/NearbyEnRouteRidesScreen';
import { EditRideScreen } from '../screens/EditRideScreen';
import { MyTripRequestsScreen } from '../screens/MyTripRequestsScreen';
import { MyBookingsScreen } from '../screens/MyBookingsScreen';
import { MyPublishedRidesScreen } from '../screens/MyPublishedRidesScreen';
import { DriverTripRequestsScreen } from '../screens/DriverTripRequestsScreen';
import { TripRequestLongDistanceOfferScreen } from '../screens/TripRequestLongDistanceOfferScreen';
import { DriverRouteGroupDetailScreen } from '../screens/DriverRouteGroupDetailScreen';
import { PassengerDemandRoutesScreen } from '../screens/PassengerDemandRoutesScreen';
import { PassengerRouteGroupDetailScreen } from '../screens/PassengerRouteGroupDetailScreen';
import { JoinGroupMapScreen } from '../screens/JoinGroupMapScreen';
import { MessagesScreen } from '../screens/MessagesScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { SaveTripRequestScreen } from '../screens/SaveTripRequestScreen';
import { LegalAcceptanceScreen } from '../screens/LegalAcceptanceScreen';
import { PassengerRateDriverGate } from '../components/PassengerRateDriverGate';
import { ActiveRideResumeGate } from '../components/ActiveRideResumeGate';
import type { RootStackParamList } from './types';
import type { MainStackParamList } from './types';
import type { MainTabParamList } from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Home: { active: 'home', inactive: 'home-outline' },
  Passenger: { active: 'people', inactive: 'people-outline' },
  Settings: { active: 'settings', inactive: 'settings-outline' },
};

function MainTabs() {
  const flavor = getAppFlavor();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        tabBarLabelStyle: { fontSize: 12, fontFamily: 'DMSans_600SemiBold' },
        tabBarActiveTintColor: '#1a5c38',
        tabBarInactiveTintColor: '#6b7280',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#eef0f3',
          paddingTop: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.08,
          shadowRadius: 10,
          elevation: 12,
        },
        tabBarIcon: ({ focused, color, size }) => {
          const names = TAB_ICONS[route.name] ?? { active: 'ellipse', inactive: 'ellipse-outline' };
          const iconName = focused ? names.active : names.inactive;
          const active = '#1a5c38';
          return (
            <View
              style={{
                width: 56,
                height: 46,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={iconName as any} size={size ?? 24} color={focused ? active : color} />
              {focused ? (
                <View
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    width: 30,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: active,
                  }}
                />
              ) : null}
            </View>
          );
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Inicio' }} />
      {flavor === 'passenger' ? (
        <Tab.Screen name="Passenger" component={PassengerScreen} options={{ title: 'Pasajero' }} />
      ) : null}
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Ajustes' }} />
    </Tab.Navigator>
  );
}

function MainStackNavigator() {
  return (
    <MainStack.Navigator screenOptions={{ headerShown: true }}>
      <MainStack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <MainStack.Screen
        name="RideDetail"
        component={RideDetailScreen}
        options={{ title: 'Detalle del viaje' }}
      />
      <MainStack.Screen
        name="BookRide"
        component={BookRideScreen}
        options={{ title: 'Reservar' }}
      />
      <MainStack.Screen
        name="PublishRide"
        component={PublishRideScreen}
        options={{ title: 'Publicar viaje' }}
      />
      <MainStack.Screen
        name="SearchPublishedRides"
        component={SearchPublishedRidesScreen}
        options={{ title: 'Buscar viajes' }}
      />
      <MainStack.Screen
        name="AvailableRides"
        component={AvailableRidesScreen}
        options={{ title: 'Viajes disponibles' }}
      />
      <MainStack.Screen
        name="NearbyEnRouteRides"
        component={NearbyEnRouteRidesScreen}
        options={{ title: 'En curso cerca' }}
      />
      <MainStack.Screen
        name="EditRide"
        component={EditRideScreen}
        options={{ title: 'Editar viaje' }}
      />
      <MainStack.Screen
        name="MyTripRequests"
        component={MyTripRequestsScreen}
        options={{ title: 'Mis solicitudes' }}
      />
      <MainStack.Screen
        name="MyBookings"
        component={MyBookingsScreen}
        options={{ title: 'Mis reservas' }}
      />
      <MainStack.Screen
        name="MyPublishedRides"
        component={MyPublishedRidesScreen}
        options={{ title: 'Mis viajes publicados' }}
      />
      <MainStack.Screen
        name="DriverTripRequests"
        component={DriverTripRequestsScreen}
        options={{ title: 'Solicitudes de viaje' }}
      />
      <MainStack.Screen
        name="TripRequestLongDistanceOffer"
        component={TripRequestLongDistanceOfferScreen}
        options={{ title: 'Ofertas de viajes' }}
      />
      <MainStack.Screen
        name="DriverRouteGroupDetail"
        component={DriverRouteGroupDetailScreen}
        options={{ title: 'Ruta con demanda' }}
      />
      <MainStack.Screen
        name="PassengerDemandRoutes"
        component={PassengerDemandRoutesScreen}
        options={{ title: 'Rutas con demanda' }}
      />
      <MainStack.Screen
        name="PassengerRouteGroupDetail"
        component={PassengerRouteGroupDetailScreen}
        options={{ title: 'Ruta con demanda' }}
      />
      <MainStack.Screen
        name="JoinGroupMap"
        component={JoinGroupMapScreen}
        options={{ title: 'Unirme a la ruta' }}
      />
      <MainStack.Screen
        name="Messages"
        component={MessagesScreen}
        options={{ title: 'Mensajes' }}
      />
      <MainStack.Screen
        name="Chat"
        component={ChatScreen}
        options={{ title: 'Chat' }}
      />
      <MainStack.Screen
        name="SaveTripRequest"
        component={SaveTripRequestScreen}
        options={{ title: 'Guardar solicitud' }}
      />
    </MainStack.Navigator>
  );
}

function parseDeepLink(url: string): { screen: 'RideDetail' | 'Chat'; params: { rideId: string } | { conversationId: string } } | null {
  try {
    const parsed = Linking.parse(url);
    const path = (parsed.path ?? '').replace(/^\/+/, '');
    const segments = path.split('/').filter(Boolean);
    if (segments[0] === 'ride' && segments[1]) {
      return { screen: 'RideDetail', params: { rideId: segments[1] } };
    }
    if (segments[0] === 'chat' && segments[1]) {
      return { screen: 'Chat', params: { conversationId: segments[1] } };
    }
  } catch {
    // ignore
  }
  return null;
}

export function RootNavigator() {
  const { session, loading } = useAuth();
  const navRef = useNavigationContainerRef<RootStackParamList>();
  const linkingHandled = useRef<string | null>(null);

  useEffect(() => {
    if (!session) return;

    const handleUrl = (url: string) => {
      const link = parseDeepLink(url);
      if (!link || !navRef.isReady?.()) return;
      if (link.screen === 'RideDetail') {
        navRef.navigate('Main', { screen: 'RideDetail', params: link.params as { rideId: string } });
      } else if (link.screen === 'Chat') {
        navRef.navigate('Main', { screen: 'Chat', params: link.params as { conversationId: string } });
      }
    };

    const tryInitial = () => {
      if (!navRef.isReady?.()) {
        setTimeout(tryInitial, 100);
        return;
      }
      Linking.getInitialURL().then((url) => {
        if (url && !linkingHandled.current) {
          linkingHandled.current = url;
          handleUrl(url);
        }
      });
    };
    tryInitial();

    const sub = Linking.addEventListener('url', ({ url }) => {
      linkingHandled.current = url;
      handleUrl(url);
    });
    return () => sub.remove();
  }, [session]);

  const legalAccepted =
    !!session &&
    !!session.terms_accepted_at &&
    !!session.privacy_accepted_at;

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer ref={navRef}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {!session ? (
          <RootStack.Screen name="Auth" component={LoginScreen} />
        ) : !legalAccepted ? (
          <RootStack.Screen name="Auth" component={LegalAcceptanceScreen} />
        ) : (
          <RootStack.Screen name="Main" component={MainStackNavigator} />
        )}
      </RootStack.Navigator>
      {session && legalAccepted ? (
        <>
          <ActiveRideResumeGate navRef={navRef} />
          <PassengerRateDriverGate />
        </>
      ) : null}
    </NavigationContainer>
  );
}
