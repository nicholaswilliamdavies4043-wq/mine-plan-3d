import { config } from './config';
import { createStore } from './store';
import { createStorage } from './storage';
import { createApp } from './app';
import { startKeepAlive } from './keepAlive';

const store = await createStore();
const storage = createStorage();
const app = createApp(store, storage);

app.listen(config.port, () => {
  startKeepAlive();
  console.log(`Mine Development Tool API on http://localhost:${config.port}  (store: ${store.kind}, storage: ${config.storage}, data: ${config.dataDir})`);
});
