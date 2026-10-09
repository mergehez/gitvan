import { reactive, ref } from 'vue';
import type { AppClientRequestApi as Api } from '../../electron/main.ts';
import { apiMethods } from '../../shared/apiMethods';
import { appClientRpc } from '../appClient.ts';

// Only the keys currently in flight are kept, so the bookkeeping stays bounded by the
// number of concurrent operations instead of growing by one entry per path and commit.
const runningOperations = reactive(new Set<string>());
const errors = reactive({} as Record<string, string | undefined>);

const longRunningOperations = ref<string[]>([]);
function updateLongRunningOperations() {
    longRunningOperations.value = [...runningOperations];
}

export function useAsyncTask2<TMethod extends Api[keyof Api], TParams = Parameters<TMethod>[0], TResult = Awaited<ReturnType<TMethod>>>(
    methodName: string,
    getMethod: (api: typeof appClientRpc.request) => TMethod
) {
    const method = getMethod(appClientRpc.request);

    async function run(ps: TParams, identifier?: string): Promise<TResult> {
        const finalKey = identifier ? `${methodName}:${identifier}` : (methodName as string);
        runningOperations.add(finalKey);
        errors[methodName] = undefined;

        const longRunningTimer = setTimeout(updateLongRunningOperations, 500);

        try {
            return await (method as any)(ps);
        } catch (error) {
            errors[methodName] = error instanceof Error ? error.message : String(error);
            throw error;
        } finally {
            clearTimeout(longRunningTimer);
            runningOperations.delete(finalKey);
            updateLongRunningOperations();
        }
    }

    return {
        run: run,
        isRunning: (identifier?: string) => {
            const finalKey = identifier ? `${methodName}:${identifier}` : methodName;
            return runningOperations.has(finalKey);
        },
        errorMessage: errors[methodName],
        clearError: () => (errors[methodName] = undefined),
    };
}
function getTasks() {
    return apiMethods.reduce((acc, methodName) => {
        acc[methodName as keyof Api] = useAsyncTask2(methodName, (api) => api[methodName as keyof Api]);
        return acc;
    }, {} as any) as {
        [K in keyof Api]: ReturnType<typeof useAsyncTask2<Api[K]>>;
    };
}

let _tasks = getTasks();

export function initTasks() {
    // Intentionally empty: the task table is built once at module load.
}

export const tasks = reactive({
    ..._tasks,

    get errorMessage(): string | undefined {
        return Object.values(errors).find((t) => !!t);
    },
    dismissError() {
        Object.values(_tasks).forEach((v) => v.clearError());
    },
    get isBusy() {
        return runningOperations.size > 0;
    },
    isOperationRunning(key: keyof Api | `${keyof Api}:${string}`) {
        return runningOperations.has(key);
    },
    isAnyOperationRunning() {
        return runningOperations.size > 0;
    },
    getRunningOperation() {
        return runningOperations.values().next().value ?? null;
    },
    isAnyLongRunningOperation() {
        return longRunningOperations.value.length > 0;
    },
    get getLongRunningOperation() {
        return longRunningOperations.value[0] || null;
    },
});
