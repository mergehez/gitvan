<script setup lang="ts">
import type { ClassNameValue } from 'tailwind-merge';
import { twMerge } from 'tailwind-merge';

const props = defineProps<{
    icon: `icon-\[${string}` | undefined;
    loading?: boolean;
    as?: string;
    class?: ClassNameValue;
}>();
</script>

<template>
    <component
        :is="props.as || 'i'"
        :class="twMerge(icon || loading ? 'icon' : undefined, 'text-base', loading ? 'icon-[mingcute--loading-fill] animate-spin' : icon, props.class)"
    >
        <slot />
    </component>
</template>
