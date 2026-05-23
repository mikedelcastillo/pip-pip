#!/bin/bash
set -e

SESSION="pip-pip"

if ! command -v tmux >/dev/null 2>&1; then
    echo "tmux is required. Install with: brew install tmux"
    exit 1
fi

# If we're already inside this session, just attach (avoid nesting).
if [ "$TMUX" ] && tmux display-message -p '#S' | grep -qx "$SESSION"; then
    echo "Already inside the '$SESSION' tmux session."
    exit 0
fi

# Reuse an existing session if one is running.
if tmux has-session -t "$SESSION" 2>/dev/null; then
    exec tmux attach -t "$SESSION"
fi

cd "$(dirname "$0")/.."

tmux new-session -d -s "$SESSION" -n dev -x "$(tput cols)" -y "$(tput lines)"
tmux send-keys -t "$SESSION:dev.0" "yarn server dev" Enter

tmux split-window -h -t "$SESSION:dev"
tmux send-keys -t "$SESSION:dev.1" "yarn client dev" Enter

tmux select-pane -t "$SESSION:dev.0"

exec tmux attach -t "$SESSION"
