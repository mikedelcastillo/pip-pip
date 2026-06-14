# Vue 3 + TypeScript + Vite

Map-maker app: Vue 3 `<script setup>` SFCs in Vite. See the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup).

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## Type support for `.vue` imports in TS

TypeScript can't type `.vue` imports, so they're shimmed to a generic component type. That's fine unless you need real prop types in `.vue` imports (e.g. props validation in manual `h(...)` calls). To get them, enable Volar's Take Over mode:

1. From the command palette, run `Extensions: Show Built-in Extensions`, find `TypeScript and JavaScript Language Features`, right-click and `Disable (Workspace)`. Take Over mode auto-enables when the default TS extension is disabled.
2. Run `Developer: Reload Window`.

More on [Take Over mode](https://github.com/johnsoncodehk/volar/discussions/471).
