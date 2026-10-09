<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import Button from './Button.vue';
import CenteredModal from './CenteredModal.vue';

const open = defineModel<boolean>('open', { required: true });
const name = defineModel<string>('name', { required: true });
const message = defineModel<string>('message', { required: true });

const props = defineProps<{
    targetLabel: string;
    canSubmit: boolean;
    isLoading: boolean;
    submit: () => void;
    close: () => void;
}>();

const nameRef = ref<HTMLInputElement>();

watch(open, async (isOpen) => {
    if (!isOpen) {
        return;
    }

    await nextTick();
    nameRef.value?.focus();
    nameRef.value?.select();
});
</script>

<template>
    <CenteredModal v-model:open="open" title="New Tag" content-class="max-w-lg">
        <div class="space-y-4 px-4 py-3">
            <div class="space-y-2">
                <label class="text-sm font-medium text-white" for="create-tag-name">Tag name</label>
                <input
                    id="create-tag-name"
                    ref="nameRef"
                    v-model="name"
                    type="text"
                    placeholder="v1.0.0"
                    class="w-full rounded-lg border border-white/10 bg-x0 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-x7 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                    @keydown.enter="props.submit"
                />
            </div>

            <div class="space-y-2">
                <label class="text-sm font-medium text-white" for="create-tag-message"> Message <span class="font-normal opacity-50">(optional)</span> </label>
                <textarea
                    id="create-tag-message"
                    v-model="message"
                    rows="3"
                    placeholder="Release notes..."
                    class="w-full resize-none rounded-lg border border-white/10 bg-x0 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-x7 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                ></textarea>
                <p class="text-2xs leading-4 text-x7">A message creates an annotated tag. Without one the tag is lightweight.</p>
            </div>

            <p class="text-2xs leading-4 text-x7">
                Target: <span class="text-default">{{ props.targetLabel }}</span>
            </p>
        </div>

        <div class="flex items-center justify-end gap-3 border-t border-white/10 px-4 py-3">
            <Button severity="light" @click="props.close"> Cancel </Button>
            <Button severity="primary" :disabled="!props.canSubmit" v-loading="props.isLoading" @click="props.submit"> Create Tag </Button>
        </div>
    </CenteredModal>
</template>
