<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import AppCloneRepositoryModal from './components/AppCloneRepositoryModal.vue';
import AppCreateRepositoryModal from './components/AppCreateRepositoryModal.vue';
import AppErrorBanner from './components/AppErrorBanner.vue';
import AppMergeConflictModal from './components/AppMergeConflictModal.vue';
import AppPullBlockedByLocalChangesModal from './components/AppPullBlockedByLocalChangesModal.vue';
import AppSuccessToast from './components/AppSuccessToast.vue';
import EtSplitter from './components/EtSplitter.vue';
import GitClientHeader from './components/GitClientHeader.vue';
import RepChangesView from './components/RepChangesView.vue';
import RepExplorerView from './components/RepExplorerView.vue';
import RepHistoryView from './components/RepHistoryView.vue';
import Settings from './components/Settings.vue';
import SidebarBranches from './components/SidebarBranches.vue';
import SidebarRepositories from './components/SidebarRepositories.vue';
import { initializeStates } from './composables/initializeStates';
import { useRepos } from './composables/useRepos';
import { useSettings } from './composables/useSettings';
import { tasks } from './composables/useTasks';

initializeStates();

const settings = useSettings();
const repos = useRepos();
const selectedRepo = computed(() => repos.getSelectedRepo());

let disposeNativeCommandListener: (() => void) | undefined = undefined;

onMounted(() => {
    disposeNativeCommandListener = window.gitClient.onNativeCommand(async (command) => {
        if (command.kind === 'open-settings') {
            await settings.openSettingsWindow(command.panel);
        }
    });
});

onBeforeUnmount(() => {
    disposeNativeCommandListener?.();
    disposeNativeCommandListener = undefined;
});
</script>

<template>
    <template v-if="!!tasks.abortMerge">
        <AppCloneRepositoryModal />
        <AppCreateRepositoryModal />
        <AppMergeConflictModal />
        <AppPullBlockedByLocalChangesModal />
        <AppSuccessToast />
        <EtSplitter
            class="flex h-screen overflow-auto bg-transparent dark"
            base-side="left"
            default-width="200px"
            min-width="180px"
            max-width="50%"
            local-storage-key="repositorySidebarWidth">
            <template #left>
                <SidebarRepositories />
            </template>
            <template #right>
                <div v-if="selectedRepo" class="flex flex-1 overflow-y-auto">
                    <div class="flex flex-col flex-1 overflow-auto">
                        <AppErrorBanner />
                        <GitClientHeader />

                        <section class="flex-1 overflow-y-auto flex flex-col bg-x0 relative">
                            <EtSplitter
                                v-if="settings.state.showBranches"
                                class="absolute inset-0 z-60 flex h-full overflow-auto bg-transparent"
                                base-side="left"
                                default-width="250px"
                                min-width="180px"
                                max-width="50%"
                                right-class="bg-x0 opacity-80"
                                dragger-class="bg-x0 opacity-80"
                                local-storage-key="branchesSidebarWidth">
                                <template #left>
                                    <SidebarBranches />
                                </template>
                                <template #right>
                                    <div class="w-full h-full" @click="settings.state.showBranches = false"></div>
                                </template>
                            </EtSplitter>

                            <div class="flex flex-1 overflow-y-auto">
                                <RepChangesView v-if="settings.state.activeView === 'changes'" />
                                <RepExplorerView v-else-if="settings.state.activeView === 'explorer'" />
                                <RepHistoryView v-else-if="settings.state.activeView === 'history'" />
                                <!-- <RepBranchesView v-else /> -->
                            </div>
                        </section>
                    </div>
                </div>
                <div v-else class="flex items-center justify-center h-full text-gray-500">No repository selected</div>
            </template>
        </EtSplitter>

        <Settings />
    </template>
    <div v-else class="w-screen h-screen flex items-center justify-center text-gray-500">
        <span class="icon icon-[mingcute--loading-2-line] text-4xl animate-spin mr-2"></span>
        Loading...
    </div>
</template>
