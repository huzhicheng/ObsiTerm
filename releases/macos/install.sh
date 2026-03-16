#!/bin/bash

if [ -z "${BASH_VERSION:-}" ]; then
    if command -v bash >/dev/null 2>&1; then
        exec bash "$0" "$@"
    fi
    echo "This installer requires bash." >&2
    exit 1
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR_NAME="obsidian-term"
PLUGIN_BUNDLE_DIR="${SCRIPT_DIR}/${PLUGIN_DIR_NAME}"

current_user_home() {
    local console_user=""
    local user_home=""

    console_user="$(stat -f '%Su' /dev/console 2>/dev/null || true)"
    if [ -n "$console_user" ] && [ "$console_user" != "root" ]; then
        user_home="$(dscl . -read "/Users/${console_user}" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
        if [ -n "$user_home" ] && [ -d "$user_home" ]; then
            printf '%s\n' "$user_home"
            return 0
        fi
    fi

    printf '%s\n' "$HOME"
}

USER_HOME="$(current_user_home)"
OBSIDIAN_CONFIG_FILE="${USER_HOME}/Library/Application Support/obsidian/obsidian.json"

read_plugin_id() {
    local manifest_path="${PLUGIN_BUNDLE_DIR}/manifest.json"

    if [ ! -f "$manifest_path" ]; then
        return 0
    fi

    sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest_path" | head -n 1
}

PLUGIN_ID="$(read_plugin_id)"

discover_vaults_from_obsidian_config() {
    if [ ! -r "$OBSIDIAN_CONFIG_FILE" ]; then
        return 0
    fi

    if ! command -v plutil >/dev/null 2>&1; then
        return 0
    fi

    plutil -p "$OBSIDIAN_CONFIG_FILE" 2>/dev/null \
        | sed -n 's/^[[:space:]]*"path" => "\(.*\)"$/\1/p'
}

discover_vaults() {
    discover_vaults_from_obsidian_config | awk '!seen[$0]++' | while IFS= read -r vault_path; do
        [ -d "$vault_path" ] || continue
        [ "$(basename "$vault_path")" = "Obsidian Sandbox" ] && continue
        printf '%s\n' "$vault_path"
    done
}

prompt_manual_vault_path() {
    local tty_in="/dev/tty"
    local tty_out="/dev/tty"
    local manual_path=""

    if [ ! -r "$tty_in" ] || [ ! -w "$tty_out" ]; then
        return 0
    fi

    echo "No Obsidian vaults were found automatically." > "$tty_out"
    echo "Obsidian config: $OBSIDIAN_CONFIG_FILE" > "$tty_out"
    echo "Enter a vault path manually, or press Enter to cancel:" > "$tty_out"
    printf '> ' > "$tty_out"
    IFS= read -r manual_path < "$tty_in" || true

    if [ -n "$manual_path" ]; then
        printf '%s\n' "$manual_path"
    fi
}

