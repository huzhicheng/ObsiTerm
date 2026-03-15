import { VaultScanner, VaultItem } from './VaultScanner';

export interface AutocompleteState {
    isActive: boolean;
    searchText: string;
    startPosition: number;
    selectedIndex: number;
    items: VaultItem[];
}

export class AutocompleteManager {
    private scanner: VaultScanner;
    private container: HTMLElement;
    private popup: HTMLElement | null = null;
    private state: AutocompleteState;
    private onSelect: (absolutePath: string, searchText: string) => void;

    constructor(
        scanner: VaultScanner,
        container: HTMLElement,
        onSelect: (absolutePath: string, searchText: string) => void
    ) {
        this.scanner = scanner;
        this.container = container;
        this.onSelect = onSelect;
        this.state = {
            isActive: false,
            searchText: '',
            startPosition: 0,
            selectedIndex: 0,
            items: []
        };
    }

    /**
     * 处理输入字符
     */
    handleInput(char: string, cursorPosition: number): boolean {
        if (char === '@' && !this.state.isActive) {
            this.activate(cursorPosition);
            return true;
        }

        if (this.state.isActive) {
            // 只有回车和换行才关闭自动补全，空格允许继续搜索
            if (char === '\r' || char === '\n') {
                this.deactivate();
                return false;
            }

            if (char === '\x7f' || char === '\b') { // Backspace
                if (this.state.searchText.length > 0) {
                    this.state.searchText = this.state.searchText.slice(0, -1);
                    this.updateSuggestions();
                } else {
                    this.deactivate();
                }
                return true;
            }

            // 添加字符到搜索文本（包括空格）
            this.state.searchText += char;
            this.updateSuggestions();
            return true;
        }

        return false;
    }

    /**
     * 处理特殊按键
     */
    handleSpecialKey(key: string): boolean {
        if (!this.state.isActive) return false;

        switch (key) {
            case 'ArrowUp':
                this.moveSelection(-1);
                return true;
            case 'ArrowDown':
                this.moveSelection(1);
                return true;
            case 'Tab':
            case 'Enter':
                this.selectCurrent();
                return true;
            case 'Escape':
                this.deactivate();
                return true;
        }

        return false;
    }

    /**
     * 激活自动补全
     */
    private activate(position: number): void {
        this.state = {
            isActive: true,
            searchText: '',
            startPosition: position,
            selectedIndex: 0,
            items: this.scanner.filter('')
        };
        this.showPopup();
    }

    /**
     * 关闭自动补全
     */
    deactivate(): void {
        this.state.isActive = false;
        this.hidePopup();
    }

    /**
     * 更新建议列表
     */
    private updateSuggestions(): void {
        this.state.items = this.scanner.filter(this.state.searchText);
        this.state.selectedIndex = 0;
        this.renderPopup();
    }

    /**
     * 移动选择
     */
    private moveSelection(direction: number): void {
        const newIndex = this.state.selectedIndex + direction;
        if (newIndex >= 0 && newIndex < this.state.items.length) {
            this.state.selectedIndex = newIndex;
            this.renderPopup();
            this.scrollToSelected();
        }
    }

    /**
     * 选择当前项
     */
    private selectCurrent(): void {
        if (this.state.items.length > 0) {
            const item = this.state.items[this.state.selectedIndex];
            this.onSelect(item.absolutePath, this.state.searchText);
        }
        this.deactivate();
    }

    /**
     * 显示弹出框
     */
    private showPopup(): void {
        if (this.popup) {
            this.hidePopup();
        }

        this.popup = document.createElement('div');
        this.popup.className = 'xterm-autocomplete-popup';
        // Position at bottom of terminal
        this.popup.style.position = 'absolute';
        this.popup.style.left = '10px';
        this.popup.style.bottom = '10px';
        this.popup.style.zIndex = '1000';
        this.container.appendChild(this.popup);
        this.renderPopup();
    }

    /**
     * 隐藏弹出框
     */
    private hidePopup(): void {
        if (this.popup) {
            this.popup.remove();
            this.popup = null;
        }
    }

    /**
     * 渲染弹出框内容
     */
    private renderPopup(): void {
        if (!this.popup) return;

        if (this.state.items.length === 0) {
            this.popup.innerHTML = `
				<div class="xterm-autocomplete-item" style="opacity: 0.5;">
					没有匹配的文件或文件夹
				</div>
			`;
            return;
        }

        this.popup.innerHTML = this.state.items
            .map((item, index) => {
                const isSelected = index === this.state.selectedIndex;
                const icon = item.isFolder ? '📁' : '📄';
                const type = item.isFolder ? 'folder' : 'file';

                return `
					<div class="xterm-autocomplete-item ${isSelected ? 'is-selected' : ''}" 
						 data-index="${index}">
						<span class="xterm-autocomplete-icon">${icon}</span>
						<span class="xterm-autocomplete-path">${item.path}</span>
						<span class="xterm-autocomplete-type">${type}</span>
					</div>
				`;
            })
            .join('');

        // 添加点击事件
        this.popup.querySelectorAll('.xterm-autocomplete-item').forEach((el, index) => {
            el.addEventListener('click', () => {
                this.state.selectedIndex = index;
                this.selectCurrent();
            });
        });
    }

    /**
     * 滚动到选中项
     */
    private scrollToSelected(): void {
        if (!this.popup) return;

        const selectedEl = this.popup.querySelector('.is-selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    }

    /**
     * 设置弹出框位置
     */
    setPopupPosition(x: number, y: number): void {
        if (this.popup) {
            this.popup.style.left = `${x}px`;
            this.popup.style.bottom = `${this.container.clientHeight - y + 20}px`;
        }
    }

    /**
     * 检查是否激活
     */
    isActive(): boolean {
        return this.state.isActive;
    }

    /**
     * 获取当前搜索文本
     */
    getSearchText(): string {
        return this.state.searchText;
    }
}
