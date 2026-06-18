"use client";

import { useEffect, useRef } from "react";

/**
 * MOTOR DE PARTÍCULAS em WebGL2 (GPU) com FÍSICA persistente via transform
 * feedback — centenas de milhares de partículas num par de draw calls.
 *
 * Cada partícula guarda posição + velocidade (estado que persiste entre frames).
 * A cada frame:
 *   1) SIMULAÇÃO (transform feedback): mola puxando pra forma-alvo (leão/texto,
 *      interpolada pelo morph) + IMPULSO do mouse quando ele PASSA perto (na
 *      direção/velocidade do movimento do cursor) + amortecimento. O retorno à
 *      forma é LENTO (câmera lenta) por causa da mola macia + damping alto.
 *   2) RENDER: desenha as partículas na posição atual com a cor fixa.
 *
 * Cor é amostrada uma vez por partícula e NUNCA troca (leão = cor do leão;
 * textos = só azul/cyan).
 */

export interface GLParticlesProps {
  getMorph: () => number;
  shapes: ShapeDef[];
  count: number;
  className?: string;
}

export interface ShapeDef {
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  kind: "lion" | "text";
}

// ── SIMULAÇÃO (transform feedback): atualiza pos+vel ──
const SIM_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;     // posição atual
layout(location=1) in vec2 aVel;     // velocidade atual
layout(location=2) in vec2 aHomeA;   // alvo forma A
layout(location=3) in vec2 aHomeB;   // alvo forma B
layout(location=4) in float aSeed;

uniform float uFrac;     // entre forma A e B
uniform float uBurst;    // explosão da transição
uniform float uTime;
uniform float uDt;
uniform vec2  uMouse;     // px
uniform vec2  uMouseVel;  // velocidade do mouse (px/frame)
uniform float uMouseR;
uniform vec2  uRes;

// ── "olha pro mouse" / "inclinadinha pro lado do mouse" ──
uniform vec2  uLook;     // direção suavizada do olhar, ~[-1,1]/eixo, (0,0) sem cursor
uniform vec2  uCenterA;  // centroide da forma A (px, y p/ baixo)
uniform vec2  uCenterB;  // centroide da forma B (px, y p/ baixo)
uniform float uModeA;    // 0=leão 1=texto (forma A)
uniform float uModeB;    // 0=leão 1=texto (forma B)
uniform float uRadA;     // raio RMS da forma A (px)
uniform float uRadB;     // raio RMS da forma B (px)
uniform float uLionAmp;  // teto REAL do parallax do leão (px) ~0.045*min(W,H)
uniform float uTextTilt; // ângulo máx de inclinação do texto (rad) ~0.10
uniform float uTextPar;  // parallax do texto (px) ~0.012*min(W,H)

out vec2 vPos;
out vec2 vVel;

// deslocamento somado ao ponto-alvo h de UMA forma (tudo em px, y p/ baixo).
// leão = vira a cabeça encarando o cursor (parallax por profundidade + pivô);
// texto = inclinação rígida pequena pelo eixo X + parallax sussurrado.
vec2 lookDisp(vec2 h, vec2 center, float mode, float rad){
  vec2 rel = h - center;
  float r  = clamp(length(rel) / max(rad, 1.0), 0.0, 1.4);
  float rr = r / 1.4;                       // 0..1

  // ── LEÃO: a cabeça VIRA pro cursor (pivô); pontas lideram o fundo ──
  // depth normalizado pra PICO 1.0 => uLionAmp é o teto real.
  float depth = rr * (0.5 + 0.5 * rr);      // 0..1, pontas ~3x o meio
  vec2  lionT = uLook * uLionAmp * depth;   // translação limitada (parallax)
  // cisalhamento rotacional = o que faz ENCARAR (pivô, não deslizar reto):
  vec2  perp  = vec2(uLook.x * rel.y, -uLook.x * rel.x) / max(rad, 1.0);
  vec2  lionD = lionT + perp * uLionAmp * 0.55 * rr;

  // ── TEXTO: inclinação rígida (tilt) + VIRAR 3D (parallax por profundidade) ──
  // 1) tilt: rotação rígida do bloco pelo uLook.x (a palavra tomba pro lado).
  float ang = uLook.x * uTextTilt;
  float s = sin(ang), c = cos(ang);
  vec2  rot = vec2(c*rel.x - s*rel.y, s*rel.x + c*rel.y);
  vec2  tilt = rot - rel;
  // 2) virar 3D: igual ao leão — frente (longe do centro) desloca mais que o
  //    fundo na direção do mouse + shear de pivô = a palavra ENCARA o cursor.
  vec2  txtT = uLook * uTextPar * depth;                 // translação por profundidade
  vec2  txtShear = perp * uTextPar * 0.6 * rr;           // pivô (mesmo perp do leão)
  vec2  textD = tilt + txtT + txtShear;

  return mix(lionD, textD, mode);
}

