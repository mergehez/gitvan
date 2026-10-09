import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { vLoading } from '../../directives/VLoading';
import { useOverlaysState } from '../../directives/useOverlaysState';

const loaderHost = defineComponent({
    props: { loading: { type: Boolean, default: false }, tick: { type: Number, default: 0 } },
    template: '<div class="host" v-loading="loading">{{ tick }}</div>',
});

function mountLoader(loading = false, tick = 0) {
    return mount(loaderHost, {
        props: { loading, tick },
        global: { directives: { loading: vLoading } },
    });
}

describe('v-loading', () => {
    it('shows and hides the loader with the bound value', async () => {
        const wrapper = mountLoader(false);
        const host = wrapper.get('.host');
        const loader = host.get('.v-loading');

        expect(loader.attributes('style')).toContain('display: none');
        expect(host.attributes('style')).toContain('pointer-events: auto');

        await wrapper.setProps({ loading: true });

        expect(loader.attributes('style')).toContain('display: flex');
        expect(host.attributes('style')).toContain('pointer-events: none');

        await wrapper.setProps({ loading: false });

        expect(loader.attributes('style')).toContain('display: none');
        expect(host.attributes('style')).toContain('pointer-events: auto');
    });

    it('returns the shared z-index stack to its previous value once the loader is hidden', async () => {
        const overlays = useOverlaysState();
        const baseline = overlays.claimZIndex();
        overlays.releaseZIndex(baseline);

        const wrapper = mountLoader(true);

        // Any re-render of the host re-runs the directive while the loader is visible.
        await wrapper.setProps({ tick: 1 });
        await wrapper.setProps({ tick: 2 });
        await wrapper.setProps({ loading: false });

        const afterHiding = overlays.claimZIndex();
        overlays.releaseZIndex(afterHiding);

        expect(afterHiding).toBe(baseline);

        wrapper.unmount();
    });
});
