import type { Plugin } from 'vite';

const FONT_SIZE_ACCESSIBILITY_MARKER =
  '/* kyrub-accessibility-font-size-plus-10px */';

const FONT_SIZE_INCREASE_PX = 10;

const TAILWIND_TEXT_TOKEN_PATTERN =
  /(--text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\s*:\s*)(\d*\.?\d+)(px|rem)\b/g;

const FONT_SIZE_DECLARATION_PATTERN =
  /(font-size\s*:\s*)(\d*\.?\d+)(px|rem)\b/g;

const formatPixels = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));

const increaseLengthByTenPixels = (
  rawValue: string,
  unit: 'px' | 'rem'
): string => {
  const numericValue = Number(rawValue);

  // Preserve intentional zero-size declarations used by visual hiding helpers.
  if (!Number.isFinite(numericValue) || numericValue === 0) {
    return `${rawValue}${unit}`;
  }

  if (unit === 'px') {
    return `${formatPixels(numericValue + FONT_SIZE_INCREASE_PX)}px`;
  }

  return `calc(${rawValue}rem + ${FONT_SIZE_INCREASE_PX}px)`;
};

export const increaseFontSizesByTenPixels = (css: string): string => {
  if (css.includes(FONT_SIZE_ACCESSIBILITY_MARKER)) return css;

  const withAdjustedTailwindTokens = css.replace(
    TAILWIND_TEXT_TOKEN_PATTERN,
    (_match, prefix: string, rawValue: string, unit: 'px' | 'rem') =>
      `${prefix}${increaseLengthByTenPixels(rawValue, unit)}`
  );

  const withAdjustedDeclarations = withAdjustedTailwindTokens.replace(
    FONT_SIZE_DECLARATION_PATTERN,
    (_match, prefix: string, rawValue: string, unit: 'px' | 'rem') =>
      `${prefix}${increaseLengthByTenPixels(rawValue, unit)}`
  );

  return `${FONT_SIZE_ACCESSIBILITY_MARKER}\n${withAdjustedDeclarations}`;
};

export const fontSizeAccessibilityPlugin = (): Plugin => ({
  name: 'kyrub-accessibility-font-size-plus-10px',
  enforce: 'post',
  transform(code, id) {
    if (!id.includes('.css')) return null;

    return {
      code: increaseFontSizesByTenPixels(code),
      map: null,
    };
  },
});