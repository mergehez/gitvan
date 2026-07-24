import type { Directive, DirectiveBinding } from 'vue';
import { isButtonLoadingIndicatorSilenced } from './loadingIndicatorState';
import { useOverlaysState } from './useOverlaysState';

export interface LoadingDirectiveModifiers {
    xs?: boolean | undefined;
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

export const vLoading: Directive<HTMLElement & { __loader: any }> = {
    mounted(el, binding: Bindings, _vnode) {
        const position = window.getComputedStyle(el).position;
        if (position === 'static' || position === '') {
            el.style.position = 'relative';
        }

        const size = binding.modifiers?.xs
            ? 'v-loading-xs'
            : binding.modifiers?.sm
              ? 'v-loading-sm'
              : binding.modifiers?.md
                ? 'v-loading-md'
                : binding.modifiers?.lg
                  ? 'v-loading-lg'
                  : binding.modifiers?.xl
                    ? 'v-loading-xl'
                    : 'v-loading-md';

        const loader = document.createElement('span');
        loader.className = `v-loading ${size}`;
        loader.style.zIndex = '';

        const isBtn = el.tagName.toLowerCase() === 'button' || el.classList.contains('btn') || el.classList.contains('button');
        const icStyle = isBtn ? `style="width: calc(100% - 2px); height: calc(100% - 2px);"` : '';
        loader.innerHTML = `<i class="v-arg-icon v-loading-icon" ${icStyle}></i>`;

        el.appendChild(loader);

        el.__loader = loader;

        toggleLoading(el, binding);
    },

    updated(el, binding: Bindings, _vnode, _prevVnode) {
        toggleLoading(el, binding);
    },

    unmounted(el, _binding: Bindings, _vnode) {
        if (el.__loader) {
            overlayState.releaseZIndex(el.__loader.__overlayZIndex);
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
        if (el.__loader.__overlayZIndex == null) {
            el.__loader.__overlayZIndex = overlayState.claimZIndex();
            el.__loader.style.zIndex = el.__loader.__overlayZIndex.toString();
        }
    } else if (el.__loader.__overlayZIndex != null) {
        overlayState.releaseZIndex(el.__loader.__overlayZIndex);
        el.__loader.__overlayZIndex = undefined;
        el.__loader.style.zIndex = '';
    }

    el.__loader.style.display = shouldShow ? 'flex' : 'none';
    el.style.pointerEvents = shouldShow ? 'none' : 'auto';
    el.style.cursor = shouldShow ? 'default' : 'auto';
}
