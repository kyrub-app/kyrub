import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ACCESSIBILITY_FONT_INCREASE_PX,
  getAccessibleFontSize,
} from '../src/hooks/useFontSizeAccessibility';

test('font accessibility adds exactly ten pixels to computed sizes', () => {
  assert.equal(ACCESSIBILITY_FONT_INCREASE_PX, 10);
  assert.equal(getAccessibleFontSize('16px'), '26px');
  assert.equal(getAccessibleFontSize('9px'), '19px');
  assert.equal(getAccessibleFontSize('12.5px'), '22.5px');
});

test('font accessibility preserves zero and rejects invalid sizes', () => {
  assert.equal(getAccessibleFontSize('0px'), null);
  assert.equal(getAccessibleFontSize('invalid'), null);
  assert.equal(getAccessibleFontSize('16px', Number.NaN), null);
});

test('runtime observer covers authenticated and dynamically mounted screens', () => {
  const hookSource = readFileSync(
    'src/hooks/useFontSizeAccessibility.ts',
    'utf8'
  );
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const viteConfig = readFileSync('vite.config.ts', 'utf8');
  const globalStyles = readFileSync('src/index.css', 'utf8');

  assert.match(hookSource, /new MutationObserver\(scheduleFontIncrease\)/);
  assert.match(hookSource, /rootElement\.querySelectorAll\('\*'\)/);
  assert.match(hookSource, /window\.getComputedStyle\(element\)\.fontSize/);
  assert.match(
    hookSource,
    /setProperty\('font-size', accessibleFontSize, 'important'\)/
  );
  assert.match(hookSource, /attributeFilter:\s*\['class'\]/);
  assert.match(appSource, /useFontSizeAccessibility\(\);/);
  assert.doesNotMatch(viteConfig, /fontSizeAccessibilityPlugin/);
  assert.equal(existsSync('build/fontSizeAccessibility.ts'), false);
  assert.match(globalStyles, /body\s*\{\s*font-size:\s*16px;/);
});
