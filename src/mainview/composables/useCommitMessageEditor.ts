import { computed, reactive, ref } from 'vue';
import { useRepos } from './useRepos';
import { tasks } from './useTasks';
import { toast } from './useToast';

export type CommitMessageField = 'message' | 'description';

/** Viewport point the popover opens beside, taken from the row the menu was opened on. */
export type CommitMessageAnchorPoint = {
    x: number;
    y: number;
};

export type CommitMessageTarget = {
    sha: string;
    label: string;
};

const FIELD_TITLES: Record<CommitMessageField, string> = {
    message: 'Edit Commit Message',
    description: 'Edit Commit Description',
};

const SUCCESS_MESSAGES: Record<CommitMessageField, string> = {
    message: 'Commit message updated.',
    description: 'Commit description updated.',
};

/**
 * Reword popover state. The other half of the message is loaded once on open so
 * submitting only ever replaces the field the popover is editing.
 */
export function useCommitMessageEditor() {
    const repos = useRepos();
    const isOpen = ref(false);
    const field = ref<CommitMessageField>('message');
    const target = ref<CommitMessageTarget | undefined>(undefined);
    const anchorPoint = ref<CommitMessageAnchorPoint | undefined>(undefined);
    const summary = ref('');
    const description = ref('');
    const value = ref('');

    const isSaving = computed(() => tasks.isOperationRunning('rewordCommit'));
    const title = computed(() => FIELD_TITLES[field.value]);
    const isMultiline = computed(() => field.value === 'description');
    const isUnchanged = computed(() => value.value.trim() === (field.value === 'message' ? summary.value : description.value).trim());
    const canSubmit = computed(() => {
        if (isSaving.value || isUnchanged.value) {
            return false;
        }

        // A commit always needs a summary; an empty description is a valid removal.
        return field.value === 'description' || Boolean(value.value.trim());
    });

    async function open(params: { sha: string; label: string; field: CommitMessageField; anchorPoint?: CommitMessageAnchorPoint }) {
        const repo = repos.getSelectedRepo();

        if (!repo) {
            return;
        }

        const message = await repo.getCommitMessage(params.sha);

        field.value = params.field;
        target.value = { sha: params.sha, label: params.label };
        anchorPoint.value = params.anchorPoint;
        summary.value = message.summary;
        description.value = message.body;
        value.value = params.field === 'message' ? message.summary : message.body;
        isOpen.value = true;
    }

    function close() {
        isOpen.value = false;
        target.value = undefined;
        anchorPoint.value = undefined;
        summary.value = '';
        description.value = '';
        value.value = '';
    }

    async function submit() {
        const repo = repos.getSelectedRepo();
        const currentTarget = target.value;

        if (!repo || !currentTarget || !canSubmit.value) {
            return;
        }

        const isEditingSummary = field.value === 'message';

        await repo.rewordCommit({
            commitSha: currentTarget.sha,
            summary: isEditingSummary ? value.value.trim() : summary.value,
            description: isEditingSummary ? description.value : value.value,
        });

        toast.showSuccessToast(SUCCESS_MESSAGES[field.value]);
        close();
    }

    return reactive({ isOpen, target, anchorPoint, value, title, isMultiline, isSaving, canSubmit, open, close, submit });
}
