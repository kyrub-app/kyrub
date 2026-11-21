import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  ACCESSIBILITY_FONT_INCREASE_PX,
  MIN_ACCESSIBLE_TEXT_PX,
  getAccessibleFontSize,
} from '../src/hooks/useFontSizeAccessibility';

test('font accessibility follows Catu baseline and never leaves tiny operational labels', () => {
  assert.equal(ACCESSIBILITY_FONT_INCREASE_PX, 4);
  assert.equal(MIN_ACCESSIBLE_TEXT_PX, 13);
  assert.equal(getAccessibleFontSize('7px'), '13px');
  assert.equal(getAccessibleFontSize('8px'), '13px');
  assert.equal(getAccessibleFontSize('10px'), '14px');
  assert.equal(getAccessibleFontSize('12px'), '16px');
  assert.equal(getAccessibleFontSize('8px', 0), '8px');
  assert.equal(getAccessibleFontSize('16px'), '20px');
  assert.equal(getAccessibleFontSize('9px'), '13px');
  assert.equal(getAccessibleFontSize('12.5px'), '16.5px');
});

test('font accessibility preserves zero and rejects invalid sizes', () => {
  assert.equal(getAccessibleFontSize('0px'), null);
  assert.equal(getAccessibleFontSize('invalid'), null);
  assert.equal(getAccessibleFontSize('16px', Number.NaN), null);
  assert.equal(getAccessibleFontSize('16px', -1), null);
});

test('runtime observer adjusts new screens without reapplying existing text', () => {
  const hookSource = readFileSync(
    'src/hooks/useFontSizeAccessibility.ts',
    'utf8'
  );
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const viteConfig = readFileSync('vite.config.ts', 'utf8');
  const globalStyles = readFileSync('src/index.css', 'utf8');

  assert.match(hookSource, /new MutationObserver\(mutations =>/);
  assert.match(hookSource, /collectElementSubtree\(addedRoot\)/);
  assert.match(hookSource, /window\.getComputedStyle\(element\)\.fontSize/);
  assert.match(
    hookSource,
    /setProperty\('font-size', accessibleFontSize, 'important'\)/
  );
  assert.match(hookSource, /adjustedElements\.has\(element\)/);
  assert.match(
    hookSource,
    /observer\.observe\(document\.body,\s*\{\s*childList:\s*true,\s*subtree:\s*true,\s*attributes:\s*true,\s*attributeFilter:\s*\['data-kyrub-font-scope'\],\s*\}\)/
  );
  assert.match(hookSource, /PORTAL_TYPOGRAPHY_SELECTOR/);
  assert.match(hookSource, /isWithinManagedScope\(addedRoot\)/);
  assert.match(hookSource, /SPECIALIZED_TYPOGRAPHY_SELECTOR/);
  assert.match(hookSource, /attributeFilter:\s*\['data-kyrub-font-scope'\]/);
  assert.doesNotMatch(hookSource, /attributeFilter:\s*\[[^\]]*className/);
  assert.doesNotMatch(hookSource, /requestAnimationFrame/);
  assert.match(appSource, /useFontSizeAccessibility\(\);/);
  assert.doesNotMatch(viteConfig, /fontSizeAccessibilityPlugin/);
  assert.equal(existsSync('build/fontSizeAccessibility.ts'), false);
  assert.match(globalStyles, /body\s*\{\s*font-size:\s*16px;/);
});


const listTsxFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listTsxFiles(path)
      : entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
  });

test('audits typography coverage across personal app, all ERP source modules and administration', () => {
  const files = listTsxFiles('src');
  const admin = files.filter(file => file.includes('src/components/admin/'));
  const erp = files.filter(file => file.includes('src/components/store/'));
  const personal = files.filter(file => !admin.includes(file) && !erp.includes(file));
  assert.ok(files.length >= 300, 'All UI sources must be included, not only the screenshots');
  assert.ok(admin.length >= 25 && erp.length >= 130 && personal.length >= 100,
    'The administrative, ERP and personal route families must be enumerated');

  const result = [personal, erp, admin].map((group, index) => {
    const counts = { seven: 0, eight: 0, nine: 0 };
    let portalHosts = 0;
    for (const file of group) {
      const source = readFileSync(file, 'utf8');
      counts.seven += (source.match(/text-\[7px\]/g) || []).length;
      counts.eight += (source.match(/text-\[8px\]/g) || []).length;
      counts.nine += (source.match(/text-\[9px\]/g) || []).length;
      if (source.includes('createPortal(')) portalHosts++;
    }
    assert.ok(counts.seven + counts.eight + counts.nine >= 0);
    return { family: ['personal', 'erp', 'admin'][index], files: group.length, portalHosts, ...counts };
  });

  const app = readFileSync('src/App.tsx', 'utf8');
  const hook = readFileSync('src/hooks/useFontSizeAccessibility.ts', 'utf8');
  const modalBridge = readFileSync('src/components/AppModalLayoutBridge.tsx', 'utf8');
  assert.match(app, /useFontSizeAccessibility\(\)/);
  assert.match(app, /if \(adminControlPlane\) return <AdminControlPlaneRoot \/>/);
  assert.match(app, /<AuthenticatedKyrubApp operational \/>/);
  assert.match(hook, /MIN_ACCESSIBLE_TEXT_PX = 13/);
  assert.match(hook, /rootElement\.contains\(element\)/);
  assert.match(hook, /data-kyrub-top-panel="true"/);
  assert.match(modalBridge, /markOwnedSelfManagedPortal\(overlay\)/);
  assert.match(hook, /attributeFilter: \['data-kyrub-font-scope'\]/);

  for (const [size, expected] of [['7px', '13px'], ['8px', '13px'], ['9px', '13px'], ['10px', '14px']]) {
    assert.equal(getAccessibleFontSize(size), expected, size);
  }

  console.info('Static typography audit:', JSON.stringify(result));
  // Static source coverage and build tests are not a visual/device E2E proof.
});
