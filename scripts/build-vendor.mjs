#!/usr/bin/env node
/**
 * Bundle ssh2 (CommonJS, plus asn1/bcrypt-pbkdf/tweetnacl) into one ESM file.
 *
 * Why: DSH loads plugin host modules through an SSR module runner that turns
 * CommonJS dependencies into namespace objects. ssh2's own `module.exports =
 * Client` then arrives as an object, and `new Client()` fails. Pre-bundling at
 * build time resolves CJS interop once, correctly, and leaves runtime imports
 * pure ESM.
 *
 * The generated file is committed so consumers never need esbuild, and the
 * plugin has no install-time native build at all.
 */
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'src', 'vendor', 'ssh2.js');

const stubOptionalNative = {
  name: 'stub-optional-native',
  setup(buildApi) {
    // cpu-features is an optional native accelerator; ssh2 calls it inside a
    // try/catch. Provide a callable stub so bundling never reaches node-gyp.
    buildApi.onResolve({ filter: /^(cpu-features|nan)$/ }, args => ({
      path: args.path,
      namespace: 'optional-native-stub',
    }));
    buildApi.onLoad({ filter: /.*/, namespace: 'optional-native-stub' }, () => ({
      contents: 'export default function optionalNativeUnavailable() { throw new Error("optional native module is not bundled"); }',
      loader: 'js',
    }));
  },
};

await mkdir(dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [join(root, 'scripts', 'ssh2-entry.mjs')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  banner: {
    js: [
      '/*! ssh2 (MIT) + asn1 (MIT) + bcrypt-pbkdf (MIT) + tweetnacl (Unlicense) — bundled for ESM-only hosts. See THIRD_PARTY_NOTICES.md. */',
      // ssh2 is CommonJS and resolves builtins (`net`, `crypto`, …) with
      // require(). In an ESM bundle those calls become dynamic requires; give
      // them a real Node require so they resolve instead of throwing.
      "import { createRequire as __dshCreateRequire } from 'node:module';",
      "import { fileURLToPath as __dshFileURLToPath } from 'node:url';",
      "import { dirname as __dshDirname } from 'node:path';",
      'const require = __dshCreateRequire(import.meta.url);',
      'const __filename = __dshFileURLToPath(import.meta.url);',
      'const __dirname = __dshDirname(__filename);',
    ].join('\n'),
  },
  plugins: [stubOptionalNative],
  metafile: true,
  logLevel: 'info',
});

const inputs = Object.keys(result.metafile.inputs);
console.log(`bundled ${inputs.length} modules into ${outfile}`);
