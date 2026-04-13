import type { ElectrobunConfig } from 'electrobun';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
    description?: string;
};

function envFlag(name: string, fallback = false) {
    const value = process.env[name];

    if (value == null || value === '') {
        return fallback;
    }

    return /^(1|true|yes|on)$/i.test(value);
}

export default {
    app: {
        name: 'Gitvan',
        identifier: 'com.mergesoft.gitvan',
        version: packageJson.version,
        description: packageJson.description,
    },
    runtime: {
        exitOnLastWindowClosed: true,
    },
    build: {
        bun: {
            entrypoint: 'src/electrobun/index.ts',
            sourcemap: 'linked',
        },
        copy: {
            dist: 'views/mainview',
        },
        watch: ['dist'],
        watchIgnore: ['release/**'],
        mac: {
            codesign: envFlag('ELECTROBUN_CODESIGN'),
            createDmg: envFlag('ELECTROBUN_CREATE_DMG'),
            notarize: envFlag('ELECTROBUN_NOTARIZE'),
            icons: process.env.ELECTROBUN_MAC_ICONS || 'assets/icon.iconset',
        },
    },
    scripts: {
        postBuild: './scripts/fix-macos-app-icon.ts',
        postWrap: './scripts/fix-macos-app-icon.ts',
    },
} satisfies ElectrobunConfig;
