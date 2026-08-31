/**
 * Horizon Design System — token build
 *
 * Reads the DTCG token files in ./tokens and emits one CSS custom-property
 * file per platform into ./build/css:
 *
 *   build/css/web.css
 *   build/css/mobile.css
 *   build/css/back-office.css
 *
 * Each file contains:
 *   :root { ... }                 core palette + platform type/space + light semantic colors
 *   [data-theme="dark"] { ... }   dark semantic colour overrides only
 *
 * Style Dictionary v5 is ESM-only, so it is pulled in with a dynamic import
 * to stay compatible with this package's "type": "commonjs".
 */

const fs = require('node:fs');
const path = require('node:path');

const TOKENS = 'tokens';
const OUT_DIR = path.join('build', 'css');

const PLATFORMS = ['web', 'mobile', 'back-office'];

const SHARED = [
  `${TOKENS}/core.value.tokens.json`,
  `${TOKENS}/typography.styles.tokens.json`,
  `${TOKENS}/effects.styles.tokens.json`,
];

const src = (p) => [
  `${TOKENS}/core.value.tokens.json`,
  `${TOKENS}/type.${p}.tokens.json`,
  `${TOKENS}/semantic-space.${p}.tokens.json`,
];

/** Figma weight names -> numeric CSS font-weight. */
const WEIGHTS = {
  thin: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

const weightNumber = (v) =>
  WEIGHTS[String(v).replace(/[\s_-]/g, '').toLowerCase()];

/** A bare number in a DTCG typography composite means pixels. */
const toDimension = (v) => (typeof v === 'number' ? { value: v, unit: 'px' } : v);

async function main() {
  const { default: StyleDictionary } = await import('style-dictionary');

  // Split $type: typography composites into one custom property per
  // sub-property. Style Dictionary's built-in `expand` flattens the DTCG
  // dimension objects into `-value`/`-unit` pairs, so this does it by hand
  // and keeps `{alias}` strings intact for the resolver.
  StyleDictionary.registerPreprocessor({
    name: 'hds/expand-typography',
    preprocessor: (dictionary) => {
      const SUFFIXES = {
        fontFamily: ['font-family', 'fontFamily', (v) => v],
        fontWeight: ['font-weight', 'fontWeight', (v) => v],
        fontSize: ['font-size', 'dimension', toDimension],
        lineHeight: ['line-height', 'dimension', toDimension],
        letterSpacing: ['letter-spacing', 'dimension', toDimension],
      };

      const walk = (node) => {
        const out = {};
        for (const [key, token] of Object.entries(node)) {
          const isComposite =
            token &&
            typeof token === 'object' &&
            token.$type === 'typography' &&
            token.$value &&
            typeof token.$value === 'object';

          if (isComposite) {
            for (const [prop, [suffix, $type, coerce]] of Object.entries(SUFFIXES)) {
              const raw = token.$value[prop];
              if (raw === undefined || raw === null) continue;
              out[`${key}-${suffix}`] = {
                filePath: token.filePath,
                isSource: token.isSource,
                $type,
                $value: coerce(raw),
                ...(token.$description ? { $description: token.$description } : {}),
              };
            }
          } else if (
            token &&
            typeof token === 'object' &&
            !Array.isArray(token) &&
            token.$value === undefined
          ) {
            out[key] = walk(token);
          } else {
            out[key] = token;
          }
        }
        return out;
      };

      return walk(dictionary);
    },
  });

  // "Semi Bold" -> 600, so the emitted var is valid CSS.
  StyleDictionary.registerTransform({
    name: 'hds/font-weight-number',
    type: 'value',
    transitive: true,
    filter: (token) =>
      token.$type === 'fontWeight' &&
      typeof token.$value === 'string' &&
      weightNumber(token.$value) !== undefined,
    transform: (token) => weightNumber(token.$value),
  });

  const transforms = [
    'hds/font-weight-number',
    ...StyleDictionary.hooks.transformGroups.css,
  ];

  const platformConfig = (destination, selector, filter) => ({
    css: {
      transforms,
      buildPath: `${OUT_DIR}/`,
      files: [
        {
          destination,
          format: 'css/variables',
          filter,
          options: { outputReferences: true, usesDtcg: true },
        },
      ],
      options: { selector },
    },
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const p of PLATFORMS) {
    const lightFile = `.${p}.light.css`;
    const darkFile = `.${p}.dark.css`;

    // :root — everything, with light semantic colours.
    const light = new StyleDictionary({
      source: [
        ...src(p),
        `${TOKENS}/semantic-color.light.tokens.json`,
        ...SHARED.slice(1),
      ],
      preprocessors: ['hds/expand-typography'],
      platforms: platformConfig(lightFile, ':root'),
    });
    await light.buildAllPlatforms();

    // Dark block — only the semantic colour tokens; core is present purely
    // so the aliases resolve, and outputReferences keeps them as var().
    const dark = new StyleDictionary({
      source: [...src(p), `${TOKENS}/semantic-color.dark.tokens.json`],
      platforms: platformConfig(
        darkFile,
        '[data-theme="dark"]',
        (token) => /semantic-color\.dark/.test(token.filePath),
      ),
      // The core palette is deliberately filtered out of this block; it is
      // already emitted in :root and referenced from here via var().
      log: { warnings: 'disabled' },
    });
    await dark.buildAllPlatforms();

    const lightPath = path.join(OUT_DIR, lightFile);
    const darkPath = path.join(OUT_DIR, darkFile);

    const header = [
      '/**',
      ' * Do not edit directly — generated by build-tokens.js',
      ` * Platform: ${p}`,
      ' */',
      '',
    ].join('\n');

    const strip = (file) =>
      fs.readFileSync(file, 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').trim();

    fs.writeFileSync(
      path.join(OUT_DIR, `${p}.css`),
      `${header}\n${strip(lightPath)}\n\n${strip(darkPath)}\n`,
    );

    fs.rmSync(lightPath);
    fs.rmSync(darkPath);

    console.log(`✔ ${OUT_DIR}/${p}.css`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
