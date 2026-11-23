import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

export default defineConfig({
  plugins: [
    vue(),
    cssInjectedByJsPlugin({
      // 注入到主窗口的 document.head，兼容酒馆助手 iframe 模式
      injectCodeFunction: function injectCodeCustomRunTimeFunction(cssCode: string) {
        try {
          let doc: Document = document;
          try {
            if (window.parent && window.parent !== window && window.parent.document) {
              doc = window.parent.document;
            }
          } catch (_) {}
          const old = doc.getElementById('st-theme-companion-css');
          if (old) old.remove();
          const style = doc.createElement('style');
          style.id = 'st-theme-companion-css';
          style.textContent = cssCode;
          doc.head.appendChild(style);
        } catch (e) {
          console.error('[ThemeCompanion] CSS 注入失败:', e);
        }
      },
    }),
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    minify: 'esbuild',
    lib: {
      entry: 'src/main.ts',
      name: 'STThemeCompanion',
      formats: ['iife'],
      fileName: () => 'theme-companion.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
