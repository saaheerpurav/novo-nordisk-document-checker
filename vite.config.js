import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The plugin was already a dependency but never loaded, so JSX compiled through
// bare esbuild and every edit forced a full page reload. Loading it turns on
// Fast Refresh, which keeps component state — an open modal, the selected
// filter chip, an expanded audit row — across an edit.
export default defineConfig({ plugins: [react()] })
