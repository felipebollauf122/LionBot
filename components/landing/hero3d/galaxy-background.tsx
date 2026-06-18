"use client";

import { useEffect, useRef } from "react";

/**
 * FUNDO DE GALÁXIA (WebGL2) — camada mais ao fundo, atrás do leão em partículas.
 * Full-screen fragment shader: campo de estrelas DENSO em camadas de profundidade
 * (estrelas pequeníssimas e nítidas, com cintilação), nebulosa fluida (fbm com
 * domain-warp), faixa de poeira cósmica, parallax pelo mouse e vinheta pra o leão
 * se destacar no centro. As cores seguem o TEMA do perfil (--accent/--cyan/--purple)
 * e recolorem ao trocar o tema. Saída opaca (camada de fundo).
 */

type RGB = [number, number, number];

function hexToRgb01(v: string, fb: RGB): RGB {
  let h = (v || "").trim();
  if (h.startsWith("rgb")) {
    const m = h.match(/[\d.]+/g);
    if (m && m.length >= 3) return [(+m[0]) / 255, (+m[1]) / 255, (+m[2]) / 255];
    return fb;
  }
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return fb;
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  return {
    accent: hexToRgb01(cs.getPropertyValue("--accent"), [1, 0.17, 0.84]),
    cyan: hexToRgb01(cs.getPropertyValue("--cyan"), [0, 0.9, 1]),
    purple: hexToRgb01(cs.getPropertyValue("--purple"), [0.69, 0.29, 1]),
  };
}

