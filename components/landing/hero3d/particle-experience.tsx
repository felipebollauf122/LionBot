"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useScroll, useSpring, useMotionValue, useMotionValueEvent } from "motion/react";
import { GLParticles, type ShapeDef } from "./gl-particles";
import { GalaxyBackground } from "./galaxy-background";

/**
 * Experiência de PARTÍCULAS (WebGL): ~1M partículas formam o LEÃO e morpham nos
 * TEXTOS REAIS da landing (os números do hero), reagindo ao mouse. Tela inteira
 * coberta. Scroll dirige o morph; o mouse explode/empurra as partículas.
 */

const COUNT = 600_000; // partículas (GPU aguenta liso)

// imagem-fonte do leão (já gerada em public/lion-sample.png)
const LION_IMG = "/lion-sample.png";

// textos REAIS que já existiam na landing (números do hero)
const TEXTS: { lines: string[] }[] = [
  { lines: ["VOCÊ AINDA VENDE", "NO TELEGRAM", "NA MÃO?"] },
  { lines: ["2.400+", "BOTS ATIVOS"] },
  { lines: ["R$ 4.2M", "PROCESSADOS / MÊS"] },
  { lines: ["+38%", "DE CONVERSÃO"] },
  { lines: ["PILOTO", "AUTOMÁTICO", "24H"] },
  { lines: ["CRIE SEU", "BOT GRÁTIS"] },
];

export function ParticleExperience({ tail }: { tail?: React.ReactNode }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [lionEl, setLionEl] = useState<HTMLImageElement | null>(null);

  // pré-carrega a imagem do leão; só monta as partículas quando ela carregar.
  useEffect(() => {
    const img = new Image();
    img.onload = () => setLionEl(img);
    img.src = LION_IMG;
  }, []);

  // formas: leão + um texto por bloco (re-cria quando a imagem do leão carrega)
  const shapes = useMemo<ShapeDef[]>(() => {
    const arr: ShapeDef[] = [];
    // forma 0: LEÃO (desenha a imagem cobrindo a tela, centralizado/contido)
    arr.push({
      kind: "lion",
      draw: (ctx, w, h) => {
        if (!lionEl) return;
        const s = Math.min(w, h) * 0.92;
        ctx.drawImage(lionEl, (w - s) / 2, (h - s) / 2, s, s);
      },
    });
    // formas de texto
    for (const tdef of TEXTS) {
      arr.push({
        kind: "text",
        draw: (ctx, w, h) => {
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = "#fff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const lines = tdef.lines;
          const maxW = w * 0.88;
          // acha o maior size que cabe TODAS as linhas
          let size = Math.min(h / (lines.length + 0.5), 280);
          const fit = () => {
            ctx.font = `900 ${size}px 'Chakra Petch','Arial Black',sans-serif`;
            return Math.max(...lines.map((l) => ctx.measureText(l).width));
          };
          while (fit() > maxW && size > 40) size -= 8;
          const lh = size * 1.06;
          const totalH = lh * lines.length;
          lines.forEach((l, i) => {
            const y = h / 2 - totalH / 2 + lh * (i + 0.5);
            ctx.fillText(l, w / 2, y);
          });
        },
      });
    }
    return arr;
  }, [lionEl]);

  const SHAPES = shapes.length;

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start start", "end end"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 90, damping: 28, mass: 0.5 });

  const morph = useMotionValue(0);
  useMotionValueEvent(smooth, "change", (v) => {
    // segura no leão no começo, depois cicla pelos textos COM DWELL:
    // cada forma fica MONTADA por um trecho (hold) e só desorganiza numa
    // transição curta. Mais tempo de scroll lendo a palavra inteira.
    const p = Math.max(0, Math.min(1, (v - 0.06) / 0.92));
    const segs = SHAPES - 1;              // nº de transições
    const x = p * segs;                    // 0..segs
    const i = Math.min(segs - 1, Math.floor(x));
    const f = x - i;                       // 0..1 dentro do segmento
    // dwell: 65% do segmento PARADO na forma i, 35% transicionando p/ i+1
    const HOLD = 0.62;
    let local: number;
    if (f < HOLD) local = 0;               // montado em i
    else local = (f - HOLD) / (1 - HOLD);  // transição i → i+1
    // suaviza a transição (ease-in-out) pra ficar fluida
    const e = local < 0.5 ? 2 * local * local : 1 - Math.pow(-2 * local + 2, 2) / 2;
    morph.set(i + e);
  });
  const getMorph = () => morph.get();

  return (
    <section ref={sectionRef} className="relative bg-(--bg-root)" style={{ height: `${(SHAPES + 1) * 100}vh` }}>
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        {/* fundo de galáxia (camada mais ao fundo, atrás do leão) */}
        <GalaxyBackground className="absolute inset-0" />
        {lionEl && <GLParticles getMorph={getMorph} shapes={shapes} count={COUNT} className="absolute inset-0" />}
        {/* dica de scroll */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-(--text-muted) text-[11px] uppercase tracking-[0.2em] pointer-events-none" style={{ fontFamily: "var(--font-mono)" }}>
          role · passe o mouse
        </div>
      </div>
      <div className="relative z-10">{tail}</div>
    </section>
  );
}
