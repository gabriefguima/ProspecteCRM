/**
 * Config pública injetada em RUNTIME pelo <PublicEnvScript/> (app/public-env-script.tsx).
 *
 * Permite uma imagem Docker GENÉRICA (self-host): as NEXT_PUBLIC_* não são
 * queimadas no bundle em build-time — o servidor injeta os valores reais do
 * projeto Supabase do usuário a cada request. No Vercel/dev cai no fallback
 * process.env.NEXT_PUBLIC_* (baked), então nada muda lá.
 */
interface PublicEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SENTRY_DSN?: string;
  /**
   * Marca da instalação (white-label), já RESOLVIDA — banco acima, arquivo de
   * instalação embaixo. Os nomes das chaves são os do `.env` por herança, mas o
   * valor não vem mais dele direto: quem monta é `app/layout.tsx`. Ver
   * `lib/branding.ts` e o cabeçalho de `app/public-env-script.tsx`.
   *
   * `APP_LOGO_URL` vazio significa "não há logo" — é a forma que
   * `resolveBranding` entende, e a mesma que o `.env` entregava.
   */
  APP_NAME?: string;
  APP_LOGO_URL?: string;
  /**
   * Espelha `env.NUVEMSHOP_ENABLED` (já parseado como boolean por `lib/env.ts`)
   * pro lado do navegador — quem lê é `lib/navigation/registry.ts`, pra decidir
   * se o item "Nuvemshop" some do sidebar/⌘K/hub. Ver o cabeçalho de
   * `app/public-env-script.tsx`: não é segredo, é config de feature.
   */
  NUVEMSHOP_ENABLED?: boolean;
}

interface Window {
  __PUBLIC_ENV__?: PublicEnv;
}
