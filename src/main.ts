import type { Plugin } from 'vue';

import './styles.css';
import './styles-system-themes.css';
import './styles-theme-experience.css';

async function start(): Promise<void> {
  if (import.meta.env.VITE_CURRENT_TASK_SMOKE === '1') {
    const { runCurrentTaskNativeSmokeFromEnv } = await import(
      './v2-runtime/currentTaskNativeSmoke'
    );
    await runCurrentTaskNativeSmokeFromEnv();
    return;
  }

  if (import.meta.env.VITE_V2_SMOKE === '1') {
    const { runNativeSmoke } = await import('./v2-runtime/nativeSmoke');
    await runNativeSmoke();
    return;
  }

  const [{ createApp }, { createPinia }, { default: i18n }, { default: App }] =
    await Promise.all([
      import('vue'),
      import('pinia'),
      import('./i18n'),
      import('./App.vue'),
    ]);

  const app = createApp(App);
  const pinia = createPinia();
  const piniaPlugin: Plugin = {
    install(vueApp) {
      Reflect.apply(pinia.install, pinia, [vueApp]);
    },
  };

  app.use(piniaPlugin);
  app.use(i18n);
  app.mount('#app');
}

void start();
