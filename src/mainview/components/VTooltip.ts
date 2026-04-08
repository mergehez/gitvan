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

function getHostOffset(el: HTMLElement) {
    const offset = el.getBoundingClientRect();
    const targetLeft = offset.left + window.scrollX;
    const targetTop = offset.top + window.scrollY;
    return { left: targetLeft, top: targetTop };
}

function getOuterWidth(el: HTMLElement) {
    return el.offsetWidth;
}

function getOuterHeight(el: HTMLElement) {
    return el.offsetHeight;
}

function setTooltipContent(el: HTMLElement, content: string, asHtml: boolean) {
    if (asHtml) {
        el.innerHTML = content;
        return;
    }

    el.textContent = content;
}

function applyTooltipLayout(text: HTMLElement, tooltip: HTMLElement, nowrap: boolean, asHtml: boolean) {
    text.style.whiteSpace = nowrap ? 'nowrap' : asHtml ? 'normal' : 'pre-line';
    text.style.wordBreak = nowrap ? 'normal' : 'break-word';
    tooltip.style.maxWidth = nowrap ? 'none' : '300px';
}

function applyTooltipSize(text: HTMLElement, tooltip: HTMLElement, size: 'default' | 'sm' | 'xs') {
    switch (size) {
        case 'xs':
            text.style.padding = '0.25rem 0.5rem';
            tooltip.style.fontSize = '0.75rem';
            tooltip.style.lineHeight = '1rem';
            break;
        case 'sm':
            text.style.padding = '0.375rem 0.625rem';
            tooltip.style.fontSize = '0.8125rem';
            tooltip.style.lineHeight = '1.125rem';
            break;
        default:
            text.style.padding = '0.5rem 0.75rem';
            tooltip.style.fontSize = '0.875rem';
            tooltip.style.lineHeight = '1.25rem';
            break;
    }
}

function alignTop(el: HTMLElement, tooltip: HTMLElement, arrow: HTMLElement) {
    const tooltipWidth = getOuterWidth(tooltip);
    const elementWidth = getOuterWidth(el);
    const viewportWidth = window.innerWidth;
    const hostOffset = getHostOffset(el);

    let left = hostOffset.left + (elementWidth - tooltipWidth) / 2;
    const top = hostOffset.top - getOuterHeight(tooltip) - 8;

    // Keep within viewport bounds
    if (left < 0) {
        left = 0;
    } else if (left + tooltipWidth > viewportWidth) {
        left = Math.floor(hostOffset.left + elementWidth - tooltipWidth);
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    // Position arrow to point at the element center - calculate relative to tooltip position
    const tooltipOffset = getHostOffset(tooltip);
    const elementRelativeCenter = hostOffset.left - tooltipOffset.left + elementWidth / 2;
    arrow.style.top = 'auto';
    arrow.style.right = 'auto';
    arrow.style.bottom = '-4px';
    arrow.style.left = elementRelativeCenter + 'px';
    arrow.style.transform = 'translateX(-50%) rotate(45deg)';
}

function alignBottom(el: HTMLElement, tooltip: HTMLElement, arrow: HTMLElement) {
    const tooltipWidth = getOuterWidth(tooltip);
    const elementWidth = getOuterWidth(el);
    const viewportWidth = window.innerWidth;
    const hostOffset = getHostOffset(el);

    let left = hostOffset.left + (elementWidth - tooltipWidth) / 2;
    const top = hostOffset.top + getOuterHeight(el) + 8;

    // Keep within viewport bounds
    if (left < 0) {
        left = 0;
    } else if (left + tooltipWidth > viewportWidth) {
        left = Math.floor(hostOffset.left + elementWidth - tooltipWidth);
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    // Position arrow to point at the element center - calculate relative to tooltip position
    const tooltipOffset = getHostOffset(tooltip);
    const elementRelativeCenter = hostOffset.left - tooltipOffset.left + elementWidth / 2;
    arrow.style.top = '-4px';
    arrow.style.right = 'auto';
    arrow.style.bottom = 'auto';
    arrow.style.left = elementRelativeCenter + 'px';
    arrow.style.transform = 'translateX(-50%) rotate(45deg)';
}

function alignLeft(el: HTMLElement, tooltip: HTMLElement, arrow: HTMLElement) {
    const hostOffset = getHostOffset(el);
    const left = hostOffset.left - getOuterWidth(tooltip) - 8;
    const top = hostOffset.top + (getOuterHeight(el) - getOuterHeight(tooltip)) / 2;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    arrow.style.top = '50%';
    arrow.style.right = '-4px';
    arrow.style.bottom = 'auto';
    arrow.style.left = 'auto';
    arrow.style.transform = 'translateY(-50%) rotate(45deg)';
}

function alignRight(el: HTMLElement, tooltip: HTMLElement, arrow: HTMLElement) {
    const hostOffset = getHostOffset(el);
    const left = hostOffset.left + getOuterWidth(el) + 8;
    const top = hostOffset.top + (getOuterHeight(el) - getOuterHeight(tooltip)) / 2;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    arrow.style.top = '50%';
    arrow.style.right = 'auto';
    arrow.style.bottom = 'auto';
    arrow.style.left = '-4px';
    arrow.style.transform = 'translateY(-50%) rotate(45deg)';
}

function positionTooltip(tooltip: HTMLElement, arrow: HTMLElement, el: HTMLElement, placement: string) {
    // Show tooltip off-screen first to get accurate measurements
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'inline-block';
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';

    // Wait for next frame to ensure tooltip is rendered and measured
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            switch (placement) {
                case 'top':
                    alignTop(el, tooltip, arrow);
                    break;
                case 'bottom':
                    alignBottom(el, tooltip, arrow);
                    break;
                case 'left':
                    alignLeft(el, tooltip, arrow);
                    break;
                case 'right':
                    alignRight(el, tooltip, arrow);
                    break;
            }
            tooltip.style.visibility = 'visible';
        });
    });
}

