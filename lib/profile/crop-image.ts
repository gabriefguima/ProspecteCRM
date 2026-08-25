/**
 * Recorta a imagem no CANVAS do navegador, a partir da área que o
 * `react-easy-crop` calculou (`onCropComplete` → pixels reais, não percentual).
 * Roda inteiro no cliente — o servidor só recebe o resultado já recortado.
 */
export interface AreaEmPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", (e) => reject(e));
    // A imagem vem de um blob: URL local (createObjectURL) — mesma origem,
    // não precisa de crossOrigin. Se algum dia vier de outra origem, o canvas
    // ficaria "tainted" e toBlob() falharia silenciosamente sem isto.
    img.crossOrigin = "anonymous";
    img.src = src;
  });
}

/**
 * `ladoFinal`: o avatar é sempre quadrado na saída (o círculo é só a MÁSCARA
 * visual do editor — components/ui/avatar já corta em círculo via CSS
 * `border-radius`, então gravar um círculo de verdade desperdiçaria bytes com
 * transparência que ninguém vê). 512px cobre qualquer tela retina razoável
 * para um avatar e, em JPEG qualidade 0.9, fica bem abaixo do teto de 512 KB
 * do bucket.
 */
const LADO_FINAL = 512;

export async function recortarImagem(
  imagemSrc: string,
  areaEmPixels: AreaEmPixels,
): Promise<Blob> {
  const imagem = await carregarImagem(imagemSrc);
  const canvas = document.createElement("canvas");
  canvas.width = LADO_FINAL;
  canvas.height = LADO_FINAL;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_context_indisponivel");

  ctx.drawImage(
    imagem,
    areaEmPixels.x,
    areaEmPixels.y,
    areaEmPixels.width,
    areaEmPixels.height,
    0,
    0,
    LADO_FINAL,
    LADO_FINAL,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas_to_blob_falhou"));
      },
      "image/jpeg",
      0.9,
    );
  });
}
