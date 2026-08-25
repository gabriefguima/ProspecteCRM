"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { recortarImagem } from "@/lib/profile/crop-image";

interface Props {
  currentUrl: string | null;
  displayName: string;
  onUploaded: (url: string) => void;
}

const TIPOS_ACEITOS = "image/png,image/jpeg";

/** Mensagem por código de recusa da rota — mesmo padrão de CampoDeLogo.tsx. */
const ERRO_EM_PORTUGUES: Record<string, string> = {
  unauthenticated: "Sua sessão expirou. Entre de novo para trocar a foto.",
  rate_limited: "Muitas trocas seguidas. Tente de novo em alguns minutos.",
  payload_too_large: "A foto ficou grande demais depois do recorte. Aumente um pouco o zoom.",
  unsupported_media_type: "A foto precisa ser PNG ou JPG.",
  avatar_svg_recusado: "SVG não é aceito como foto de perfil.",
};

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = [...partes[0]!][0] ?? "?";
  const ultima = partes.length > 1 ? ([...partes[partes.length - 1]!][0] ?? "") : "";
  return (primeira + ultima).toUpperCase();
}

export function AvatarCropDialog({ currentUrl, displayName, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imagemSrc, setImagemSrc] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaEmPixels, setAreaEmPixels] = useState<Area | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Revoga o object URL ao trocar/desmontar — sem isto, cada foto escolhida
  // vaza memória até a aba fechar (createObjectURL não se limpa sozinho).
  useEffect(() => {
    return () => {
      if (imagemSrc) URL.revokeObjectURL(imagemSrc);
    };
  }, [imagemSrc]);

  function abrirSeletor() {
    inputRef.current?.click();
  }

  function handleArquivoEscolhido(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite escolher o MESMO arquivo de novo depois de cancelar
    if (!arquivo) return;
    if (!TIPOS_ACEITOS.split(",").includes(arquivo.type)) {
      toast.error("A foto precisa ser PNG ou JPG.");
      return;
    }
    setImagemSrc(URL.createObjectURL(arquivo));
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAreaEmPixels(null);
    setAberto(true);
  }

  const onCropComplete = useCallback((_areaPercentual: Area, pixels: Area) => {
    setAreaEmPixels(pixels);
  }, []);

  function fechar() {
    setAberto(false);
    if (imagemSrc) URL.revokeObjectURL(imagemSrc);
    setImagemSrc(null);
  }

  async function confirmar() {
    if (!imagemSrc || !areaEmPixels) return;
    setEnviando(true);
    try {
      const blob = await recortarImagem(imagemSrc, areaEmPixels);
      const form = new FormData();
      form.set("file", blob, "avatar.jpg");
      const resposta = await fetch("/api/v1/profile/avatar", { method: "POST", body: form });
      const corpo = (await resposta.json().catch(() => null)) as
        | { data?: { avatar_url: string } }
        | { error?: { code?: string; message?: string } }
        | null;
      if (!resposta.ok || !corpo || "error" in corpo) {
        const codigo = corpo && "error" in corpo ? corpo.error?.code : undefined;
        toast.error(
          (codigo && ERRO_EM_PORTUGUES[codigo]) ||
            (corpo && "error" in corpo ? corpo.error?.message : undefined) ||
            "Não consegui salvar a foto. Tente de novo.",
        );
        return;
      }
      if ("data" in corpo && corpo.data) {
        onUploaded(corpo.data.avatar_url);
        toast.success("Foto atualizada.");
        fechar();
      }
    } catch {
      toast.error("Não consegui recortar a imagem. Tente outro arquivo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar className="h-16 w-16">
        <AvatarImage src={currentUrl ?? undefined} alt={displayName} />
        <AvatarFallback>{iniciais(displayName)}</AvatarFallback>
      </Avatar>
      <div className="space-y-1">
        <Button type="button" variant="outline" size="sm" onClick={abrirSeletor}>
          Alterar foto
        </Button>
        <p className="text-xs text-muted-foreground">PNG ou JPG. Você recorta antes de salvar.</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={TIPOS_ACEITOS}
        className="hidden"
        onChange={handleArquivoEscolhido}
      />

      <Dialog open={aberto} onOpenChange={(v) => (v ? setAberto(true) : fechar())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar foto</DialogTitle>
            <DialogDescription>Arraste para posicionar e use o zoom para ajustar.</DialogDescription>
          </DialogHeader>

          {imagemSrc && (
            <div className="relative h-72 w-full overflow-hidden rounded-md bg-muted">
              <Cropper
                image={imagemSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
          )}

          <div className="flex items-center gap-3 px-1">
            <span className="text-xs text-muted-foreground">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer accent-primary"
              aria-label="Zoom da foto"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={fechar} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="button" onClick={confirmar} disabled={enviando || !areaEmPixels}>
              {enviando ? "Salvando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
