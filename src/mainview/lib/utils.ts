import { ChangeStatus } from '../../shared/gitClient';
import { gitClientRpc } from './gitClient';

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp']);

export function isImagePath(path: string) {
    const normalized = path.toLowerCase().split('/').pop() ?? path.toLowerCase();
    const extension = normalized.split('.').pop();
    return extension ? imageExtensions.has(extension) : false;
}

export function fileIconAndLanguageByPath(path: string): { lang: string; icon: string } {
    const lowerPath = path.toLowerCase();
    const file = lowerPath.split('/').pop() ?? lowerPath;

    const map = [
        ['json', ['angular.json'], 'icon-[mdi--angular] text-red-500'],
        ['yaml', ['pubspec.yaml', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'], 'icon-[mdi--docker] text-blue-400'],
        ['toml', ['cargo.toml'], 'icon-[mdi--language-rust] text-orange-400'],
        ['toml', ['cargo.lock'], 'icon-[mdi--language-rust] text-orange-400'],
        ['go', ['go.mod', 'go.sum'], 'icon-[mdi--language-go] text-sky-300'],
        ['python', ['requirements.txt', 'ipynb'], 'icon-[mdi--language-python] text-yellow-300'],
        ['typescript', ['tailwind.config.ts'], 'icon-[mdi--tailwind] text-cyan-300'],
        ['javascript', ['tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs'], 'icon-[mdi--tailwind] text-cyan-300'],
        ['dockerfile', ['dockerfile', 'containerfile'], 'icon-[mdi--docker] text-blue-400'],
        ['makefile', ['makefile'], 'icon-[mdi--hammer-wrench] text-stone-300'],
        ['html', ['vue'], 'icon-[mdi--vuejs] text-emerald-400'],
        ['html', ['svelte'], 'icon-[bxl--svelte] text-orange-400'],
        ['typescript', ['ts'], 'icon-[fluent--code-ts-16-filled] text-sky-400'],
        ['javascript', ['js', 'cjs', 'mjs'], 'icon-[fluent--code-js-16-filled] text-yellow-400'],
        ['javascript', ['jsx', 'tsx'], 'icon-[mdi--react] text-blue-400'],
        ['dart', ['dart'], 'icon-[bxl--flutter] text-sky-300'],
        ['php', ['php', 'phtml', 'php3', 'php4', 'php5', 'phar', 'phpt', 'blade.php'], 'icon-[mdi--language-php] text-indigo-300'],
        ['rust', ['rs'], 'icon-[mdi--language-rust] text-orange-400'],
        ['go', ['go'], 'icon-[mdi--language-go] text-sky-300'],
        ['python', ['py', 'pyi', 'pyw'], 'icon-[mdi--language-python] text-yellow-300'],
        ['java', ['java', 'gradle'], 'icon-[mdi--language-java] text-red-300'],
        ['kotlin', ['kt', 'kts'], 'icon-[mdi--language-kotlin] text-violet-300'],
        ['swift', ['swift'], 'icon-[mdi--language-swift] text-orange-300'],
        ['ruby', ['rb', 'gemspec'], 'icon-[mdi--language-ruby] text-red-400'],
        ['elixir', ['ex', 'exs', 'heex'], 'icon-[vscode-icons--file-type-elixir] text-violet-400'],
        ['lua', ['lua'], 'icon-[mdi--language-lua] text-blue-300'],
        ['perl', ['pl', 'pm'], 'icon-[vscode-icons--file-type-perl] text-cyan-300'],
        ['powershell', ['ps1', 'psm1', 'psd1'], 'icon-[mdi--powershell] text-blue-400'],
        ['json', ['json', 'lock'], 'icon-[picon--json] text-amber-300'],
        ['yaml', ['yml', 'yaml'], 'icon-[mdi--file-document-outline] text-amber-200'],
        ['xml', ['xml', 'xsd', 'xsl', 'csproj'], 'icon-[carbon--xml] text-orange-300'],
        ['css', ['css'], 'icon-[bxl--css3] text-sky-400'],
        ['markdown', ['md'], 'icon-[fluent--markdown-20-filled] text-blue-300'],
        ['html', ['html', 'htm'], 'icon-[mdi--language-html5] text-orange-400'],
        ['csharp', ['cs', 'sln', 'props', 'targets'], 'icon-[fluent--code-cs-16-filled] text-green-400'],
        ['scss', ['scss', 'sass'], 'icon-[bxl--sass] text-pink-400'],
        ['less', ['less'], 'icon-[bxl--less] text-blue-400'],
        ['sql', ['sql'], 'icon-[mdi--database] text-cyan-300'],
        ['graphql', ['graphql', 'gql'], 'icon-[mdi--graphql] text-pink-400'],
        ['proto', ['proto'], 'icon-[mdi--google-circles-communities] text-sky-300'],
        ['toml', ['toml'], 'icon-[mdi--file-cog-outline] text-amber-300'],
        ['ini', ['ini', 'cfg', 'conf'], 'icon-[mdi--tune-variant] text-slate-300'],
        ['terraform', ['tf', 'tfvars', '.terraform.lock.hcl'], 'icon-[mdi--terraform] text-violet-400'],
        ['prisma', ['prisma'], 'icon-[mdi--database-cog-outline] text-cyan-200'],
        ['shell', ['sh', 'bash', 'zsh', 'fish'], 'icon-[mdi--console] text-lime-300'],
        ['git', ['gitignore', 'gitattributes', 'gitmodules', 'gitkeep'], 'icon-[mdi--git] text-orange-400'],
        ['no_code', ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'], 'icon-[mdi--file-image] text-pink-400'],
    ] as const;

    const found = map.find(([_, extensions]) => extensions.some((ext) => file === ext || lowerPath.endsWith(`.${ext}`)));
    if (found) {
        return {
            lang: found[0],
            icon: found[2],
        };
    }

    return {
        lang: 'plaintext',
        icon: 'icon-[mdi--file-outline] opacity-50',
    };
}

export function statusLetter(entry: { status?: ChangeStatus }) {
    const status: ChangeStatus = entry.status ?? 'clean';

    const map = {
        modified: 'M',
        added: 'A',
        deleted: 'D',
        renamed: 'R',
        copied: 'C',
        untracked: 'U',
        unmerged: '!',
        'type-changed': 'T',
        clean: '•',
    };

    return map[status];
}

export function statusClass(entry: { status?: ChangeStatus }) {
    const status: ChangeStatus = entry.status ?? 'clean';

    if (status === 'deleted' || status === 'unmerged') {
        return 'text-red-400';
    }

    if (status === 'added' || status === 'copied') {
        return 'text-emerald-400';
    }

    if (status === 'modified' || status === 'renamed' || status === 'type-changed') {
        return 'text-amber-400';
    }

    return 'opacity-70';
}

export function fileName(path: string) {
    const segments = path.split('/');
    return segments[segments.length - 1] ?? path;
}

export function parentPath(path: string) {
    const segments = path.split('/');
    if (segments.length <= 1) {
        return '';
    }

    return segments.slice(0, -1).join('/');
}

export function readableDate(date: Date) {
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) {
        return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    }

    // today at 00:00
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (date >= today) {
        return `Today at ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    // yesterday at 00:00
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date >= yesterday) {
        return `Yesterday at ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    return date.toLocaleDateString();
}

export function uniqueId(len = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < len; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

export function counted(count: number | { length: number }, singular: string, plural?: string) {
    const actualCount = typeof count === 'number' ? count : count.length;
    if (!singular && !plural) {
        singular = '';
        plural = 's';
    } else if (!plural) {
        if (singular.endsWith('s')) {
            plural = singular;
            singular = singular.slice(0, -1);
        } else if (singular.endsWith('y')) {
            plural = `${singular.slice(0, -1)}ies`;
        } else {
            plural = `${singular}s`;
        }
    }
    return `${actualCount} ${actualCount < 2 ? singular : plural}`;
}

export function formatBytes(bytes: number) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export async function confirmAction(params: { title: string; message: string; detail?: string; confirmLabel?: string; cancelLabel?: string }) {
    return await gitClientRpc.request.confirmAction(params);
}