void main(){
  // alvo de descanso de cada forma JÁ deslocado pelo "olhar" (no espaço de cada
  // forma), depois interpolado pelo morph — a mola macia desliza suave até ele.
  vec2 homeA = aHomeA + lookDisp(aHomeA, uCenterA, uModeA, uRadA);
  vec2 homeB = aHomeB + lookDisp(aHomeB, uCenterB, uModeB, uRadB);
  vec2 home  = mix(homeA, homeB, uFrac);

  // explosão radial na transição (some quando a palavra está montada)
  float ang = aSeed*6.2831 + uTime*0.4;
  home += vec2(cos(ang),sin(ang)) * uBurst * (50.0 + aSeed*260.0);
  // micro-turbulência idle
  home += vec2(sin(uTime*0.7+aSeed*12.0), cos(uTime*0.6+aSeed*12.0)) * 1.2;

  vec2 pos = aPos;
  vec2 vel = aVel;

  // MOLA macia puxando pra home (retorno LENTO = câmera lenta)
  vec2 toHome = home - pos;
  vel += toHome * 0.012;       // rigidez baixa → volta devagar
  vel *= 0.90;                 // amortecimento (damping)

  // IMPULSO do mouse: se o cursor PASSA perto, arremessa a partícula na
  // DIREÇÃO do movimento do mouse (com a velocidade dele).
  vec2 d = pos - uMouse;
  float dist = length(d);
  if(dist < uMouseR){
    float f = 1.0 - dist/uMouseR;        // mais forte perto do cursor
    float speed = length(uMouseVel);
    // empurra na direção do movimento + um pouco radial (espalha)
    vec2 dir = speed > 0.5 ? normalize(uMouseVel) : normalize(d + 0.001);
    vel += dir * f * f * (8.0 + speed * 2.2);
    vel += normalize(d + 0.001) * f * f * 4.0; // componente radial (espalha)
  }

  pos += vel * uDt * 60.0;

  vPos = pos;
  vVel = vel;
}`;

const SIM_FRAG = `#version 300 es
precision highp float;
void main(){ discard; }`;

// ── RENDER: desenha as partículas ──
const RENDER_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec3 aColor;
layout(location=2) in float aSeed;
uniform vec2 uRes;
out vec3 vColor;
void main(){
  vec2 clip = (aPos / uRes) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = 0.7 + aSeed*1.1;   // menores = mais detalhista (antes 1.0 + 1.8)
  vColor = aColor;
}`;

const RENDER_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 frag;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if(r > 0.5) discard;
  float a = 0.9 * smoothstep(0.5, 0.1, r);
  frag = vec4(vColor * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader err");
  return sh;
}
function link(gl: WebGL2RenderingContext, vs: string, fs: string, feedback?: string[]) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  if (feedback) gl.transformFeedbackVaryings(p, feedback, gl.SEPARATE_ATTRIBS);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link err");
  return p;
}

