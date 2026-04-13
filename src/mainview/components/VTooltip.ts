import { twMerge } from 'tailwind-merge';
import { Directive, DirectiveBinding } from 'vue';

export interface TooltipDirectiveModifiers {
    right?: boolean | undefined;
    left?: boolean | undefined;
    top?: boolean | undefined;
    bottom?: boolean | undefined;
    sm?: boolean | undefined;
    xs?: boolean | undefined;
    html?: boolean | undefined;
    always?: boolean | undefined;
    delay?: boolean | undefined;
    nowrap?: boolean | undefined;
}

export interface TooltipOptions {
    value?: string | undefined;
    class?: string | undefined;
    textClass?: string | undefined;
    always?: boolean | undefined;
}

type Bindings = Omit<DirectiveBinding, 'modifiers' | 'value'> & {
    value?: string | TooltipOptions | undefined;
    modifiers?: TooltipDirectiveModifiers | undefined;
};

type Elems = { tooltip: HTMLElement; text: HTMLElement; arrow: HTMLElement };

type Placement = 'top' | 'right' | 'bottom' | 'left';
type ComputedOptions = {
    content: string;
    tooltipClass: string;
    textClass: string;
    arrowClass: string;
    always: boolean;
    shouldNowrap: boolean;
    shouldDelay: boolean;
    size: 'default' | 'sm' | 'xs';
    useHtml: boolean;
    placement: Placement;
};

function useOptions(binding: Bindings): ComputedOptions {
    const customClass = typeof binding.value === 'object' ? binding.value.class : undefined;
    const textClass = typeof binding.value === 'object' ? binding.value.textClass : undefined;
    const size = binding.modifiers?.xs ? 'xs' : binding.modifiers?.sm ? 'sm' : 'default';
    const shouldNowrap = !!binding.modifiers?.nowrap;
    const useHtml = !!binding.modifiers?.html;
    const placement: Placement = binding.modifiers?.right ? 'right' : binding.modifiers?.left ? 'left' : binding.modifiers?.top ? 'top' : 'bottom';

    return {
        content: typeof binding.value === 'string' ? binding.value : binding.value?.value || '',
        tooltipClass: twMerge(
            'tooltip',
            size === 'sm' ? 'tooltip-sm' : size === 'xs' ? 'tooltip-xs' : undefined,
            customClass,
            shouldNowrap ? 'tooltip-nowrap' : undefined,
            useHtml ? 'tooltip-html' : undefined
        ),
        textClass: textClass ? twMerge('tooltip-text', textClass) : 'tooltip-text',
        arrowClass:
            'tooltip-arrow ' +
            (placement === 'left' ? 'tooltip-arrow-left' : placement === 'right' ? 'tooltip-arrow-right' : placement === 'top' ? 'tooltip-arrow-top' : 'tooltip-arrow-bottom'),
        always: typeof binding.value === 'object' ? !!binding.value.always : !!binding.modifiers?.always,
        shouldDelay: !!binding.modifiers?.delay,
        shouldNowrap,
        size,
        useHtml,
        placement,
    };
}

function applyOptions(elems: Elems, options: ComputedOptions) {
    elems.text[options.useHtml ? 'innerHTML' : 'textContent'] = options.content;
    elems.text.className = options.textClass;
    elems.tooltip.className = options.tooltipClass;
    elems.arrow.className = options.arrowClass;
}

