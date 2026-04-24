// Debe ejecutarse antes de cargar Expo/RN para soportar utf-16le en runtimes Hermes.
require('./src/polyfills/textDecoder').installTextDecoderUtf16LePolyfill();
const { registerRootComponent } = require('expo');
const App = require('./App').default;

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