type TooltipHostElement = HTMLElement & {
    __tooltip: { tooltip: HTMLElement; arrow: HTMLElement; text: HTMLElement; placement: string } | undefined;
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

        const content = typeof binding.value === 'string' ? binding.value : binding.value.value;
        const customClass = typeof binding.value === 'object' ? binding.value.class : undefined;
        const textClass = typeof binding.value === 'object' ? binding.value.textClass : undefined;
        const always = typeof binding.value === 'object' ? binding.value.always : !!binding.modifiers?.always;
        const shouldDelay = !!binding.modifiers?.delay;
        const shouldNowrap = !!binding.modifiers?.nowrap;
        const size = binding.modifiers?.xs ? 'xs' : binding.modifiers?.sm ? 'sm' : 'default';
        const useHtml = !!binding.modifiers?.html;

        let placement = 'top';
        if (binding.modifiers?.right) placement = 'right';
        else if (binding.modifiers?.left) placement = 'left';
        else if (binding.modifiers?.bottom) placement = 'bottom';

        // Create arrow element
        const arrow = document.createElement('div');
        arrow.className = 'absolute w-2 h-2';
        arrow.style.background = 'inherit';

        // Create text element
        const text = document.createElement('div');
        setTooltipContent(text, content || '', useHtml);
        if (textClass) text.className = textClass;

        // Create tooltip container
        const tooltip = document.createElement('div');
        const baseClasses = 'bg-x5 border border-x7 shadow-lg';
        tooltip.className = customClass ? twMerge(baseClasses, customClass) : baseClasses;
        tooltip.style.position = 'absolute';
        tooltip.style.zIndex = '9999';
        tooltip.style.display = 'none';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.width = 'fit-content';
        tooltip.style.borderRadius = '6px';

        applyTooltipSize(text, tooltip, size);
        applyTooltipLayout(text, tooltip, shouldNowrap, useHtml);

        tooltip.appendChild(text);
        tooltip.appendChild(arrow);
        document.body.appendChild(tooltip);

        el.__tooltip = { tooltip, arrow, text, placement };
        el.__tooltipShowTimeout = undefined;

        el.__mouseEnter = () => {
            clearTooltipShowTimeout(el);

            if (shouldDelay) {
                el.__tooltipShowTimeout = window.setTimeout(() => {
                    positionTooltip(tooltip, arrow, el, placement);
                    el.__tooltipShowTimeout = undefined;
                }, 500);
                return;
            }

            positionTooltip(tooltip, arrow, el, placement);
        };

        el.__mouseLeave = () => {
            clearTooltipShowTimeout(el);
            if (!always) {
                tooltip.style.display = 'none';
            }
        };

        // Hide tooltip on any click
        el.__click = (_e: MouseEvent) => {
            clearTooltipShowTimeout(el);
            if (!always) {
                tooltip.style.display = 'none';
            }
        };

        el.addEventListener('mouseenter', el.__mouseEnter);
        el.addEventListener('mouseleave', el.__mouseLeave);
        document.addEventListener('click', el.__click);
    },

    updated(el, binding: Bindings) {
        if (el.__tooltip && binding.value) {
            const content = typeof binding.value === 'string' ? binding.value : binding.value.value;
            const customClass = typeof binding.value === 'object' ? binding.value.class : undefined;
            const textClass = typeof binding.value === 'object' ? binding.value.textClass : undefined;
            // const always = typeof binding.value === 'object' ? binding.value.always : !!binding.modifiers?.always;
            const shouldNowrap = !!binding.modifiers?.nowrap;
            const size = binding.modifiers?.xs ? 'xs' : binding.modifiers?.sm ? 'sm' : 'default';
            const useHtml = !!binding.modifiers?.html;

            setTooltipContent(el.__tooltip.text, content || '', useHtml);
            applyTooltipSize(el.__tooltip.text, el.__tooltip.tooltip, size);
            applyTooltipLayout(el.__tooltip.text, el.__tooltip.tooltip, shouldNowrap, useHtml);
            if (textClass) {
                el.__tooltip.text.className = textClass;
            }
            if (customClass) {
                const baseClasses = 'bg-x5 border border-x7 shadow-lg';
                el.__tooltip.tooltip.className = twMerge(baseClasses, customClass);
            }
        }
    },

    unmounted(el) {
        if (el.__tooltip) {
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
        }
    },
};
