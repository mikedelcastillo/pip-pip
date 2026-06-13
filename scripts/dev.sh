#!/bin/bash
set -e

SESSION="pip-pip"

if ! command -v tmux >/dev/null 2>&1; then
    echo "tmux is required. Install with: brew install tmux"
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

create_session() {
    # Kill any partial session if setup fails mid-way.
    trap 'tmux kill-session -t "=$SESSION" 2>/dev/null; trap - ERR' ERR
    # Capture stable pane IDs via -P -F to avoid pane-base-index sensitivity.
    # Omit -x/-y: tmux would bake those as default-size for all future windows;
    # attaching below will resize the session to the real terminal dimensions.
    pane0=$(tmux new-session -d -s "$SESSION" -n dev -c "$REPO_ROOT" -P -F '#{pane_id}')
    tmux send-keys -t "$pane0" "yarn server dev" Enter
    pane1=$(tmux split-window -h -t "$pane0" -c "$REPO_ROOT" -P -F '#{pane_id}')
    tmux send-keys -t "$pane1" "yarn client dev" Enter
    tmux select-pane -t "$pane0"
    trap - ERR
}

# Inside any existing tmux session: use switch-client to avoid nesting.
# The original guard only checked for the pip-pip session, allowing nested
# tmux when invoked from any other session (e.g. "work").
if [ -n "$TMUX" ]; then
    if [ "$(tmux display-message -p '#S')" = "$SESSION" ]; then
        echo "Already inside the '$SESSION' tmux session."
        exit 0
    fi
    if ! tmux has-session -t "=$SESSION" 2>/dev/null; then
        create_session
    fi
    exec tmux switch-client -t "=$SESSION"
fi

# Not in tmux: create session if needed, then attach.
if ! tmux has-session -t "=$SESSION" 2>/dev/null; then
    create_session
fi

exec tmux attach -t "=$SESSION"