/** Lê os tokens de cor do TEMA ativo (perfil) como RGB 0..1. */
type ThemePalette = { accent: RGB; cyan: RGB; purple: RGB; amber: RGB };
type RGB = [number, number, number];
function readTheme(): ThemePalette {
  const cs = getComputedStyle(document.documentElement);
  const hex = (v: string, fb: RGB): RGB => {
    let h = (v || "").trim().replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6) return fb;
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  return {
    accent: hex(cs.getPropertyValue("--accent"), [1, 0.17, 0.84]),
    cyan: hex(cs.getPropertyValue("--cyan"), [0, 0.9, 1]),
    purple: hex(cs.getPropertyValue("--purple"), [0.69, 0.29, 1]),
    amber: hex(cs.getPropertyValue("--amber"), [1, 0.72, 0]),
  };
}

export function GLParticles({ getMorph, shapes, count, className }: GLParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999, vx: 0, vy: 0, px: -9999, py: -9999 });
  const lookSmooth = useRef({ x: 0, y: 0 }); // direção do "olhar" suavizada (glide)

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) { console.warn("[gl] sem WebGL2"); return; }

    const DPR = Math.min(1.5, window.devicePixelRatio || 1);
    let W = 0, H = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = Math.floor(W * DPR);
      canvas.height = Math.floor(H * DPR);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();

    // ── amostra cada FORMA (x,y px + cor) ──
    const sampleShape = (def: ShapeDef, theme: ThemePalette): { xy: Float32Array; col: Float32Array } => {
      const SW = 1024, SH = Math.round(1024 * (H / W) || 1024);
      const off = document.createElement("canvas");
      off.width = SW; off.height = SH;
      const oc = off.getContext("2d")!;
      oc.clearRect(0, 0, SW, SH);
      def.draw(oc, SW, SH);
      const data = oc.getImageData(0, 0, SW, SH).data;
      const filled: number[] = [];
      for (let i = 3; i < data.length; i += 4) if (data[i] > 70) filled.push((i - 3) / 4);
      const xy = new Float32Array(count * 2);
      const col = new Float32Array(count * 3);
      // texto: paleta do tema (accent/cyan/purple) variando por partícula
      const textPal: RGB[] = [theme.accent, theme.cyan, theme.purple, mixRGB(theme.accent, theme.cyan, 0.5)];
      for (let p = 0; p < count; p++) {
        if (filled.length === 0) { xy[p * 2] = W / 2; xy[p * 2 + 1] = H / 2; continue; }
        const idx = filled[(Math.random() * filled.length) | 0];
        const px = idx % SW, py = (idx / SW) | 0;
        xy[p * 2] = (px / SW) * W;
        xy[p * 2 + 1] = (py / SH) * H;
        const di = idx * 4;
        if (def.kind === "lion") {
          const c = lionColor(data[di], data[di + 1], data[di + 2], theme);
          col[p * 3] = c[0]; col[p * 3 + 1] = c[1]; col[p * 3 + 2] = c[2];
        } else {
          const c = textPal[((Math.imul(p, 2654435761) >>> 0) % textPal.length)];
          col[p * 3] = c[0]; col[p * 3 + 1] = c[1]; col[p * 3 + 2] = c[2];
        }
      }
      return { xy, col };
    };

    let shapeData: { xy: Float32Array; col: Float32Array }[] = [];
    // metadados por forma p/ o "olhar": centroide + tipo + raio RMS (tudo em px,
    // do MESMO xy que alimenta homeA/homeB → sem descasamento de espaço).
    let shapeMeta: { cx: number; cy: number; mode: number; rad: number }[] = [];
    const buildShapes = () => {
      const theme = readTheme();
      shapeData = shapes.map((s) => sampleShape(s, theme));
      shapeMeta = shapeData.map((sd, i) => {
        const xy = sd.xy, n = xy.length / 2;
        let sx = 0, sy = 0;
        for (let p = 0; p < n; p++) { sx += xy[p * 2]; sy += xy[p * 2 + 1]; }
        const cx = sx / n, cy = sy / n;
        let s2 = 0;
        for (let p = 0; p < n; p++) {
          const dx = xy[p * 2] - cx, dy = xy[p * 2 + 1] - cy;
          s2 += dx * dx + dy * dy;
        }
        const rad = Math.sqrt(s2 / n) || Math.min(W, H) * 0.25; // raio RMS, px
        return { cx, cy, mode: shapes[i].kind === "text" ? 1 : 0, rad };
      });
    };

    // ── programas ──
    let simProg: WebGLProgram, renderProg: WebGLProgram;
    try {
      simProg = link(gl, SIM_VERT, SIM_FRAG, ["vPos", "vVel"]);
      renderProg = link(gl, RENDER_VERT, RENDER_FRAG);
    } catch (e) { console.warn("[gl]", e); return; }

    // ── buffers (ping-pong de pos/vel) ──
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) seed[i] = Math.random();
    const seedBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf); gl.bufferData(gl.ARRAY_BUFFER, seed, gl.STATIC_DRAW);

    const homeA = gl.createBuffer()!, homeB = gl.createBuffer()!, colBuf = gl.createBuffer()!;
    // ping-pong pos+vel
    const mk = () => { const b = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, count * 2 * 4, gl.DYNAMIC_COPY); return b; };
    let posA = mk(), velA = mk(), posB = mk(), velB = mk();

    const initState = () => {
      // posições iniciais = forma 0 (leão); vel = 0
      const xy = shapeData[0].xy;
      gl.bindBuffer(gl.ARRAY_BUFFER, posA); gl.bufferData(gl.ARRAY_BUFFER, xy, gl.DYNAMIC_COPY);
      gl.bindBuffer(gl.ARRAY_BUFFER, velA); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(count * 2), gl.DYNAMIC_COPY);
    };

    let curA = -1, curB = -1;
    const setHome = (ia: number, ib: number) => {
      if (ia === curA && ib === curB) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, homeA); gl.bufferData(gl.ARRAY_BUFFER, shapeData[ia].xy, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, homeB); gl.bufferData(gl.ARRAY_BUFFER, shapeData[ib].xy, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, colBuf); gl.bufferData(gl.ARRAY_BUFFER, shapeData[ia].col, gl.DYNAMIC_DRAW);
      // centroide/tipo/raio das formas atuais p/ o "olhar". setHome roda ANTES do
      // useProgram(simProg) do frame, então amarra o simProg aqui senão esses
      // uniforms iriam pro renderProg (silenciosamente errado).
      gl.useProgram(simProg);
      gl.uniform2f(su.centerA, shapeMeta[ia].cx, shapeMeta[ia].cy);
      gl.uniform2f(su.centerB, shapeMeta[ib].cx, shapeMeta[ib].cy);
      gl.uniform1f(su.modeA, shapeMeta[ia].mode);
      gl.uniform1f(su.modeB, shapeMeta[ib].mode);
      gl.uniform1f(su.radA, shapeMeta[ia].rad);
      gl.uniform1f(su.radB, shapeMeta[ib].rad);
      curA = ia; curB = ib;
    };

    // uniforms
    const su = {
      frac: gl.getUniformLocation(simProg, "uFrac"), burst: gl.getUniformLocation(simProg, "uBurst"),
      time: gl.getUniformLocation(simProg, "uTime"), dt: gl.getUniformLocation(simProg, "uDt"),
      mouse: gl.getUniformLocation(simProg, "uMouse"), mvel: gl.getUniformLocation(simProg, "uMouseVel"),
      mr: gl.getUniformLocation(simProg, "uMouseR"), res: gl.getUniformLocation(simProg, "uRes"),
      look: gl.getUniformLocation(simProg, "uLook"),
      centerA: gl.getUniformLocation(simProg, "uCenterA"),
      centerB: gl.getUniformLocation(simProg, "uCenterB"),
      modeA: gl.getUniformLocation(simProg, "uModeA"),
      modeB: gl.getUniformLocation(simProg, "uModeB"),
      radA: gl.getUniformLocation(simProg, "uRadA"),
      radB: gl.getUniformLocation(simProg, "uRadB"),
      lionAmp: gl.getUniformLocation(simProg, "uLionAmp"),
      textTilt: gl.getUniformLocation(simProg, "uTextTilt"),
      textPar: gl.getUniformLocation(simProg, "uTextPar"),
    };
    const ru = { res: gl.getUniformLocation(renderProg, "uRes") };

    const tf = gl.createTransformFeedback()!;

    let ready = false;
    const start = () => { buildShapes(); initState(); ready = true; };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
    else start();

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let raf = 0; let last = performance.now(); const t0 = last;
    const frame = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = (now - t0) / 1000;
      gl.clear(gl.COLOR_BUFFER_BIT);

      // ── "olhar" suavizado em direção ao mouse (glide ~0.2s; sem cursor → (0,0)) ──
      {
        const m = mouse.current;
        let tx = 0, ty = 0;
        if (m.x > -9000) {
          const mm = Math.min(W, H) || 1;
          // sinal NEGATIVO: pra ENCARAR o cursor, as partículas da frente vão na
          // direção do mouse (o lado oposto da cabeça recua) → vira "pro" mouse.
          tx = -((m.x - W / 2) / (mm * 0.5)) * 1.15;
          ty = -((m.y - H / 2) / (mm * 0.5)) * 1.15;
          tx = Math.max(-1, Math.min(1, tx));
          ty = Math.max(-1, Math.min(1, ty));
        }
        const k = 0.08; // sem cursor, decai suave até (0,0) — sem pop
        lookSmooth.current.x += (tx - lookSmooth.current.x) * k;
        lookSmooth.current.y += (ty - lookSmooth.current.y) * k;
      }

      if (ready && shapeData.length) {
        const morph = Math.max(0, Math.min(shapes.length - 1.0001, getMorph()));
        const ia = Math.floor(morph), ib = Math.min(shapes.length - 1, ia + 1);
        setHome(ia, ib);

        // ── 1) SIMULAÇÃO (transform feedback) ──
        gl.useProgram(simProg);
        gl.uniform1f(su.frac, morph - ia);
        gl.uniform1f(su.burst, Math.sin((morph - ia) * Math.PI));
        gl.uniform1f(su.time, t);
        gl.uniform1f(su.dt, dt);
        gl.uniform2f(su.mouse, mouse.current.x, mouse.current.y);
        gl.uniform2f(su.mvel, mouse.current.vx, mouse.current.vy);
        gl.uniform1f(su.mr, Math.min(W, H) * 0.14);
        gl.uniform2f(su.res, W, H);
        // "olhar"/inclinação (teto real porque depth tem pico 1.0)
        const mm = Math.min(W, H);
        gl.uniform2f(su.look, lookSmooth.current.x, lookSmooth.current.y);
        gl.uniform1f(su.lionAmp, mm * 0.045);
        gl.uniform1f(su.textTilt, 0.10);    // tilt rígido do bloco
        gl.uniform1f(su.textPar, mm * 0.03); // "virar" 3D do texto (profundidade + pivô)

        // entradas: posA, velA, homeA, homeB, seed
        bindAttr(gl, 0, posA, 2); bindAttr(gl, 1, velA, 2);
        bindAttr(gl, 2, homeA, 2); bindAttr(gl, 3, homeB, 2);
        bindAttr(gl, 4, seedBuf, 1);
        // saídas: posB, velB
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, posB);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, velB);
        gl.enable(gl.RASTERIZER_DISCARD);
        gl.beginTransformFeedback(gl.POINTS);
        gl.drawArrays(gl.POINTS, 0, count);
        gl.endTransformFeedback();
        gl.disable(gl.RASTERIZER_DISCARD);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, null);

        // ── 2) RENDER (das saídas posB) ──
        gl.useProgram(renderProg);
        gl.uniform2f(ru.res, W, H);
        bindAttr(gl, 0, posB, 2); bindAttr(gl, 1, colBuf, 3); bindAttr(gl, 2, seedBuf, 1);
        gl.drawArrays(gl.POINTS, 0, count);

        // swap ping-pong
        [posA, posB] = [posB, posA];
        [velA, velB] = [velB, velA];
      }

      // decai a velocidade do mouse (se parou de mexer, para de arremessar)
      mouse.current.vx *= 0.85; mouse.current.vy *= 0.85;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const m = mouse.current;
      if (m.px > -9000) { m.vx = x - m.px; m.vy = y - m.py; }
      m.px = x; m.py = y; m.x = x; m.y = y;
    };
    // "sem mouse na tela" → zera tudo; o frame faz o leão voltar a olhar pra frente.
    const clearMouse = () => {
      const m = mouse.current;
      m.x = -9999; m.y = -9999; m.px = -9999; m.py = -9999; m.vx = 0; m.vy = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    // cobre ponteiro saindo da janela/aba, perda de foco e troca de aba:
    canvas.addEventListener("pointerleave", clearMouse);
    document.addEventListener("pointerleave", clearMouse);   // ponteiro sai do documento
    window.addEventListener("blur", clearMouse);             // janela perde foco
    const onVis = () => { if (document.hidden) clearMouse(); };
    document.addEventListener("visibilitychange", onVis);
    const onResize = () => { resize(); buildShapes(); initState(); curA = curB = -1; };
    window.addEventListener("resize", onResize, { passive: true });

    // TEMA: quando o usuário troca o tema no perfil (data-theme/style em <html>),
    // re-amostra as cores das partículas com a paleta nova (mantém as posições).
    let themeRaf = 0;
    const onTheme = () => {
      cancelAnimationFrame(themeRaf);
      themeRaf = requestAnimationFrame(() => { buildShapes(); curA = curB = -1; });
    };
    const themeObs = new MutationObserver(onTheme);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });

    return () => {
      themeObs.disconnect();
      cancelAnimationFrame(themeRaf);
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", clearMouse);
      document.removeEventListener("pointerleave", clearMouse);
      window.removeEventListener("blur", clearMouse);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
    };
  }, [getMorph, shapes, count]);

  return <canvas ref={canvasRef} className={className} style={{ width: "100%", height: "100%", display: "block" }} />;
}

