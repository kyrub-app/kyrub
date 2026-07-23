import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { increaseFontSizesByTwoPixels } from '../build/fontSizeAccessibility';

test('font accessibility transform adds exactly two pixels to CSS sizes', () => {
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

  const adjusted = increaseFontSizesByTwoPixels(source);

  assert.match(adjusted, /--text-xs:\s*calc\(\.75rem \+ 2px\)/);
  assert.match(adjusted, /--text-sm:\s*calc\(\.875rem \+ 2px\)/);
  assert.match(adjusted, /body\s*\{\s*font-size:\s*18px/);
  assert.match(adjusted, /\.compact\s*\{\s*font-size:\s*11px/);
  assert.match(adjusted, /\.relative\s*\{\s*font-size:\s*calc\(1rem \+ 2px\)/);
  assert.match(adjusted, /\.hidden-text\s*\{\s*font-size:\s*0px/);
  assert.match(adjusted, /--text-xs--line-height:\s*calc\(1 \/ \.75\)/);
});

test('font accessibility transform is idempotent', () => {
  const once = increaseFontSizesByTwoPixels('.label { font-size: 10px; }');
  const twice = increaseFontSizesByTwoPixels(once);

  assert.equal(twice, once);
  assert.match(twice, /font-size:\s*12px/);
});

test('Vite applies the transform after Tailwind and defines inherited text', () => {
  const viteConfig = readFileSync('vite.config.ts', 'utf8');
  const globalStyles = readFileSync('src/index.css', 'utf8');

  assert.match(
    viteConfig,
    /plugins:\s*\[react\(\), tailwindcss\(\), fontSizeAccessibilityPlugin\(\)\]/
  );
  assert.match(globalStyles, /body\s*\{\s*font-size:\s*16px;/);
});
