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

    handleInput(char: string, cursorPosition: number): boolean {
        if (this.state.isActive) {
            if (char === '\r' || char === '\n') {
                this.deactivate();
                return false;
            }

            if (char === '\x7f' || char === '\b') {
                if (this.state.searchText.length > 0) {
                    this.state.searchText = this.state.searchText.slice(0, -1);
                    this.updateSuggestions();
                } else {
                    this.deactivate();
                }
                return true;
            }

            this.state.searchText += char;
            this.updateSuggestions();
            return true;
        }

        return false;
    }

    activate(position: number): void {
        this.state = {
            isActive: true,
            searchText: '',
            startPosition: position,
            selectedIndex: 0,
            items: this.scanner.filter('')
        };
        this.showPopup();
    }

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

    deactivate(): void {
        this.state.isActive = false;
        this.hidePopup();
    }

    private updateSuggestions(): void {
        this.state.items = this.scanner.filter(this.state.searchText);
        this.state.selectedIndex = 0;
        this.renderPopup();
    }

    private moveSelection(direction: number): void {
        const newIndex = this.state.selectedIndex + direction;
        if (newIndex >= 0 && newIndex < this.state.items.length) {
            this.state.selectedIndex = newIndex;
            this.renderPopup();
            this.scrollToSelected();
        }
    }

    private selectCurrent(): void {
        if (this.state.items.length > 0) {
            const item = this.state.items[this.state.selectedIndex];
            this.onSelect(item.absolutePath, this.state.searchText);
        }
        this.deactivate();
    }

    private showPopup(): void {
        if (this.popup) {
            this.hidePopup();
        }

        this.popup = document.createElement('div');
        this.popup.className = 'xterm-autocomplete-popup';
        this.popup.style.position = 'absolute';
        this.popup.style.left = '10px';
        this.popup.style.bottom = '10px';
        this.popup.style.zIndex = '1000';
        this.container.appendChild(this.popup);
        this.renderPopup();
    }

    private hidePopup(): void {
        if (this.popup) {
            this.popup.remove();
            this.popup = null;
        }
    }

    private renderPopup(): void {
        if (!this.popup) return;

        if (this.state.items.length === 0) {
            this.popup.innerHTML = `
				<div class="xterm-autocomplete-header">
					<span>Vault paths</span>
					<span>Esc cancel</span>
				</div>
				<div class="xterm-autocomplete-empty">
					No matching files or folders
				</div>
			`;
            return;
        }

        this.popup.innerHTML = `
			<div class="xterm-autocomplete-header">
				<span>Vault paths</span>
				<span>↑↓ move · Enter/Tab apply</span>
			</div>
			${this.state.items
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
                .join('')}
		`;

        this.popup.querySelectorAll('.xterm-autocomplete-item').forEach((el, index) => {
            el.addEventListener('click', () => {
                this.state.selectedIndex = index;
                this.selectCurrent();
            });
        });
    }

    private scrollToSelected(): void {
        if (!this.popup) return;

        const selectedEl = this.popup.querySelector('.is-selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    }

    setPopupPosition(x: number, y: number): void {
        if (this.popup) {
            this.popup.style.left = `${x}px`;
            this.popup.style.bottom = `${this.container.clientHeight - y + 20}px`;
        }
    }

    isActive(): boolean {
        return this.state.isActive;
    }

    getSearchText(): string {
        return this.state.searchText;
    }
}
