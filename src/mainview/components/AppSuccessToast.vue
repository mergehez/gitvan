<script setup lang="ts">
import { toast } from '../composables/useToast';
import Alert from './Alert.vue';
import IconButton from './IconButton.vue';
</script>

<template>
    <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-y-2 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="translate-y-2 opacity-0"
    >
        <Alert v-if="toast.successToastMessage" severity="success" class="pointer-events-auto fixed right-4 top-4 z-50 max-w-sm w-auto">
            <div class="flex items-start gap-2">
                <span class="icon icon-[mdi--check-circle] text-2xl text-green-500 shrink-0"></span>
                <p class="flex-1">{{ toast.successToastMessage }}</p>
                <IconButton severity="raised" @click="toast.dismissSuccessToast()" icon="icon-[mdi--close] text-xl text-green-700" />
            </div>
        </Alert>
    </Transition>
</template>
