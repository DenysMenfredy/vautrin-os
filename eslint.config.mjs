// ---------------------------------------------------------------------------
// ESLint — Vue single-file component templates only.
//
// Biome is the linter and formatter for this repository (see biome.json). It
// parses the <script> block of a .vue file but does not look at <template> at
// all: it will not format template markup and has no Vue template rules.
//
// ESLint exists here to cover exactly that gap, and nothing else:
//
//   Biome   ->  <script> blocks, and every .ts/.js file
//   ESLint  ->  <template> blocks in .vue files
//
// The split is deliberate and the boundary matters. Because Biome never
// touches template markup, eslint-plugin-vue can own template formatting
// outright and the two tools cannot fight over the same bytes. Do not add
// rules here that apply to <script> or to plain TypeScript — that is Biome's
// job, and duplicating it is how the two configurations start disagreeing.
// ---------------------------------------------------------------------------

import tsParser from '@typescript-eslint/parser';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

export default [
  {
    // Flat config has no inheritance from .gitignore, so build output has to
    // be excluded explicitly.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/.turbo/**',
      '**/coverage/**',
    ],
  },

  ...pluginVue.configs['flat/recommended'],

  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        // vue-eslint-parser handles the SFC; the TypeScript parser is
        // delegated the contents of <script lang="ts">.
        parser: tsParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // --- Correctness --------------------------------------------------
      // These are the template bugs Biome structurally cannot see.
      //
      // no-unused-vars is delegated here from Biome on purpose. Biome would
      // report every `<script setup>` binding that is only referenced from
      // the template as unused, because it never reads <template>.
      // vue-eslint-parser resolves those references into script scope, so
      // this rule is accurate on SFCs where Biome's equivalent is not.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'vue/no-unused-components': 'error',
      'vue/no-unused-vars': 'error',
      'vue/require-v-for-key': 'error',
      'vue/no-use-v-if-with-v-for': 'error',
      'vue/no-mutating-props': 'error',

      // --- Formatting ---------------------------------------------------
      // Owned here because Biome leaves template markup alone. Kept in step
      // with biome.json: 2-space indent, 100-column lines.
      'vue/html-indent': ['error', 2],
      'vue/max-attributes-per-line': ['error', { singleline: { max: 4 } }],

      // --- Conventions ----------------------------------------------------
      // Off: Nuxt derives component names from file paths, so pages/index.vue
      // and similar single-word files are expected and correct.
      'vue/multi-word-component-names': 'off',
    },
  },
];
