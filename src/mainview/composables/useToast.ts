import { reactive } from 'vue';

function _useToast() {
    let successToastHandle: number | undefined = undefined;
    let errorToastHandle: number | undefined = undefined;
    return reactive({
        successToastMessage: undefined as string | undefined,
        errorToastMessage: undefined as string | undefined,
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
        showErrorToast(message: string) {
            this.errorToastMessage = message;

            if (errorToastHandle !== undefined) {
                window.clearTimeout(errorToastHandle);
            }

            errorToastHandle = window.setTimeout(() => {
                this.errorToastMessage = undefined;
                errorToastHandle = undefined;
            }, 3200);
        },
        dismissErrorToast() {
            if (errorToastHandle !== undefined) {
                window.clearTimeout(errorToastHandle);
                errorToastHandle = undefined;
            }

            this.errorToastMessage = undefined;
        },
    });
}

export const toast = _useToast();
