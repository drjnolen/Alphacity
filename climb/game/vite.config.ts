import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({base:'/climb/assets/',plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},css:{postcss:{plugins:[tailwind()]}},build:{outDir:'../assets',emptyOutDir:true,rollupOptions:{preserveEntrySignatures:'strict',input:'src/mount.tsx',output:{entryFileNames:'game.js',assetFileNames:asset=>asset.names?.some(n=>n.endsWith('.css'))?'game.css':'[name]-[hash][extname]'}}}});