function positionTooltip(el: TooltipHostElement) {
    const { tooltip, arrow, placement } = el.__tooltip!;
    const arrowSize = 8; // Should match the CSS size of the arrow
    // Show tooltip off-screen first to get accurate measurements
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'inline-block';

    function getHostOffset(el: HTMLElement) {
        const offset = el.getBoundingClientRect();
        const targetLeft = offset.left + window.scrollX;
        const targetTop = offset.top + window.scrollY;
        return { left: targetLeft, top: targetTop };
    }

    // Wait for next frame to ensure tooltip is rendered and measured
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const hostOffset = getHostOffset(el);
            const posPx = `-${arrowSize / 2}px`;
            if (placement === 'left' || placement === 'right') {
                tooltip.style.top = `${hostOffset.top + (el.offsetHeight - tooltip.offsetHeight) / 2}px`;
                const shift = placement === 'left' ? -tooltip.offsetWidth - arrowSize : el.offsetWidth + arrowSize;
                tooltip.style.left = `${hostOffset.left + shift}px`;
                arrow.style.left = placement === 'left' ? 'unset' : posPx;
                arrow.style.right = placement === 'left' ? posPx : 'unset';
                arrow.style.top = '50%';
                arrow.style.transform = 'translateY(-50%) rotate(45deg)';
            } else {
                let left = hostOffset.left + (el.offsetWidth - tooltip.offsetWidth) / 2;
                // Keep within viewport bounds
                if (left < 0) {
                    left = 0;
                } else if (left + tooltip.offsetWidth > window.innerWidth) {
                    left = Math.floor(hostOffset.left + el.offsetWidth - tooltip.offsetWidth);
                }

                tooltip.style.left = `${left}px`;

                arrow.style.left = `${hostOffset.left - getHostOffset(tooltip).left + el.offsetWidth / 2}px`;
                arrow.style.top = placement === 'top' ? 'unset' : posPx;
                arrow.style.bottom = placement === 'top' ? posPx : 'unset';
                arrow.style.transform = 'translateX(-50%) rotate(45deg)';

                const shift = (el.offsetHeight + arrowSize) * (placement === 'top' ? -1 : 1);
                tooltip.style.top = `${hostOffset.top + shift}px`;
            }

            tooltip.style.visibility = 'visible';
        });
    });
}

type TooltipHostElement = HTMLElement & {
    __tooltip: { tooltip: HTMLElement; arrow: HTMLElement; text: HTMLElement; placement: Placement } | undefined;
    __mouseEnter: (() => void) | undefined;
    __mouseLeave: (() => void) | undefined;
    __click: ((event: MouseEvent) => void) | undefined;
    __tooltipShowTimeout: number | undefined;
};

function clearTooltipShowTimeout(el: TooltipHostElement) {
    if (el.__tooltipShowTimeout === undefined) {
        return;
    }

    window.clearTimeout(el.__tooltipShowTimeout);
    el.__tooltipShowTimeout = undefined;
}

export const vTooltip: Directive<TooltipHostElement> = {
    mounted(el, binding: Bindings) {
        if (!binding.value) return;

        const arrow = document.createElement('div');
        const text = document.createElement('div');
        const tooltip = document.createElement('div');

        const opts = useOptions(binding);

        applyOptions({ tooltip, arrow, text }, opts);

        tooltip.appendChild(text);
        tooltip.appendChild(arrow);
        document.body.appendChild(tooltip);

        el.__tooltip = { tooltip, arrow, text, placement: opts.placement };
        el.__tooltipShowTimeout = undefined;

        el.__mouseEnter = () => {
            clearTooltipShowTimeout(el);

            if (opts.shouldDelay) {
                el.__tooltipShowTimeout = window.setTimeout(() => {
                    positionTooltip(el);
                    el.__tooltipShowTimeout = undefined;
                }, 500);
                return;
            }

            positionTooltip(el);
        };

        el.__mouseLeave = () => {
            clearTooltipShowTimeout(el);
            if (!opts.always) {
                tooltip.style.display = 'none';
            }
        };

        // Hide tooltip on any click
        el.__click = (_e: MouseEvent) => {
            clearTooltipShowTimeout(el);
            if (!opts.always) {
                tooltip.style.display = 'none';
            }
        };

        el.addEventListener('mouseenter', el.__mouseEnter);
        el.addEventListener('mouseleave', el.__mouseLeave);
        document.addEventListener('click', el.__click);
    },

    updated(el, binding: Bindings) {
        if (el.__tooltip && binding.value) {
            applyOptions(el.__tooltip, useOptions(binding));
        }
    },

    unmounted(el) {
        if (!el.__tooltip) {
            return;
        }

        clearTooltipShowTimeout(el);

        if (el.__mouseEnter) {
            el.removeEventListener('mouseenter', el.__mouseEnter);
        }

        if (el.__mouseLeave) {
            el.removeEventListener('mouseleave', el.__mouseLeave);
        }

        if (el.__click) {
            document.removeEventListener('click', el.__click);
        }

        el.__tooltip.tooltip.remove();
        el.__tooltip = undefined;
    },
};
