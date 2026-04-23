import { registerRootComponent } from 'expo';
import { installTextDecoderUtf16LePolyfill } from './src/polyfills/textDecoder';

installTextDecoderUtf16LePolyfill();
const App = require('./App').default;

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
