import { App, TFile, TFolder, TAbstractFile } from 'obsidian';

export interface VaultItem {
    name: string;
    path: string;
    absolutePath: string;
    isFolder: boolean;
}

export class VaultScanner {
    private app: App;
    private cachedItems: VaultItem[] = [];
    private lastScanTime: number = 0;
    private readonly CACHE_DURATION = 5000; // 5秒缓存

    constructor(app: App) {
        this.app = app;
    }

    /**
     * 获取vault的绝对路径
     */
    getVaultPath(): string {
        // @ts-ignore - basePath 存在但类型定义中没有
        return this.app.vault.adapter.basePath;
    }

    /**
     * 扫描vault中的所有文件和文件夹
     */
    scan(): VaultItem[] {
        const now = Date.now();
        if (now - this.lastScanTime < this.CACHE_DURATION && this.cachedItems.length > 0) {
            return this.cachedItems;
        }

        const items: VaultItem[] = [];
        const vaultPath = this.getVaultPath();

        // 递归扫描所有文件和文件夹
        this.scanFolder(this.app.vault.getRoot(), items, vaultPath);

        this.cachedItems = items;
        this.lastScanTime = now;

        return items;
    }

    /**
     * 递归扫描文件夹
     */
    private scanFolder(folder: TFolder, items: VaultItem[], vaultPath: string): void {
        for (const child of folder.children) {
            // 跳过隐藏文件和.obsidian目录
            if (child.name.startsWith('.')) {
                continue;
            }

            const isFolder = child instanceof TFolder;
            const absolutePath = this.normalizePath(`${vaultPath}/${child.path}`);

            items.push({
                name: child.name,
                path: child.path,
                absolutePath: absolutePath,
                isFolder: isFolder
            });

            if (isFolder) {
                this.scanFolder(child as TFolder, items, vaultPath);
            }
        }
    }

    /**
     * 规范化路径（处理不同操作系统）
     */
    private normalizePath(path: string): string {
        // 在 Windows 上使用反斜杠
        if (process.platform === 'win32') {
            return path.replace(/\//g, '\\');
        }
        return path;
    }

    /**
     * 根据搜索词过滤项目
     */
    filter(searchTerm: string): VaultItem[] {
        const items = this.scan();
        const term = searchTerm.toLowerCase();

        if (!term) {
            return items.slice(0, 20); // 无搜索词时返回前20个
        }

        // 模糊匹配
        return items
            .filter(item => {
                const nameLower = item.name.toLowerCase();
                const pathLower = item.path.toLowerCase();
                return nameLower.includes(term) || pathLower.includes(term);
            })
            .sort((a, b) => {
                // 优先显示名称匹配的
                const aNameMatch = a.name.toLowerCase().startsWith(term);
                const bNameMatch = b.name.toLowerCase().startsWith(term);
                if (aNameMatch && !bNameMatch) return -1;
                if (!aNameMatch && bNameMatch) return 1;
                // 其次按路径长度排序
                return a.path.length - b.path.length;
            })
            .slice(0, 20); // 最多返回20个结果
    }

    /**
     * 清除缓存
     */
    clearCache(): void {
        this.cachedItems = [];
        this.lastScanTime = 0;
    }
}
