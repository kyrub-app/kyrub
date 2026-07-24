import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FONT_SIZE_INCREASE_PX,
  fontSizeAccessibilityPlugin,
  increaseFontSizesForAccessibility,
} from '../build/fontSizeAccessibility';

test('font accessibility transform adds exactly ten pixels to CSS sizes', () => {
  const source = `
    :root {
      --text-xs: .75rem;
      --text-sm: .875rem;
      --text-xs--line-height: calc(1 / .75);
    }
    body { font-size: 16px; }
    .compact { font-size: 9px; }
    .relative { font-size: 1rem; }
    .hidden-text { font-size: 0px; }
  `;

  const adjusted = increaseFontSizesForAccessibility(source);

  assert.equal(FONT_SIZE_INCREASE_PX, 10);
  assert.match(adjusted, /--text-xs:\s*calc\(\.75rem \+ 10px\)/);
  assert.match(adjusted, /--text-sm:\s*calc\(\.875rem \+ 10px\)/);
  assert.match(adjusted, /body\s*\{\s*font-size:\s*26px/);
  assert.match(adjusted, /\.compact\s*\{\s*font-size:\s*19px/);
  assert.match(adjusted, /\.relative\s*\{\s*font-size:\s*calc\(1rem \+ 10px\)/);
  assert.match(adjusted, /\.hidden-text\s*\{\s*font-size:\s*0px/);
  assert.match(adjusted, /--text-xs--line-height:\s*calc\(1 \/ \.75\)/);
});

test('font accessibility transform is idempotent', () => {
  const once = increaseFontSizesForAccessibility(
    '.label { font-size: 10px; }'
  );
  const twice = increaseFontSizesForAccessibility(once);

  assert.equal(twice, once);
  assert.match(twice, /font-size:\s*20px/);
});

test('Vite plugin transforms the final emitted CSS asset', async () => {
  const plugin = fontSizeAccessibilityPlugin();
  const generateBundle = plugin.generateBundle;

  assert.equal(typeof generateBundle, 'function');

  const bundle = {
    'assets/app.css': {
      type: 'asset',
      fileName: 'assets/app.css',
      source:
        ':root{--text-sm:.875rem}.text-sm{font-size:var(--text-sm)}.custom{font-size:10px}',
    },
    'assets/app.js': {
      type: 'chunk',
      fileName: 'assets/app.js',
      code: 'console.log("ok")',
    },
  } as any;

  await (generateBundle as any).call({}, {}, bundle, false);

  const emittedCss = String(bundle['assets/app.css'].source);

  assert.match(emittedCss, /kyrub-accessibility-font-size-plus-10px-final-css/);
  assert.match(emittedCss, /--text-sm:calc\(\.875rem \+ 10px\)/);
  assert.match(emittedCss, /\.custom\{font-size:20px\}/);
  assert.equal(bundle['assets/app.js'].code, 'console.log("ok")');
});

test('Vite applies the plugin after Tailwind and defines inherited text', () => {
  const viteConfig = readFileSync('vite.config.ts', 'utf8');
  const globalStyles = readFileSync('src/index.css', 'utf8');

  assert.match(
    viteConfig,
    /plugins:\s*\[react\(\), tailwindcss\(\), fontSizeAccessibilityPlugin\(\)\]/
  );
  assert.match(globalStyles, /body\s*\{\s*font-size:\s*16px;/);
});
