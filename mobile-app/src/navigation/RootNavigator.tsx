/**
 * Root: Auth stack (Login) vs Main stack (Tabs + RideDetail, BookRide, PublishRide).
 * Deep links: xhare://ride/{rideId} → RideDetail, xhare://chat/{conversationId} → Chat.
 */
import React, { useEffect, useRef } from 'react';
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
import { DriverScreen } from '../screens/DriverScreen';
import { PassengerScreen } from '../screens/PassengerScreen';
import { RideDetailScreen } from '../screens/RideDetailScreen';
import { BookRideScreen } from '../screens/BookRideScreen';
import { PublishRideScreen } from '../screens/PublishRideScreen';
import { SearchPublishedRidesScreen } from '../screens/SearchPublishedRidesScreen';
import { EditRideScreen } from '../screens/EditRideScreen';
import { MyTripRequestsScreen } from '../screens/MyTripRequestsScreen';
import { MyPublishedRidesScreen } from '../screens/MyPublishedRidesScreen';
import { DriverTripRequestsScreen } from '../screens/DriverTripRequestsScreen';
import { DriverRouteGroupDetailScreen } from '../screens/DriverRouteGroupDetailScreen';
import { PassengerDemandRoutesScreen } from '../screens/PassengerDemandRoutesScreen';
import { PassengerRouteGroupDetailScreen } from '../screens/PassengerRouteGroupDetailScreen';
import { JoinGroupMapScreen } from '../screens/JoinGroupMapScreen';
import { VehicleSetupScreen } from '../screens/VehicleSetupScreen';
import { MessagesScreen } from '../screens/MessagesScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { OfferScreen } from '../screens/OfferScreen';
import { OfferBuscoScreen } from '../screens/OfferBuscoScreen';
import { OfferTengoScreen } from '../screens/OfferTengoScreen';
import { OfferBuscoNewScreen } from '../screens/OfferBuscoNewScreen';
import { OfferTengoNewScreen } from '../screens/OfferTengoNewScreen';
import type { RootStackParamList } from './types';
import type { MainStackParamList } from './types';
import type { MainTabParamList } from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Home: { active: 'home', inactive: 'home-outline' },
  Driver: { active: 'car', inactive: 'car-outline' },
  Passenger: { active: 'people', inactive: 'people-outline' },
  Settings: { active: 'settings', inactive: 'settings-outline' },
};

function MainTabs() {
  const flavor = getAppFlavor();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        tabBarLabelStyle: { fontSize: 12 },
        tabBarActiveTintColor: '#166534',
        tabBarInactiveTintColor: '#6b7280',
        tabBarIcon: ({ focused, color, size }) => {
          const names = TAB_ICONS[route.name] ?? { active: 'ellipse', inactive: 'ellipse-outline' };
          const iconName = focused ? names.active : names.inactive;
          return <Ionicons name={iconName as any} size={size ?? 24} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Inicio' }} />
      {flavor === 'driver' ? (
        <Tab.Screen name="Driver" component={DriverScreen} options={{ title: 'Conductor' }} />
      ) : (
        <Tab.Screen name="Passenger" component={PassengerScreen} options={{ title: 'Pasajero' }} />
      )}
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
        name="MyPublishedRides"
        component={MyPublishedRidesScreen}
        options={{ title: 'Mis viajes publicados' }}
      />
      <MainStack.Screen
        name="DriverTripRequests"
        component={DriverTripRequestsScreen}
        options={{ title: 'Solicitudes de trayecto' }}
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
        name="VehicleSetup"
        component={VehicleSetupScreen}
        options={{ title: 'Configurar vehículo' }}
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
        name="Offer"
        component={OfferScreen}
        options={{ title: 'Viajes a oferta' }}
      />
      <MainStack.Screen
        name="OfferBusco"
        component={OfferBuscoScreen}
        options={{ title: 'Busco viaje' }}
      />
      <MainStack.Screen
        name="OfferTengo"
        component={OfferTengoScreen}
        options={{ title: 'Tengo lugar' }}
      />
      <MainStack.Screen
        name="OfferBuscoNew"
        component={OfferBuscoNewScreen}
        options={{ title: 'Nueva solicitud Busco viaje' }}
      />
      <MainStack.Screen
        name="OfferTengoNew"
        component={OfferTengoNewScreen}
        options={{ title: 'Publicar Tengo lugar' }}
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

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer ref={navRef}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {!session ? (
          <RootStack.Screen name="Auth" component={LoginScreen} />
        ) : (
          <RootStack.Screen name="Main" component={MainStackNavigator} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
