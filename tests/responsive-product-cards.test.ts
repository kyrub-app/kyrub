import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync('src/styles/responsive-product-cards.css', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');

test('public storefront starts with two product columns on mobile', () => {
  assert.match(
    styles,
    /#storefront-panel-container[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
  );
});

test('product grids progressively expand to three and four columns', () => {
  assert.match(styles, /@media \(min-width: 640px\)[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(min-width: 1024px\)[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
});

test('seller cardápio and customer catálogo share the responsive contract', () => {
  assert.match(styles, /\.z-\\\[120\\\] main > \.grid\.grid-cols-2/);
  assert.match(styles, /article\[id\^='storefront-prod-'\]/);
});

test('responsive product styles load after the Tailwind entry stylesheet', () => {
  const tailwindImport = main.indexOf("import './index.css';");
  const responsiveImport = main.indexOf("import './styles/responsive-product-cards.css';");

  assert.ok(tailwindImport >= 0);
  assert.ok(responsiveImport > tailwindImport);
});