function bindAttr(gl: WebGL2RenderingContext, loc: number, buf: WebGLBuffer, size: number) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

function mixRGB(a: RGB, c: RGB, t: number): RGB {
  return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
}
function scaleRGB(c: RGB, k: number): RGB {
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}

/**
 * Cor de cada partícula do leão SEGUINDO O TEMA do perfil. Detecta a REGIÃO
 * pelo tom amostrado (dourado/teal/roxo/azul) e mapeia pro token correspondente
 * do tema (amber/cyan/purple/accent), com variação por luminância pra dar
 * profundidade. Trocou o tema → as cores trocam junto.
 */
function lionColor(r: number, g: number, b: number, th: ThemePalette): RGB {
  const max = Math.max(r, g, b);
  const lum = (r + g + b) / 765; // 0..1
  const shade = (c: RGB) => scaleRGB(mixRGB(scaleRGB(c, 0.55), c, lum), 0.85 + lum * 0.4);

  // DOURADO (pontas da juba/óculos) → token AMBER do tema
  if (r > 115 && g > 85 && b < 120 && r >= b) return shade(th.amber);
  // TEAL/TURQUESA (cara/focinho) → token CYAN do tema
  if (g > 110 && b > 110 && Math.abs(g - b) < 90 && r < g) return shade(th.cyan);
  // ROXO (juba) → token PURPLE do tema
  if (r > 70 && b > 110 && g < b - 10) return shade(th.purple);
  // AZUL ELÉTRICO (resto) → mistura accent+cyan do tema
  if (b >= max - 10) return shade(mixRGB(th.accent, th.cyan, 0.5));
  // highlights claros → cyan claro do tema
  if (g > r && b > r) return shade(scaleRGB(th.cyan, 1.2));
  // fallback → accent do tema
  return shade(th.accent);
}