choose_vaults() {
    local map_file="$1"
    local -a labels=()
    local -a paths=()
    local -a selected=()
    local tty_in="/dev/tty"
    local tty_out="/dev/tty"
    local stty_state=""
    local key=""
    local key_rest=""
    local index=""
    local total=0
    local current=0
    local selected_count=0
    local marker=""

    while IFS=$'\t' read -r label vault_path; do
        [ -n "$label" ] || continue
        labels+=("$label")
        paths+=("$vault_path")
    done < "$map_file"

    total="${#paths[@]}"
    if [ "$total" -eq 0 ]; then
        return 0
    fi

    if [ ! -r "$tty_in" ] || [ ! -w "$tty_out" ]; then
        echo "Interactive terminal not available." >&2
        return 1
    fi

    stty_state="$(stty -g < "$tty_in")"
    for ((index = 0; index < total; index++)); do
        selected+=("0")
    done

    cleanup_terminal() {
        [ -n "$stty_state" ] && stty "$stty_state" < "$tty_in" 2>/dev/null || true
        tput cnorm > "$tty_out" 2>/dev/null || true
        printf '\033[0m' > "$tty_out"
    }

    trap 'cleanup_terminal' RETURN
    tput civis > "$tty_out" 2>/dev/null || true

    while true; do
        selected_count=0
        for ((index = 0; index < total; index++)); do
            if [ "${selected[$index]}" = "1" ]; then
                selected_count=$((selected_count + 1))
            fi
        done

        printf '\033[2J\033[H' > "$tty_out"
        echo "Select Obsidian vaults to install ${PLUGIN_DIR_NAME}" > "$tty_out"
        echo "Use ↑/↓ to move, Space to toggle, Enter to confirm, a to toggle all, q to quit" > "$tty_out"
        echo > "$tty_out"

        for ((index = 0; index < total; index++)); do
            if [ "${selected[$index]}" = "1" ]; then
                marker="[x]"
            else
                marker="[ ]"
            fi

            if [ "$index" -eq "$current" ]; then
                printf '> %s %s\n' "$marker" "${labels[$index]}" > "$tty_out"
            else
                printf '  %s %s\n' "$marker" "${labels[$index]}" > "$tty_out"
            fi
        done

        echo > "$tty_out"
        printf 'Selected: %d/%d\n' "$selected_count" "$total" > "$tty_out"

        IFS= read -rsn1 key < "$tty_in"
        if [ "$key" = $'\x1b' ]; then
            key_rest=""
            IFS= read -rsn2 key_rest < "$tty_in" || true
            case "$key_rest" in
                '[A'|'OA')
                    if [ "$current" -gt 0 ]; then
                        current=$((current - 1))
                    fi
                    ;;
                '[B'|'OB')
                    if [ "$current" -lt $((total - 1)) ]; then
                        current=$((current + 1))
                    fi
                    ;;
            esac
            continue
        fi

        case "$key" in
            ' ')
                if [ "${selected[$current]}" = "1" ]; then
                    selected[$current]="0"
                else
                    selected[$current]="1"
                fi
                ;;
            '')
                for ((index = 0; index < total; index++)); do
                    if [ "${selected[$index]}" = "1" ]; then
                        printf '%s\n' "${paths[$index]}"
                    fi
                done
                return 0
                ;;
            'k'|'K')
                if [ "$current" -gt 0 ]; then
                    current=$((current - 1))
                fi
                ;;
            'j'|'J')
                if [ "$current" -lt $((total - 1)) ]; then
                    current=$((current + 1))
                fi
                ;;
            'a'|'A')
                if [ "$selected_count" -eq "$total" ]; then
                    for ((index = 0; index < total; index++)); do
                        selected[$index]="0"
                    done
                else
                    for ((index = 0; index < total; index++)); do
                        selected[$index]="1"
                    done
                fi
                ;;
            'q'|'Q')
                return 0
                ;;
        esac
    done
}

copy_plugin_into_vault() {
    local vault_path="$1"
    local plugins_dir="${vault_path}/.obsidian/plugins"
    local target_dir="${plugins_dir}/${PLUGIN_ID}"

    if [ -d "${plugins_dir}/obsidian-term" ]; then
        target_dir="${plugins_dir}/obsidian-term"
    fi

    mkdir -p "$target_dir"
    rm -rf "$target_dir/resources" "$target_dir/themes"
    mkdir -p "$target_dir/resources" "$target_dir/themes"

    cp "$PLUGIN_BUNDLE_DIR/main.js" "$target_dir/"
    cp "$PLUGIN_BUNDLE_DIR/manifest.json" "$target_dir/"
    cp "$PLUGIN_BUNDLE_DIR/styles.css" "$target_dir/"
    cp "$PLUGIN_BUNDLE_DIR/resources/pty-helper" "$target_dir/resources/"
    cp -R "$PLUGIN_BUNDLE_DIR/themes/." "$target_dir/themes/"

    echo "✅ Installed to: $target_dir"
}

main() {
    local vault_paths=()

    if [ ! -f "$PLUGIN_BUNDLE_DIR/manifest.json" ]; then
        echo "Plugin bundle not found: $PLUGIN_BUNDLE_DIR"
        exit 1
    fi

    if [ -z "$PLUGIN_ID" ]; then
        echo "Failed to read plugin id from manifest.json"
        exit 1
    fi

    if [ "$#" -gt 0 ]; then
        vault_paths=("$@")
    else
        local map_file
        map_file="$(mktemp)"

        while IFS= read -r vault_path; do
            [ -n "$vault_path" ] || continue
            printf '%s [%s]\t%s\n' "$(basename "$vault_path")" "$vault_path" "$vault_path" >> "$map_file"
        done < <(discover_vaults)

        if [ ! -s "$map_file" ]; then
            rm -f "$map_file"

            while IFS= read -r manual_vault; do
                [ -n "$manual_vault" ] || continue
                vault_paths+=("$manual_vault")
            done < <(prompt_manual_vault_path)

            if [ "${#vault_paths[@]}" -eq 0 ]; then
                echo "No Obsidian vaults found."
                exit 1
            fi
        else
            while IFS= read -r selected_vault; do
                [ -n "$selected_vault" ] || continue
                vault_paths+=("$selected_vault")
            done < <(choose_vaults "$map_file")

            rm -f "$map_file"

            if [ "${#vault_paths[@]}" -eq 0 ]; then
                echo "No vaults selected."
                exit 0
            fi
        fi
    fi

    for vault_path in "${vault_paths[@]}"; do
        if [ ! -d "$vault_path/.obsidian" ]; then
            echo "⚠️  Skipping non-vault path: $vault_path"
            continue
        fi

        copy_plugin_into_vault "$vault_path"
    done
}

main "$@"
