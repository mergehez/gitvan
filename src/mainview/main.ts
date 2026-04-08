import './css/app.css';
import App from './App.vue';
import { createApp } from 'vue';
import { vLoading } from './components/VLoading';
import { vTooltip } from './components/VTooltip';
import { vError } from './components/VError';
import { initTasks } from './composables/useTasks';

const app = createApp(App);

app.directive('loading', vLoading);
app.directive('tooltip', vTooltip);
app.directive('error', vError);

initTasks();

app.mount('#app');
