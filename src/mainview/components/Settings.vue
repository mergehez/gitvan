<script setup lang="ts">
import Button from './Button.vue';
import SettingsAccounts from './SettingsAccounts.vue';
import SettingsEditors from './SettingsEditors.vue';
import SettingsRepositories from './SettingsRepositories.vue';
import { useSettings } from '../composables/useSettings';
import { computed } from 'vue';
import CenteredModal from './CenteredModal.vue';

const settings = useSettings();
const selected = computed({
    get() {
        return settings.selectedSettingsPanel;
    },
    set(value) {
        settings.selectedSettingsPanel = value;
    },
});
</script>

<template>
    <CenteredModal v-model:open="settings.isSettingsModalOpen" title="Settings" content-class="max-w-6xl h-[82vh]">
        <div class="grid h-full min-h-0 grid-cols-[180px_minmax(0,1fr)] bg-x1 text-reverse dark">
            <aside class="flex min-h-0 flex-col border-r border-white/10 bg-x3 py-4">
                <p class="w-full pb-4 text-center text-xl font-bold text-white">Settings</p>

                <div class="flex min-h-0 flex-col overflow-auto border border-x3">
                    <Button class="justify-start rounded-none" :severity="selected === 'repositories' ? 'light' : 'secondary'" @click="selected = 'repositories'">
                        <p class="text-sm font-medium text-white">Repositories</p>
                    </Button>

                    <Button class="justify-start rounded-none" :severity="selected === 'editors' ? 'light' : 'secondary'" @click="selected = 'editors'">
                        <p class="text-sm font-medium text-white">Editors</p>
                    </Button>

                    <Button class="justify-start rounded-none" :severity="selected === 'accounts' ? 'light' : 'secondary'" @click="selected = 'accounts'">
                        <p class="text-sm font-medium text-white">Accounts</p>
                    </Button>
                </div>
            </aside>

            <main class="flex min-h-0 flex-col overflow-auto px-4">
                <SettingsRepositories v-if="selected === 'repositories'" />
                <SettingsAccounts v-else-if="selected === 'accounts'" />
                <SettingsEditors v-else />
            </main>
        </div>
    </CenteredModal>
</template>
