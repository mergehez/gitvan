import { createApp } from 'vue';
import App from './App.vue';
import { initTasks } from './composables/useTasks';
import './css/app.css';
import { ensureGitClientBridge } from './lib/installGitClientBridge';
import { vContextMenu } from './directives/VContextMenu';
import { vError } from './directives/VError';
import { vLoading } from './directives/VLoading';
import { vTooltip } from './directives/VTooltip';

const isDev2 = import.meta.env.VITE_DEV2 === 'true';
let mountedApp: ReturnType<typeof createApp> | undefined;

if (isDev2) {
    const { installDev2GitClientBridge } = await import('./lib/gitClientDev2');
    installDev2GitClientBridge();
}

void (isDev2 ? Promise.resolve() : ensureGitClientBridge()).then(() => {
    mountedApp?.unmount();

    const app = createApp(App);

    app.directive('loading', vLoading);
    app.directive('tooltip', vTooltip);
    app.directive('menu', vContextMenu);
    app.directive('error', vError);

    initTasks();

    app.mount('#app');
    mountedApp = app;
});

if (import.meta.hot) {
    import.meta.hot.accept();
    import.meta.hot.dispose(() => {
        mountedApp?.unmount();
        mountedApp = undefined;
    });
}
