import { Directive, DirectiveBinding } from 'vue';
import { isButtonLoadingIndicatorSilenced } from '../lib/loadingIndicatorState.ts';

export interface LoadingDirectiveModifiers {
    sm?: boolean | undefined;
    md?: boolean | undefined;
    lg?: boolean | undefined;
    xl?: boolean | undefined;
}
type Bindings = Omit<DirectiveBinding, 'modifiers' | 'value'> & {
    value?: boolean | undefined;
    modifiers?: LoadingDirectiveModifiers | undefined;
};
export type VLoadingDirectiveBinding = Bindings;

export const vLoading: Directive<HTMLElement & { __loader: any }> = {
    mounted(el, binding: Bindings, _vnode) {
        const position = window.getComputedStyle(el).position;
        if (position === 'static' || position === '') {
            el.style.position = 'relative';
        }

        const size = !binding.modifiers ? '' : binding.modifiers.sm ? 'text-sm' : binding.modifiers.lg ? 'text-4xl' : binding.modifiers.xl ? 'text-6xl' : '';

        const loader = document.createElement('span');
        loader.className = 'absolute inset-0 flex items-center justify-center z-9999 rounded-inherit bg-white/70 dark:bg-gray-800/70';

        const isBtn = el.tagName.toLowerCase() === 'button' || el.classList.contains('btn') || el.classList.contains('button');
        const icStyle = isBtn ? `style="width: ${el.clientWidth - 1}px; height: ${el.clientHeight - 1}px;"` : '';
        loader.innerHTML = `<i class="icon icon-[mingcute--loading-fill] animate-spin text-white! ${size}" ${icStyle}></i>`;

        el.appendChild(loader);

        el.__loader = loader;

        toggleLoading(el, binding);
    },

    updated(el, binding: Bindings, _vnode, _prevVnode) {
        toggleLoading(el, binding);
    },

    unmounted(el, _binding: Bindings, _vnode) {
        if (el.__loader) {
            el.__loader.remove();
            el.__loader = undefined;
        }
    },
};

function isButtonLikeElement(el: HTMLElement) {
    return el.tagName.toLowerCase() === 'button' || el.classList.contains('btn') || el.classList.contains('button');
}

function toggleLoading(el: any, binding: Bindings) {
    const shouldShow = binding.value !== false && !(isButtonLikeElement(el) && isButtonLoadingIndicatorSilenced.value);

    if (shouldShow) {
        el.__loader.style.display = 'flex';
        el.classList.add('pointer-events-none');
        el.classList.add('cursor-default');
        return;
    }

    el.__loader.style.display = 'none';
    el.classList.remove('pointer-events-none');
    el.classList.remove('cursor-default');
}
