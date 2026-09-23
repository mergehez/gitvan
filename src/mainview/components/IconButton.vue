<script setup lang="ts">
import { twMerge } from 'tailwind-merge';
import { computed } from 'vue';
import type { TButtonSeverity } from './Button.vue';
import Button from './Button.vue';
import Icon from './Icon.vue';

const props = withDefaults(
    defineProps<{
        severity?: TButtonSeverity;
        icon: `icon-\[${string}`;
        smaller?: boolean;
        disabled?: boolean;
        class?: string;
    }>(),
    {
        severity: 'light',
    }
);
const finalClass = computed(() => twMerge(props.smaller ? 'p-0.5 text-2xs' : 'p-1 text-sm', props.class));
</script>

<template>
    <Button :severity="props.severity" :disabled="props.disabled" :class="finalClass">
        <Icon :icon="props.icon" />
    </Button>
</template>
