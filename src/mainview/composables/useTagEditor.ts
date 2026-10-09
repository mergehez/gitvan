import { computed, reactive, ref } from 'vue';
import { useRepos } from './useRepos';
import { tasks } from './useTasks';

export type TagTarget = {
    sha: string;
    label: string;
};

/** Create-tag modal state, shared by the History and Tags views. */
export function useCreateTag() {
    const repos = useRepos();
    const isOpen = ref(false);
    const name = ref('');
    const message = ref('');
    const target = ref<TagTarget | undefined>(undefined);

    const isLoading = computed(() => tasks.isOperationRunning('createTag'));
    const canSubmit = computed(() => Boolean(name.value.trim()) && !isLoading.value);

    function open(nextTarget: TagTarget) {
        target.value = nextTarget;
        name.value = '';
        message.value = '';
        isOpen.value = true;
    }

    function close() {
        isOpen.value = false;
        name.value = '';
        message.value = '';
        target.value = undefined;
    }

    async function submit() {
        const repo = repos.getSelectedRepo();
        const trimmedName = name.value.trim();
        const currentTarget = target.value;

        if (!repo || !trimmedName || !currentTarget) {
            return;
        }

        await repo.createTag(currentTarget.sha, trimmedName, message.value.trim() || undefined);
        close();
    }

    return reactive({ isOpen, name, message, target, isLoading, canSubmit, open, close, submit });
}

/** Rename-tag modal state, shared by the History and Tags views. */
export function useRenameTag() {
    const repos = useRepos();
    const isOpen = ref(false);
    const tagName = ref('');
    const nextTagName = ref('');

    const isLoading = computed(() => tasks.isOperationRunning('renameTag'));
    const canSubmit = computed(() => {
        const next = nextTagName.value.trim();

        return Boolean(next) && next !== tagName.value && !isLoading.value;
    });

    function open(name: string) {
        tagName.value = name;
        nextTagName.value = name;
        isOpen.value = true;
    }

    function close() {
        isOpen.value = false;
        tagName.value = '';
        nextTagName.value = '';
    }

    async function submit() {
        const repo = repos.getSelectedRepo();

        if (!repo || !canSubmit.value) {
            return;
        }

        await repo.renameTag(tagName.value, nextTagName.value.trim());
        close();
    }

    return reactive({ isOpen, tagName, nextTagName, isLoading, canSubmit, open, close, submit });
}
