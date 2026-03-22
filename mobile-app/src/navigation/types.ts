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
  PublishRide: { fromRideId?: string; tripRequestId?: string; groupId?: string } | undefined;
  EditRide: { rideId: string };
  MyTripRequests: undefined;
  DriverTripRequests: undefined;
  DriverRouteGroupDetail: { groupId: string };
  PassengerDemandRoutes: undefined;
  PassengerRouteGroupDetail: { groupId: string };
  JoinGroupMap: { groupId: string };
  VehicleSetup: undefined;
  Messages: undefined;
  Chat: { conversationId: string };
  Offer: undefined;
  OfferBusco: undefined;
  OfferTengo: undefined;
  OfferBuscoNew: undefined;
  OfferTengoNew: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Driver: undefined;
  Passenger: undefined;
  Settings: undefined;
};

