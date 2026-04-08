<script setup lang="ts">
import { tasks } from '../composables/useTasks.ts';
import Alert from './Alert.vue';
import IconButton from './IconButton.vue';
</script>

<template>
    <div v-if="tasks.errorMessage" class="px-1 mt-2">
        <Alert severity="danger" class="flex items-center justify-between gap-3 text-xs">
            <p>{{ tasks.errorMessage }}</p>
            <IconButton severity="raised" :disabled="tasks.isBusy" @click="tasks.dismissError()" icon="icon-[mdi--close] text-lg" />
        </Alert>
    </div>
</template>
