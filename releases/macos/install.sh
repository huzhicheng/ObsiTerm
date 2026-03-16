#!/bin/bash

if [ -z "${BASH_VERSION:-}" ]; then
    if command -v bash >/dev/null 2>&1; then
        exec bash "$0" "$@"
    fi
    echo "This installer requires bash." >&2
    exit 1
fi

set -euo pipefail

log_info() {
    printf '[install] %s\n' "$*" >&2
}

log_warn() {
    printf '[install][warn] %s\n' "$*" >&2
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR_NAME="obsidian-term"
PLUGIN_BUNDLE_DIR="${SCRIPT_DIR}/${PLUGIN_DIR_NAME}"

current_user_home() {
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
    local parser_output=""

    log_info "Current user home: ${USER_HOME}"
    log_info "Obsidian config path: ${OBSIDIAN_CONFIG_FILE}"

    if [ ! -r "$OBSIDIAN_CONFIG_FILE" ]; then
        log_warn "Obsidian config is not readable"
        return 0
    fi

    if command -v perl >/dev/null 2>&1; then
        parser_output="$(
            perl -MJSON::PP -e '
                my $file = shift;
                open my $fh, "<", $file or exit 0;
                local $/;
                my $json = <$fh>;
                my $data = eval { JSON::PP->new->decode($json) } or exit 0;
                my $vaults = $data->{vaults};
                exit 0 if ref($vaults) ne "HASH";
                for my $vault (values %{$vaults}) {
                    next if ref($vault) ne "HASH";
                    my $path = $vault->{path};
                    print "$path\n" if defined $path && length $path;
                }
            ' "$OBSIDIAN_CONFIG_FILE" 2>/dev/null || true
        )"

        if [ -n "$parser_output" ]; then
            log_info "Using perl JSON parser for obsidian.json"
            while IFS= read -r vault_path; do
                [ -n "$vault_path" ] || continue
                log_info "Vault path from config: ${vault_path}"
                printf '%s\n' "$vault_path"
            done <<< "$parser_output"
            return 0
        fi

        log_warn "Perl JSON parser produced no vault paths"
    else
        log_warn "perl is not available"
    fi

    if ! command -v plutil >/dev/null 2>&1; then
        log_warn "plutil is not available"
        return 0
    fi

    parser_output="$(
        plutil -p "$OBSIDIAN_CONFIG_FILE" 2>/dev/null \
            | sed -n 's/^[[:space:]]*"path" => "\(.*\)"$/\1/p' \
            || true
    )"

    if [ -z "$parser_output" ]; then
        log_warn "plutil parser produced no vault paths"
        return 0
    fi

    log_info "Using plutil parser for obsidian.json"
    while IFS= read -r vault_path; do
        [ -n "$vault_path" ] || continue
        log_info "Vault path from config: ${vault_path}"
        printf '%s\n' "$vault_path"
    done <<< "$parser_output"
}

discover_vaults() {
    discover_vaults_from_obsidian_config | awk '!seen[$0]++' | while IFS= read -r vault_path; do
        [ -n "$vault_path" ] || continue

        if [ ! -d "$vault_path" ]; then
            log_warn "Ignoring missing vault path: ${vault_path}"
            continue
        fi

        if [ "$(basename "$vault_path")" = "Obsidian Sandbox" ]; then
            log_info "Ignoring Obsidian Sandbox: ${vault_path}"
            continue
        fi

        log_info "Auto-detected vault: ${vault_path}"
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
        log_info "Manual vault path entered: ${manual_path}"
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
    log_info "Interactive picker received ${total} vault candidate(s)"

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
                        log_info "Selected vault: ${paths[$index]}"
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

    log_info "Preparing install for vault: ${vault_path}"

    if [ -d "${plugins_dir}/obsidian-term" ]; then
        target_dir="${plugins_dir}/obsidian-term"
        log_info "Existing obsidian-term directory found, reusing: ${target_dir}"
    fi

    mkdir -p "$target_dir"
    rm -rf "$target_dir/resources" "$target_dir/themes"
    mkdir -p "$target_dir/resources" "$target_dir/themes"

    cp "$PLUGIN_BUNDLE_DIR/main.js" "$target_dir/"
    cp "$PLUGIN_BUNDLE_DIR/manifest.json" "$target_dir/"
    cp "$PLUGIN_BUNDLE_DIR/styles.css" "$target_dir/"
    cp "$PLUGIN_BUNDLE_DIR/resources/pty-helper" "$target_dir/resources/"
    cp -R "$PLUGIN_BUNDLE_DIR/themes/." "$target_dir/themes/"

    log_info "Copied plugin bundle to: ${target_dir}"
    echo "✅ Installed to: $target_dir"
}

main() {
    local vault_paths=()

    log_info "Installer script directory: ${SCRIPT_DIR}"
    log_info "Plugin bundle directory: ${PLUGIN_BUNDLE_DIR}"

    if [ ! -f "$PLUGIN_BUNDLE_DIR/manifest.json" ]; then
        echo "Plugin bundle not found: $PLUGIN_BUNDLE_DIR"
        exit 1
    fi

    if [ -z "$PLUGIN_ID" ]; then
        echo "Failed to read plugin id from manifest.json"
        exit 1
    fi

    log_info "Plugin id: ${PLUGIN_ID}"

    if [ "$#" -gt 0 ]; then
        log_info "Using user-provided vault path(s): $*"
        vault_paths=("$@")
    else
        local map_file
        map_file="$(mktemp)"

        while IFS= read -r vault_path; do
            [ -n "$vault_path" ] || continue
            printf '%s [%s]\t%s\n' "$(basename "$vault_path")" "$vault_path" "$vault_path" >> "$map_file"
        done < <(discover_vaults)

        log_info "Auto-detected vault entry count: $(wc -l < "$map_file" | tr -d ' ')"

        if [ ! -s "$map_file" ]; then
            rm -f "$map_file"
            log_warn "No vaults detected automatically, prompting for manual path"

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
        if [ ! -d "$vault_path" ]; then
            log_warn "Skipping missing path: ${vault_path}"
            continue
        fi

        copy_plugin_into_vault "$vault_path"
    done
}

main "$@"
