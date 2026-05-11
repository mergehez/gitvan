import { createApp } from 'vue';
import App from './App.vue';
import { vError } from './components/VError';
import { vLoading } from './components/VLoading';
import { vTooltip } from './components/VTooltip';
import { initTasks } from './composables/useTasks';
import './css/app.css';
import { ensureGitClientBridge } from './lib/installGitClientBridge';

const isDev2 = import.meta.env.VITE_DEV2 === 'true';

if (isDev2) {
    const { installDev2GitClientBridge } = await import('./lib/gitClientDev2');
    installDev2GitClientBridge();
}

void (isDev2 ? Promise.resolve() : ensureGitClientBridge()).then(() => {
    const app = createApp(App);

    app.directive('loading', vLoading);
    app.directive('tooltip', vTooltip);
    app.directive('error', vError);

    initTasks();

    app.mount('#app');
});
