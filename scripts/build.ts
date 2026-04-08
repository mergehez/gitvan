/// <reference types="node" />

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function readEnvFile(filePath: string): Record<string, string> {
    if (!fs.existsSync(filePath)) {
        return {};
    }

    const values: Record<string, string> = {};
    for (const rawLine of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        let value = line.slice(separatorIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return values;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);
const env = readEnvFile(join(projectRoot, '.env'));
const assetsDir = join(projectRoot, 'assets');
const releaseDir = join(projectRoot, 'release', 'mac');
const tempConfigPath = join(projectRoot, 'release', 'tmp', 'electron-builder.config.json');
const iconSvgPath = join(assetsDir, 'icon.svg');
const iconIcnsPath = join(assetsDir, 'icon.icns');

const DEFAULT_IDENTITY = process.env.APPLE_SIGNING_ID || env.APPLE_SIGNING_ID || '';
const DEFAULT_APPLE_ID = process.env.APPLE_ID || env.APPLE_ID || '';
const DEFAULT_APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || env.APPLE_TEAM_ID || '';
const DEFAULT_APPLE_APP_SPECIFIC_PASSWORD = process.env.APPLE_APP_SPECIFIC_PASSWORD || env.APPLE_APP_SPECIFIC_PASSWORD || '';
const localBinDir = join(projectRoot, 'node_modules', '.bin');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function normalizeSigningIdentity(identity: string) {
    return identity.replace(/^(Developer ID Application|Apple Development):\s*/, '').trim();
}

async function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv) {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            cwd: projectRoot,
            env,
        });

        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }

            if (signal) {
                reject(new Error(`${command} ${args.join(' ')} terminated by signal ${signal}.`));
                return;
            }

            reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`));
        });
    });
}

async function runLocalBinary(binaryName: string, args: string[], env: NodeJS.ProcessEnv) {
    const extension = process.platform === 'win32' ? '.cmd' : '';
    await runCommand(join(localBinDir, `${binaryName}${extension}`), args, env);
}

async function fileExists(path: string) {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function findReleaseArtifact(extension: string) {
    const entries = await readdir(releaseDir, { withFileTypes: true });
    const matches = entries.filter((entry) => entry.isFile() && entry.name.endsWith(extension)).map((entry) => join(releaseDir, entry.name));

    if (matches.length !== 1) {
        throw new Error(`Expected exactly one ${extension} artifact in ${releaseDir}, found ${matches.length}.`);
    }

    return matches[0];
}

async function findAppBundle(directoryPath: string) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const appEntry = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'));

    if (!appEntry) {
        throw new Error(`No .app bundle found in ${directoryPath}.`);
    }

    return join(directoryPath, appEntry.name);
}

async function verifySignedMacApp(appPath: string, env: NodeJS.ProcessEnv) {
    console.log(`Verifying code signature for ${appPath}.`);
    await runCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], env);

    console.log(`Running Gatekeeper assessment for ${appPath}.`);
    await runCommand('/usr/sbin/spctl', ['-a', '-t', 'exec', '-v', appPath], env);
}

async function stapleArtifact(path: string, env: NodeJS.ProcessEnv) {
    console.log(`Stapling notarization ticket to ${path}.`);
    await runCommand('/usr/bin/xcrun', ['stapler', 'staple', path], env);
}

async function verifyDmgDistributionArtifact(dmgPath: string, env: NodeJS.ProcessEnv) {
    const mountDir = await mkdtemp(join(tmpdir(), 'gitvan-dmg-check-'));

    try {
        console.log(`Mounting ${dmgPath} for distribution verification.`);
        await runCommand('/usr/bin/hdiutil', ['attach', dmgPath, '-readonly', '-nobrowse', '-mountpoint', mountDir], env);

        const mountedAppPath = await findAppBundle(mountDir);
        await verifySignedMacApp(mountedAppPath, env);

        console.log('DMG verification passed.');
        console.log(`DMG: ${dmgPath}`);
        console.log(`Mounted app: ${mountedAppPath}`);
        console.log('Summary: mounted app signature valid and Gatekeeper accepted the app from the DMG.');
    } finally {
        try {
            await runCommand('/usr/bin/hdiutil', ['detach', mountDir], env);
        } catch (error) {
            console.warn(`Failed to detach ${mountDir}: ${error instanceof Error ? error.message : String(error)}`);
        }

        await rm(mountDir, { recursive: true, force: true });
    }
}

async function ensureMacIcon() {
    if (!(await fileExists(iconSvgPath))) {
        throw new Error(`Missing icon source at ${iconSvgPath}.`);
    }

    const iconSvgStat = await stat(iconSvgPath);
    const iconIcnsExists = await fileExists(iconIcnsPath);

    if (iconIcnsExists) {
        const iconIcnsStat = await stat(iconIcnsPath);

        if (iconIcnsStat.mtimeMs >= iconSvgStat.mtimeMs) {
            return iconIcnsPath;
        }
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'gitvan-icon-'));
    const iconsetDir = join(tempDir, 'icon.iconset');
    const previewPath = join(tempDir, 'icon.png');

    try {
        await mkdir(iconsetDir, { recursive: true });
        await runCommand('/usr/bin/qlmanage', ['-t', '-s', '1024', '-o', tempDir, iconSvgPath], process.env);
        await runCommand('mv', [join(tempDir, 'icon.svg.png'), previewPath], process.env);

        const sizes: Array<[string, number, number]> = [
            ['icon_16x16.png', 16, 16],
            ['icon_16x16@2x.png', 32, 32],
            ['icon_32x32.png', 32, 32],
            ['icon_32x32@2x.png', 64, 64],
            ['icon_128x128.png', 128, 128],
            ['icon_128x128@2x.png', 256, 256],
            ['icon_256x256.png', 256, 256],
            ['icon_256x256@2x.png', 512, 512],
            ['icon_512x512.png', 512, 512],
        ];

        for (const [fileName, width, height] of sizes) {
            await runCommand('/usr/bin/sips', ['-z', String(height), String(width), previewPath, '--out', join(iconsetDir, fileName)], process.env);
        }

        const retinaSource = await readFile(previewPath);
        await writeFile(join(iconsetDir, 'icon_512x512@2x.png'), retinaSource);
        await runCommand('/usr/bin/iconutil', ['-c', 'icns', iconsetDir, '-o', iconIcnsPath], process.env);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }

    return iconIcnsPath;
}

async function writeBuilderConfig() {
    const iconPath = await ensureMacIcon();
    const config = {
        appId: 'dev.mergesoft.gitvan',
        asar: true,
        files: ['dist/**', 'dist-electron/**', 'package.json'],
        directories: {
            buildResources: 'assets',
            output: 'release/mac',
        },
        artifactName: '${productName}-${version}-${arch}.${ext}',
        copyright: 'Copyright © 2026 MergeSoft',
        mac: {
            category: 'public.app-category.developer-tools',
            hardenedRuntime: true,
            icon: iconPath,
            target: ['dmg', 'zip'],
            artifactName: '${productName}-${version}-mac-${arch}.${ext}',
        },
    };

    await mkdir(dirname(tempConfigPath), { recursive: true });
    await writeFile(tempConfigPath, `${JSON.stringify(config, null, 4)}\n`);

    return tempConfigPath;
}

async function main() {
    const shouldNotarize = process.argv.includes('--notarize');
    const shouldSign = process.argv.includes('--signed') || shouldNotarize;
    const env: NodeJS.ProcessEnv = {
        ...Object.fromEntries(Object.entries(readEnvFile(join(projectRoot, '.env'))).filter(([_, value]) => value !== '')),
        ...process.env,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    };

    if (shouldSign) {
        if (!DEFAULT_IDENTITY) {
            throw new Error('Signing identity is required to build signed artifacts. Please set the APPLE_SIGNING_ID environment variable or provide it in a .env file.');
        }
        env.CSC_NAME = normalizeSigningIdentity(DEFAULT_IDENTITY);
        console.log(`Using signing identity: ${env.CSC_NAME}`);
        if (shouldNotarize) {
            env.APPLE_ID = env.APPLE_ID || DEFAULT_APPLE_ID;
            env.APPLE_TEAM_ID = env.APPLE_TEAM_ID || DEFAULT_APPLE_TEAM_ID;
            env.APPLE_APP_SPECIFIC_PASSWORD = env.APPLE_APP_SPECIFIC_PASSWORD || DEFAULT_APPLE_APP_SPECIFIC_PASSWORD;

            if (!env.APPLE_ID || !env.APPLE_TEAM_ID || !env.APPLE_APP_SPECIFIC_PASSWORD) {
                throw new Error('Notarization requires APPLE_ID, APPLE_TEAM_ID, and APPLE_APP_SPECIFIC_PASSWORD. Set them in the environment or provide them in a .env file.');
            }

            console.log('Notarization is enabled for this build.');
        }
    } else {
        delete env.CSC_NAME;
        env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
        console.log('Building unsigned macOS artifacts.');
    }

    const configPath = await writeBuilderConfig();

    await runCommand(npmCommand, ['run', 'b'], env);
    const tmpReleaseDir = `${releaseDir}-tmp`;
    if (await fileExists(releaseDir)) {
        await rm(tmpReleaseDir, { recursive: true, force: true });
        await runCommand('mv', [releaseDir, tmpReleaseDir], env);
    }

    try {
        await runLocalBinary('electron-builder', ['--config', configPath, '--mac', 'dmg', '--publish', 'never'], env);

        const dmgPath = await findReleaseArtifact('.dmg');
        const appName = 'Gitvan.app';
        const builtAppPath = join(releaseDir, 'mac-arm64', appName);

        if (shouldNotarize) {
            // electron-builder notarizes the signed app during packaging when the
            // Apple credentials are available in the environment. Staple the app
            // bundle, then verify both the local bundle and the copy inside the DMG.
            await stapleArtifact(builtAppPath, env);
            await verifySignedMacApp(builtAppPath, env);
            await verifyDmgDistributionArtifact(dmgPath, env);
        }

        const applicationsPath = join('/Applications', appName);

        if (await fileExists(applicationsPath)) {
            console.log(`Removing existing application at ${applicationsPath}.`);
            await rm(applicationsPath, { recursive: true, force: true });
        }

        await runCommand('cp', ['-R', builtAppPath, applicationsPath], env);
        console.log(`Moved ${appName} to /Applications.`);
    } finally {
        if (await fileExists(tmpReleaseDir)) {
            await rm(tmpReleaseDir, { recursive: true, force: true });
        }

        // delete tmp folder
        const tmpDir = dirname(tempConfigPath);
        if (await fileExists(tmpDir)) {
            await rm(tmpDir, { recursive: true, force: true });
        }
    }

    console.log(`macOS release artifacts are available in ${releaseDir}.`);
}

await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
});
