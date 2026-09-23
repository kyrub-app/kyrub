import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

type RuntimeAliasContract = {
  file: string;
  required: readonly string[];
  forbidden?: readonly string[];
};

const runtimeAliasGuard = (): Plugin => ({
  name: 'kyrub-runtime-alias-guard',
  buildStart() {
    const contracts: readonly RuntimeAliasContract[] = [
      {
        file: 'src/components/MobileErpMenuRuntime.tsx',
        required: ["from './MobileErpMenu'", 'MOBILE_ERP_MENU_ITEMS'],
        forbidden: ['const MENU_ITEMS'],
      },
      {
        file: 'src/components/RetailerPanelRuntimeRouter.tsx',
        required: ["from './RetailerPanel'", 'ModernRetailerPanel'],
      },
      {
        file: 'src/ai/consultantClientWithPlans.ts',
        required: ["from './consultantClient'", 'requestLegacyKyrubAiConsultant'],
      },
      {
        file: 'src/utils/communityCloudQuerySafe.ts',
        required: ["export * from './communityCloud.ts'"],
      },
    ];

    for (const contract of contracts) {
      const source = readFileSync(path.resolve(__dirname, contract.file), 'utf8');

      for (const token of contract.required) {
        if (!source.includes(token)) {
          this.error(
            `[runtime-alias-guard] ${contract.file} deixou de delegar para a fonte canônica esperada: ${token}`
          );
        }
      }

      for (const token of contract.forbidden ?? []) {
        if (source.includes(token)) {
          this.error(
            `[runtime-alias-guard] ${contract.file} reintroduziu estado/configuração duplicada proibida: ${token}`
          );
        }
      }
    }
  },
});

export default defineConfig(() => {
  return {
    plugins: [runtimeAliasGuard(), react(), tailwindcss()],
    resolve: {
      alias: [
        {
          find: /^\.\/components\/MobileErpMenu$/,
          replacement: path.resolve(
            __dirname,
            'src/components/MobileErpMenuRuntime.tsx'
          ),
        },
        {
          find: /^\.\/components\/RetailerPanel$/,
          replacement: path.resolve(
            __dirname,
            'src/components/RetailerPanelRuntimeRouter.tsx'
          ),
        },
        {
          find: /^\.\.\/ai\/consultantClient$/,
          replacement: path.resolve(
            __dirname,
            'src/ai/consultantClientWithPlans.ts'
          ),
        },
        {
          find: /^\.\.\/utils\/communityCloud$/,
          replacement: path.resolve(
            __dirname,
            'src/utils/communityCloudQuerySafe.ts'
          ),
        },
        {
          find: '@',
          replacement: path.resolve(__dirname, '.'),
        },
      ],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});