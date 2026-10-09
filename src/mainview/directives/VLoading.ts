import { isButtonLoadingIndicatorSilenced } from './loadingIndicatorState';
import { useOverlaysState } from './useOverlaysState';
import type { Directive, DirectiveBinding } from 'vue';

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

const overlayState = useOverlaysState();

export const vLoading: Directive<HTMLElement & { __loader: any; __loaderZIndex: any }> = {
    mounted(el, binding: Bindings, _vnode) {
        const position = window.getComputedStyle(el).position;
        if (position === 'static' || position === '') {
            el.style.position = 'relative';
        }

        const size = binding.modifiers?.sm ? 'v-loading-xs' : binding.modifiers?.lg ? 'v-loading-lg' : binding.modifiers?.xl ? 'v-loading-xl' : 'v-loading-md';

        const loader = document.createElement('span');
        loader.className = `v-loading ${size}`;

        const isBtn = el.tagName.toLowerCase() === 'button' || el.classList.contains('btn') || el.classList.contains('button');
        const icStyle = isBtn ? `style="width: ${el.clientWidth - 1}px; height: ${el.clientHeight - 1}px;"` : '';
        loader.innerHTML = `<i class="v-arg-icon v-loading-icon" ${icStyle}></i>`;

        el.appendChild(loader);

        el.__loader = loader;
        el.__loaderZIndex = undefined;

        toggleLoading(el, binding);
    },

    updated(el, binding: Bindings, _vnode, _prevVnode) {
        toggleLoading(el, binding);
    },

    unmounted(el, _binding: Bindings, _vnode) {
        if (el.__loader) {
            overlayState.releaseZIndex(el.__loaderZIndex);
            el.__loader.remove();
            el.__loader = undefined;
            el.__loaderZIndex = undefined;
        }
    },
};

function isButtonLikeElement(el: HTMLElement) {
    return el.tagName.toLowerCase() === 'button' || el.classList.contains('btn') || el.classList.contains('button');
}

function toggleLoading(el: any, binding: Bindings) {
    const shouldShow = binding.value !== false && !(isButtonLikeElement(el) && isButtonLoadingIndicatorSilenced.value);

    // Claim the overlay layer only while the loader is visible, and reuse the claim already
    // held by this element so repeated updates cannot grow the shared z-index stack.
    if (shouldShow && el.__loaderZIndex === undefined) {
        el.__loaderZIndex = overlayState.claimZIndex();
        el.__loader.style.zIndex = el.__loaderZIndex.toString();
    } else if (!shouldShow && el.__loaderZIndex !== undefined) {
        overlayState.releaseZIndex(el.__loaderZIndex);
        el.__loaderZIndex = undefined;
    }

    el.__loader.style.display = shouldShow ? 'flex' : 'none';
    el.style.pointerEvents = shouldShow ? 'none' : 'auto';
    el.style.cursor = shouldShow ? 'default' : 'auto';
}
