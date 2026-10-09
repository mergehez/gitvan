import { describe, expect, it } from 'vitest';
import { fileIconAndLanguageByPath } from '../../lib/utils';

const plaintext = { lang: 'plaintext', icon: 'icon-[mdi--file-outline] opacity-50' };

describe('fileIconAndLanguageByPath', () => {
    it.each([
        ['angular.json', { lang: 'json', icon: 'icon-[mdi--angular] text-red-500' }],
        ['docker-compose.yml', { lang: 'yaml', icon: 'icon-[mdi--docker] text-blue-400' }],
        ['Cargo.toml', { lang: 'toml', icon: 'icon-[mdi--language-rust] text-orange-400' }],
        ['src/go.mod', { lang: 'go', icon: 'icon-[mdi--language-go] text-sky-300' }],
        ['requirements.txt', { lang: 'python', icon: 'icon-[mdi--language-python] text-yellow-300' }],
        ['Dockerfile', { lang: 'dockerfile', icon: 'icon-[mdi--docker] text-blue-400' }],
        ['Makefile', { lang: 'makefile', icon: 'icon-[mdi--hammer-wrench] text-stone-300' }],
        ['src/App.vue', { lang: 'html', icon: 'icon-[mdi--vuejs] text-emerald-400' }],
        ['src/Widget.svelte', { lang: 'html', icon: 'icon-[bxl--svelte] text-orange-400' }],
        ['src/widget.dart', { lang: 'dart', icon: 'icon-[bxl--flutter] text-sky-300' }],
        ['src/main.rs', { lang: 'rust', icon: 'icon-[mdi--language-rust] text-orange-400' }],
        ['src/Main.java', { lang: 'java', icon: 'icon-[mdi--language-java] text-red-300' }],
        ['src/App.kt', { lang: 'kotlin', icon: 'icon-[mdi--language-kotlin] text-violet-300' }],
        ['src/App.swift', { lang: 'swift', icon: 'icon-[mdi--language-swift] text-orange-300' }],
        ['src/tasks.ex', { lang: 'elixir', icon: 'icon-[vscode-icons--file-type-elixir] text-violet-400' }],
        ['src/init.lua', { lang: 'lua', icon: 'icon-[mdi--language-lua] text-blue-300' }],
        ['src/run.ps1', { lang: 'powershell', icon: 'icon-[mdi--powershell] text-blue-400' }],
        ['settings.json', { lang: 'json', icon: 'icon-[picon--json] text-amber-300' }],
        ['config.yaml', { lang: 'yaml', icon: 'icon-[mdi--file-document-outline] text-amber-200' }],
        ['pom.xml', { lang: 'xml', icon: 'icon-[carbon--xml] text-orange-300' }],
        ['src/app.css', { lang: 'css', icon: 'icon-[bxl--css3] text-sky-400' }],
        ['README.md', { lang: 'markdown', icon: 'icon-[fluent--markdown-20-filled] text-blue-300' }],
        ['index.html', { lang: 'html', icon: 'icon-[mdi--language-html5] text-orange-400' }],
        ['Program.cs', { lang: 'csharp', icon: 'icon-[fluent--code-cs-16-filled] text-green-400' }],
        ['src/app.scss', { lang: 'scss', icon: 'icon-[bxl--sass] text-pink-400' }],
        ['query.graphql', { lang: 'graphql', icon: 'icon-[mdi--graphql] text-pink-400' }],
        ['schema.proto', { lang: 'proto', icon: 'icon-[mdi--google-circles-communities] text-sky-300' }],
        ['Cargo.lock', { lang: 'toml', icon: 'icon-[mdi--language-rust] text-orange-400' }],
        ['setup.cfg', { lang: 'ini', icon: 'icon-[mdi--tune-variant] text-slate-300' }],
        ['main.tf', { lang: 'terraform', icon: 'icon-[mdi--terraform] text-violet-400' }],
        ['schema.prisma', { lang: 'prisma', icon: 'icon-[mdi--database-cog-outline] text-cyan-200' }],
        ['deploy.sh', { lang: 'shell', icon: 'icon-[mdi--console] text-lime-300' }],
        ['.gitignore', { lang: 'git', icon: 'icon-[mdi--git] text-orange-400' }],
        ['logo.png', { lang: 'no_code', icon: 'icon-[mdi--file-image] text-pink-400' }],
        ['src/lib/utils.TS', { lang: 'typescript', icon: 'icon-[fluent--code-ts-16-filled] text-sky-400' }],
        ['no-extension', plaintext],
        ['src/', plaintext],
    ])('resolves %s', (path, expected) => {
        expect(fileIconAndLanguageByPath(path)).toEqual(expected);
    });

    it('keeps the first matching table entry for a path that matches several', () => {
        // `tailwind.config.ts` is a literal filename entry that also ends in `.ts`.
        expect(fileIconAndLanguageByPath('tailwind.config.ts').icon).toBe('icon-[mdi--tailwind] text-cyan-300');

        // The specific `spec.ts` entry comes before the generic `ts` entry.
        expect(fileIconAndLanguageByPath('src/utils.spec.ts').icon).toBe('icon-[fluent--code-ts-16-filled] text-amber-400');
        expect(fileIconAndLanguageByPath('src/utils.test.js').icon).toBe('icon-[fluent--code-js-16-filled] text-amber-400');

        // `cargo.lock` is a literal filename entry that wins over the generic `lock` entry.
        expect(fileIconAndLanguageByPath('Cargo.lock').icon).toBe('icon-[mdi--language-rust] text-orange-400');
        expect(fileIconAndLanguageByPath('package-lock.lock').icon).toBe('icon-[picon--json] text-amber-300');
    });

    it('matches the terraform lock file only by its exact name', () => {
        expect(fileIconAndLanguageByPath('.terraform.lock.hcl').icon).toBe('icon-[mdi--terraform] text-violet-400');
        // The table entry is matched as a literal filename, so a prefixed copy falls through.
        expect(fileIconAndLanguageByPath('team.terraform.lock.hcl')).toEqual(plaintext);
    });
});
