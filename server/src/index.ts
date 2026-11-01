import { config } from './config';
import { createStore } from './store';
import { createStorage } from './storage';
import { createApp } from './app';

const store = await createStore();
const storage = createStorage();
const app = createApp(store, storage);

app.listen(config.port, () => {
  console.log(`Mine plan 3D API on http://localhost:${config.port}  (store: ${store.kind}, storage: ${config.storage}, data: ${config.dataDir})`);
});
