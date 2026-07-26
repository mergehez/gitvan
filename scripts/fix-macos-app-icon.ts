import { existsSync } from 'fs';
import { copyFile, mkdir } from 'fs/promises';
import { join } from 'path';

const buildDir = process.env.ELECTRON_BUILD_DIR;
const wrapperBundlePath = process.env.ELECTRON_WRAPPER_BUNDLE_PATH;
const sourceIconPath = join(process.cwd(), 'assets', 'icon.icns');

async function ensureAppIcon(appBundlePath: string) {
    const resourcesPath = join(appBundlePath, 'Contents', 'Resources');
    const targetIconPath = join(resourcesPath, 'AppIcon.icns');

    await mkdir(resourcesPath, { recursive: true });
    await copyFile(sourceIconPath, targetIconPath);
    console.log(`Copied macOS app icon to ${targetIconPath}`);
}

async function main() {
    // if dev return
    if (process.env.ELECTRON_IS_DEV === 'true') {
        console.log('Development mode detected, skipping app icon fix.');
        return;
    }

    if (process.platform !== 'darwin') {
        return;
    }

    if (!existsSync(sourceIconPath)) {
        throw new Error(`Missing source icon at ${sourceIconPath}`);
    }

    if (wrapperBundlePath) {
        await ensureAppIcon(wrapperBundlePath);
        return;
    }

    if (!buildDir) {
        throw new Error('ELECTRON_BUILD_DIR is not set.');
    }

    const appBundlePath = join(buildDir, 'Gitvan.app');

    if (!existsSync(appBundlePath)) {
        throw new Error(`Expected app bundle at ${appBundlePath}`);
    }

    await ensureAppIcon(appBundlePath);
}

await main();
