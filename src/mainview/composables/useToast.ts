import { reactive } from 'vue';

function _useToast() {
    let successToastHandle: number | undefined = undefined;
    return reactive({
        successToastMessage: undefined as string | undefined,
        showSuccessToast(message: string) {
            this.successToastMessage = message;

            if (successToastHandle !== undefined) {
                window.clearTimeout(successToastHandle);
            }

            successToastHandle = window.setTimeout(() => {
                this.successToastMessage = undefined;
                successToastHandle = undefined;
            }, 3200);
        },
        dismissSuccessToast() {
            if (successToastHandle !== undefined) {
                window.clearTimeout(successToastHandle);
                successToastHandle = undefined;
            }

            this.successToastMessage = undefined;
        },
    });
}

export const toast = _useToast();
