/**
 * Onde o AVATAR de perfil mora — o mesmo bucket do logo da marca
 * (`lib/branding/logo.ts`), prefixo novo.
 *
 * ── Por que o MESMO bucket, e não um novo ────────────────────────────────────
 *
 * `brand-logos` é o ÚNICO bucket público do repositório, e isso é garantido por
 * teste (`tests/invariants/marca-logo.test.ts`: "NENHUM outro bucket é
 * público"). Criar um segundo bucket público só pra avatar quebraria esse
 * invariante; criar um PRIVADO exigiria URL assinada com validade curta — e o
 * avatar aparece em toda a casca do app (sidebar, cabeçalho), o tempo todo, sem
 * ninguém "renovando" o link. Reaproveitar o bucket já público resolve os dois
 * problemas de graça: zero bucket novo, URL que nunca expira.
 *
 * O bucket já vem com o limite (512 KB) e os tipos aceitos (PNG/JPEG) certos
 * pra isso — configurados em `supabase/migrations/..._0158_logo_no_storage.sql`
 * — e o farejamento de bytes (`lib/branding/logo-arquivo.ts`) é genérico, não
 * fala nada de logo especificamente. Nada disso precisou mudar.
 *
 * ── O prefixo é POR USUÁRIO, não compartilhado ───────────────────────────────
 *
 * `avatars/<user_id>/<uuid>.<png|jpg>` — mesma ideia de `platform/` e
 * `<org_id>/` em `lib/branding/logo.ts`, só que a unidade que "dona" o prefixo
 * é o USUÁRIO, não a organização (avatar é da PESSOA, atravessa organizações).
 * É esse prefixo que decide se dá pra apagar o arquivo anterior — ver
 * `podeApagarAvatar` abaixo, mesma disciplina de `podeApagar` do logo: sem essa
 * asserção, um usuário poderia ser levado a apagar o avatar/logo de outra
 * pessoa/prefixo só por ter o caminho gravado no seu próprio perfil.
 */
import { urlPublicaDoLogo, baseDoStorage } from "@/lib/branding/logo";

export { BUCKET_DE_LOGOS as BUCKET_DE_AVATARES, TAMANHO_MAXIMO_DO_LOGO as TAMANHO_MAXIMO_DO_AVATAR } from "@/lib/branding/logo";
export { farejarTipo, pareceSvg, extensaoDe, type TipoDeLogo as TipoDeAvatar } from "@/lib/branding/logo-arquivo";

export const PREFIXO_DE_AVATARES = "avatars/";

/** A forma do nome, igual à do logo — `<uuid>.<png|jpg>`, sem barra. */
const FORMA_DO_NOME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg)$/;

export function prefixoDoUsuario(userId: string): string {
  return `${PREFIXO_DE_AVATARES}${userId}/`;
}

export function caminhoNovoDoAvatar(userId: string, extensao: "png" | "jpg"): string {
  return `${prefixoDoUsuario(userId)}${crypto.randomUUID()}.${extensao}`;
}

/**
 * Mesmo raciocínio de `podeApagar` do logo — asseverado na hora de apagar, não
 * só na hora de gravar. O caminho gravado no perfil pode ter vindo de uma
 * versão anterior do produto ou de escrita direta no banco; sem essa dupla
 * checagem (prefixo do USUÁRIO + forma do nome), um caminho fora do prefixo
 * dele seria apagado mesmo assim.
 */
export function podeApagarAvatar(caminho: string | null | undefined, userId: string): boolean {
  const limpo = (caminho ?? "").trim();
  if (limpo.length === 0) return false;
  const prefixo = prefixoDoUsuario(userId);
  if (!limpo.startsWith(prefixo)) return false;
  return FORMA_DO_NOME.test(limpo.slice(prefixo.length));
}

export function urlPublicaDoAvatar(caminho: string, base: string = baseDoStorage()): string {
  return urlPublicaDoLogo(caminho, base);
}