const VERT = `#version 300 es
// Triângulo full-screen — sem atributos/buffers. gl.drawArrays(TRIANGLES,0,3)
void main() {
  vec2 p = vec2(
    float((gl_VertexID << 1) & 2),  // 0, 2, 0
    float(gl_VertexID & 2)          // 0, 0, 2
  );
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

out vec4 frag;

uniform float uTime;   // segundos
uniform vec2  uRes;    // px (backing store)
uniform vec2  uMouse;  // -1..1 do centro, (0,0) sem cursor
uniform vec3  uAccent; // tema magenta (0..1)
uniform vec3  uCyan;   // tema cyan    (0..1)
uniform vec3  uPurple; // tema purple  (0..1)
uniform float uNebula; // 0..1 intensidade da nebulosa/poeira/aura (estrelas ficam)
uniform float uStars;  // 0..1 intensidade do brilho das estrelas

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i + vec2(0.0, 0.0));
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.55;
  float freq = 1.0;
  for (int i = 0; i < 5; i++) {
    v += amp * vnoise(p * freq);
    p = ROT * p + 11.3;
    freq *= 2.0;
    amp *= 0.5;
  }
  return v;
}

// camada de estrelas: grade de células hasheadas; estrelas minúsculas e nítidas
// (tamanho pequeno + expoente de falloff alto). Vizinhança 3x3 evita corte na borda.
vec3 starLayer(vec2 uv, float density, float baseSize, float falloffPow,
               float brightness, float twinkleAmt, float seed, vec3 tintA, vec3 tintB) {
  vec2 gv = uv * density;
  vec2 cell = floor(gv);
  vec2 fpos = fract(gv);
  vec3 col = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offs = vec2(float(x), float(y));
      vec2 cid = cell + offs + seed;
      float occ = hash21(cid * 1.7);
      if (occ < 0.45) continue;
      vec2 jit = hash22(cid) * 0.8 + 0.1;
      vec2 starPos = offs + jit;
      float d = length(fpos - starPos);
      float r1 = hash21(cid * 3.1);
      float r2 = hash21(cid * 5.7);
      float r3 = hash21(cid * 9.2);
      float size = baseSize * (0.55 + 0.9 * r1 * r1);
      // falloff descendente bem-definido (edge0 < edge1), depois afiado por pow
      float core = 1.0 - smoothstep(0.0, size, d);
      core = pow(core, falloffPow);
      float rate = 1.5 + 5.5 * r2;
      float phase = r3 * 6.2831853;
      float tw = 0.5 + 0.5 * sin(uTime * rate + phase);
      float bri = brightness * (0.35 + 0.85 * r2);
      bri *= mix(1.0, tw, twinkleAmt);
      vec3 tint = mix(tintA, tintB, r1);
      tint = mix(vec3(1.0), tint, 0.55);
      col += core * bri * tint;
    }
  }
  return col;
}

void main() {
  vec2 res = uRes;
  vec2 uv = gl_FragCoord.xy / res;
  vec2 p  = (gl_FragCoord.xy - 0.5 * res) / res.y;
  float aspect = res.x / res.y;

  vec3 baseDeep = mix(vec3(0.012, 0.010, 0.020), uPurple * 0.10, 0.5);
  vec3 color = baseDeep;

  float edge = smoothstep(0.15, 0.95, length(p));
  // parallax NEGATIVO: camadas de perto vão ao contrário do cursor (janela 3D)
  vec2 par = -uMouse * 0.035;

  // ── NEBULOSA — fbm com domain-warp, deriva lenta, cor do tema, forte nas bordas ──
  vec2 np = p * 1.35;
  np += par * 0.6;
  float t = uTime * 0.015;
  vec2 q = vec2(
    fbm(np + vec2(0.0, 0.0) + t),
    fbm(np + vec2(5.2, 1.3) - t)
  );
  vec2 r = vec2(
    fbm(np + 1.8 * q + vec2(1.7, 9.2) + 0.10 * uTime * 0.15),
    fbm(np + 1.8 * q + vec2(8.3, 2.8) - 0.13 * uTime * 0.15)
  );
  float neb = fbm(np + 2.2 * r);
  neb = smoothstep(0.30, 0.95, neb);
  float detail = fbm(np * 3.0 + r * 2.0 - t * 2.0);
  neb = neb * (0.7 + 0.5 * detail);
  float ramp = clamp(r.x * 0.5 + 0.5 * q.y, 0.0, 1.0);
  vec3 nebCol = mix(uPurple, uAccent, smoothstep(0.0, 0.6, ramp));
  nebCol = mix(nebCol, uCyan, smoothstep(0.55, 1.0, ramp));
  float nebMask = neb * mix(0.18, 1.0, edge);
  color += nebCol * nebMask * 0.9 * uNebula;
  color += mix(uPurple, uAccent, uv.x) * pow(edge, 2.0) * 0.06 * uNebula;

  // ── POEIRA CÓSMICA — faixa diagonal tipo via-láctea ──
  float ang = -0.5;
  vec2 dir = vec2(cos(ang), sin(ang));
  float along = dot(p, vec2(-dir.y, dir.x));
  float band = exp(-along * along * 7.0);
  float bandNoise = fbm(p * 2.2 + vec2(uTime * 0.02, 0.0));
  band *= 0.55 + 0.75 * bandNoise;
  vec3 dustCol = mix(uPurple, uCyan, 0.4 + 0.3 * bandNoise);
  color += dustCol * band * mix(0.10, 0.35, edge) * uNebula;
  vec3 bandStars = starLayer(p, 280.0, 0.40, 8.0, 0.5 * band, 0.7, 71.0, uCyan, uAccent);
  color += bandStars * uStars;

  // ── CAMPO DE ESTRELAS — camadas de profundidade, todas minúsculas e nítidas ──
  { vec2 luv = p + par * 0.15; color += starLayer(luv, 230.0, 0.42, 9.0, 0.55, 0.55, 13.0, uCyan, uPurple) * uStars; }
  { vec2 luv = p + par * 0.45; color += starLayer(luv, 150.0, 0.40, 8.0, 0.85, 0.70, 41.0, uAccent, uCyan) * uStars; }
  { vec2 luv = p + par * 1.0;  color += starLayer(luv, 90.0, 0.32, 7.0, 1.25, 0.85, 97.0, uCyan, uAccent) * uStars; }
  { vec2 luv = p + par * 1.6;  color += starLayer(luv, 46.0, 0.24, 6.0, 1.70, 1.00, 151.0, uAccent, uCyan) * uStars; }

  // ── VINHETA + centro calmo — o leão (centro) se destaca e fica legível ──
  float vig = smoothstep(1.35, 0.35, length(p * vec2(aspect * 0.55 + 0.45, 1.0)));
  color *= mix(0.55, 1.0, vig);
  float centerCalm = smoothstep(0.0, 0.45, length(p));
  color *= mix(0.78, 1.0, centerCalm);

  // ── TONE-MAP + DITHER ──
  color = color / (color + vec3(0.85));
  color = pow(color, vec3(0.85));
  float dither = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  color += dither;
  color = clamp(color, 0.0, 1.0);
  frag = vec4(color, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[galaxy] shader:", gl.getShaderInfoLog(sh));
    throw new Error("shader err");
  }
  return sh;
}

export function GalaxyBackground({
  className,
  nebula = 1,
  stars = 1,
  parallax = true,
}: {
  className?: string;
  /** intensidade da nebulosa/poeira/aura (0..1). dashboard usa baixo. */
  nebula?: number;
  /** intensidade do brilho das estrelas (0..1). */
  stars?: number;
  /** habilita o parallax pelo mouse (desliga na dashboard p/ ficar quieto). */
  parallax?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ tx: 0, ty: 0, x: 0, y: 0 }); // alvo + suavizado
  const cfg = useRef({ nebula, stars, parallax });
  useEffect(() => { cfg.current = { nebula, stars, parallax }; }, [nebula, stars, parallax]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, powerPreference: "high-performance",
    });
    if (!gl) { console.warn("[galaxy] sem WebGL2"); return; }

    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn("[galaxy] link:", gl.getProgramInfoLog(prog));
        return;
      }
    } catch { return; }
    gl.useProgram(prog);

    // WebGL2 exige um VAO ligado p/ drawArrays em alguns drivers
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const u = {
      time: gl.getUniformLocation(prog, "uTime"),
      res: gl.getUniformLocation(prog, "uRes"),
      mouse: gl.getUniformLocation(prog, "uMouse"),
      accent: gl.getUniformLocation(prog, "uAccent"),
      cyan: gl.getUniformLocation(prog, "uCyan"),
      purple: gl.getUniformLocation(prog, "uPurple"),
      nebula: gl.getUniformLocation(prog, "uNebula"),
      stars: gl.getUniformLocation(prog, "uStars"),
    };

    let theme = readTheme();
    const themeObs = new MutationObserver(() => { theme = readTheme(); });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });

    const DPR = Math.min(1.5, window.devicePixelRatio || 1);
    let W = 1, H = 1;
    const resize = () => {
      // mede pelo PAI (absolute inset-0, altura garantida); cai p/ a janela se
      // o canvas ainda colapsou no 1º layout — assim nunca renderiza 1x1 (branco).
      const host = canvas.parentElement;
      const rect = host ? host.getBoundingClientRect() : canvas.getBoundingClientRect();
      const cw = rect.width || window.innerWidth;
      const ch = rect.height || window.innerHeight;
      W = Math.max(1, Math.floor(cw * DPR));
      H = Math.max(1, Math.floor(ch * DPR));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W; canvas.height = H;
        gl.viewport(0, 0, W, H);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener("resize", resize, { passive: true });

    const onMove = (e: PointerEvent) => {
      mouse.current.tx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.current.ty = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    const onLeave = () => { mouse.current.tx = 0; mouse.current.ty = 0; };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);

    const start = performance.now();
    let raf = 0, running = false;
    let onScreen = true, tabVisible = true;
    const render = (now: number) => {
      const t = (now - start) / 1000;
      const m = mouse.current;
      const c = cfg.current;
      m.x += (m.tx - m.x) * 0.06; m.y += (m.ty - m.y) * 0.06; // parallax suave
      gl.useProgram(prog);
      gl.uniform1f(u.time, t);
      gl.uniform2f(u.res, W, H);
      gl.uniform2f(u.mouse, c.parallax ? m.x : 0, c.parallax ? m.y : 0);
      gl.uniform3f(u.accent, theme.accent[0], theme.accent[1], theme.accent[2]);
      gl.uniform3f(u.cyan, theme.cyan[0], theme.cyan[1], theme.cyan[2]);
      gl.uniform3f(u.purple, theme.purple[0], theme.purple[1], theme.purple[2]);
      gl.uniform1f(u.nebula, c.nebula);
      gl.uniform1f(u.stars, c.stars);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const frame = (now: number) => { render(now); raf = requestAnimationFrame(frame); };
    const sync = () => {
      const should = onScreen && tabVisible;
      if (should && !running) { running = true; raf = requestAnimationFrame(frame); }
      else if (!should && running) { running = false; cancelAnimationFrame(raf); }
    };
    // pinta JÁ um frame (não espera rAF nem observers) → nunca fica branco
    render(start);
    // pausa quando aba escondida ou seção fora de vista (economia de GPU).
    // observa o PAI (tem altura garantida); o canvas pode colapsar no 1º layout.
    const onVis = () => { tabVisible = !document.hidden; sync(); };
    document.addEventListener("visibilitychange", onVis);
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }, { threshold: 0 });
    io.observe(canvas.parentElement || canvas);
    sync();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      themeObs.disconnect();
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("visibilitychange", onVis);
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  // fallback CSS (gradiente de galáxia escuro com as cores do tema) pintado
  // ATRÁS do canvas — se o WebGL falhar/atrasar, NUNCA fica branco.
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        background:
          "radial-gradient(120% 120% at 20% 10%, color-mix(in srgb, var(--purple) 28%, transparent), transparent 55%)," +
          "radial-gradient(120% 120% at 85% 90%, color-mix(in srgb, var(--accent) 24%, transparent), transparent 55%)," +
          "radial-gradient(100% 100% at 60% 40%, color-mix(in srgb, var(--cyan) 12%, transparent), transparent 60%)," +
          "var(--bg-root)",
      }}
    />
  );
}
