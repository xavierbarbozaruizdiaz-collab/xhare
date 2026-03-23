/**
 * Navigation param lists for type-safe routes.
 */

/** Params para Main cuando se navega por deep link a una pantalla anidada. */
export type MainScreenParams =
  | { screen: 'RideDetail'; params: { rideId: string } }
  | { screen: 'Chat'; params: { conversationId: string } };

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined | MainScreenParams;
};

export type MainStackParamList = {
  MainTabs: undefined;
  RideDetail: { rideId: string };
  BookRide: { rideId: string };
  PublishRide:
    | {
        fromRideId?: string;
        tripRequestId?: string;
        groupId?: string;
        publishKind?: 'internal' | 'long_distance';
      }
    | undefined;
  SearchPublishedRides: undefined;
  /** Lista del día: viajes publicados con cupos (sin pantalla de filtros). */
  AvailableRides: undefined;
  EditRide: { rideId: string };
  MyTripRequests: undefined;
  /** Reservas del pasajero (viajes en los que reservó asiento). */
  MyBookings: undefined;
  /** Viajes del conductor (publicados / con reservas / en ruta). */
  MyPublishedRides: undefined;
  DriverTripRequests: undefined;
  DriverRouteGroupDetail: { groupId: string };
  PassengerDemandRoutes: undefined;
  PassengerRouteGroupDetail: { groupId: string };
  JoinGroupMap: { groupId: string };
  VehicleSetup: undefined;
  Messages: undefined;
  Chat: { conversationId: string };
  /** Guardar solicitud de trayecto (trip_requests). Prefill desde Buscar viajes. */
  SaveTripRequest:
    | {
        originLabel?: string;
        destinationLabel?: string;
        originLat?: number;
        originLng?: number;
        destinationLat?: number;
        destinationLng?: number;
        requestedDate?: string;
        requestedTime?: string;
        suggestedPricingKind?: 'internal' | 'long_distance';
      }
    | undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Driver: undefined;
  Passenger: undefined;
  Settings: undefined;
};

