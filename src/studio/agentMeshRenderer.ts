import { vertexSource } from "../components/atmosphere/shaders";

import type { AgentIdentity } from "./agentIdentity";
import type { AgentStatus } from "./types";

/**
 * The Studio shares the Journey field's domain-warped noise language, but not its page-sized
 * atmosphere. This shader is the moving mesh layer only; CSS supplies the perfectly circular
 * dark base underneath it. Keeping those layers separate preserves a clean silhouette while
 * allowing the internal field to move without moving the agent itself.
 */
const agentFragmentSource = `#version 300 es
  precision highp float;

  in vec2 v_uv;
  out vec4 outColor;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_seed;
  uniform vec3 u_deep;
  uniform vec3 u_current_a;
  uniform vec3 u_current_b;
  uniform vec3 u_bloom;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 turn = mat2(0.80, -0.60, 0.60, 0.80);
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p = turn * p * 2.03 + 17.17;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 uv = v_uv;
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 seedOffset = vec2(fract(u_seed * 0.013), fract(u_seed * 0.021)) * 8.0;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 1.55 + seedOffset;
    float time = u_time * 0.046;

    vec2 q = vec2(
      fbm(p + vec2(0.0, time)),
      fbm(p + vec2(4.7, 1.9) - vec2(time * 0.72, time * 0.36))
    );
    vec2 r = vec2(
      fbm(p + 2.15 * q + vec2(1.8, 7.4) + time * 0.42),
      fbm(p + 2.35 * q + vec2(8.3, 2.8) - time * 0.31)
    );
    float field = fbm(p + 2.8 * r);

    float body = smoothstep(0.14, 0.86, field);
    vec3 color = mix(u_current_a, u_current_b, smoothstep(0.28, 0.88, q.y));
    color = mix(color, u_bloom, smoothstep(0.66, 0.95, r.x + field * 0.14) * 0.44);
    color = mix(color, u_deep, smoothstep(0.64, 0.96, r.y + q.x * 0.20) * 0.38);

    // A fixed material light gives the mesh volume without turning activity into a pulse.
    // The field moves while thinking; the light and the circular silhouette do not.
    vec2 spherePoint = uv * 2.0 - 1.0;
    float sphereZ = sqrt(max(0.0, 1.0 - dot(spherePoint, spherePoint)));
    vec3 normal = normalize(vec3(spherePoint, sphereZ));
    vec3 light = normalize(vec3(-0.62, 0.68, 0.76));
    vec3 view = vec3(0.0, 0.0, 1.0);
    vec3 halfway = normalize(light + view);
    float diffuse = max(dot(normal, light), 0.0);
    float specular = pow(max(dot(normal, halfway), 0.0), 5.5);
    float refraction = smoothstep(0.36, 1.0, 1.0 - sphereZ);

    color *= 0.70 + diffuse * 0.52;
    color = mix(color, u_bloom, specular * 0.48);
    color = mix(color, u_deep * 0.68, refraction * 0.34);

    float grain = hash(gl_FragCoord.xy + u_seed) - 0.5;
    color += grain * 0.032;

    float alpha = 0.62 + body * 0.28 + smoothstep(0.68, 0.94, r.x) * 0.08;
    outColor = vec4(color, alpha);
  }
`;

const THINKING_STATUSES = new Set<AgentStatus>(["spawning", "working", "reporting"]);

export function isAgentThinking(status: AgentStatus): boolean {
  return THINKING_STATUSES.has(status);
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function rgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function motionRate(status: AgentStatus): number {
  if (status === "spawning") return 1.18;
  if (status === "reporting") return 0.58;
  return 0.86;
}

/** Mount one compact field. Idle marks draw once; thinking marks redraw at a restrained 24fps. */
export function mountAgentMesh(
  canvas: HTMLCanvasElement,
  identity: AgentIdentity,
  status: AgentStatus,
): () => void {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    powerPreference: "low-power",
  });
  if (!gl) {
    canvas.dataset.meshReady = "fallback";
    return () => undefined;
  }

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, agentFragmentSource);
  if (!vertexShader || !fragmentShader) {
    canvas.dataset.meshReady = "fallback";
    return () => undefined;
  }

  const program = gl.createProgram();
  if (!program) return () => undefined;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    canvas.dataset.meshReady = "fallback";
    return () => undefined;
  }

  const buffer = gl.createBuffer();
  if (!buffer) return () => undefined;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  gl.useProgram(program);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resolution = gl.getUniformLocation(program, "u_resolution");
  const time = gl.getUniformLocation(program, "u_time");
  const seed = gl.getUniformLocation(program, "u_seed");
  const deep = gl.getUniformLocation(program, "u_deep");
  const currentA = gl.getUniformLocation(program, "u_current_a");
  const currentB = gl.getUniformLocation(program, "u_current_b");
  const bloom = gl.getUniformLocation(program, "u_bloom");

  gl.uniform1f(seed, identity.seed % 10000);
  gl.uniform3fv(deep, rgb(identity.palette.deep));
  gl.uniform3fv(currentA, rgb(identity.palette.currentA));
  gl.uniform3fv(currentB, rgb(identity.palette.currentB));
  gl.uniform3fv(bloom, rgb(identity.palette.bloom));

  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const staticTime = (identity.seed % 997) / 83;
  const active = isAgentThinking(status);
  const rate = motionRate(status);
  let reducedMotion = media.matches;
  let animationFrame = 0;
  let lastFrame = 0;
  let startedAt = 0;
  let disposed = false;

  const syncMotionState = () => {
    canvas.dataset.meshMotion = active && !reducedMotion ? "running" : "still";
  };

  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  };

  const draw = (elapsed = 0) => {
    resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(resolution, canvas.width, canvas.height);
    gl.uniform1f(time, staticTime + elapsed * rate);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    canvas.dataset.meshReady = "true";
  };

  const tick = (timestamp: number) => {
    if (disposed || !canvas.isConnected || !active || reducedMotion) return;
    if (!startedAt) startedAt = timestamp;
    if (timestamp - lastFrame >= 42) {
      draw((timestamp - startedAt) / 1000);
      lastFrame = timestamp;
    }
    animationFrame = window.requestAnimationFrame(tick);
  };

  const updateMotionPreference = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches;
    syncMotionState();
    window.cancelAnimationFrame(animationFrame);
    startedAt = 0;
    draw();
    if (active && !reducedMotion) animationFrame = window.requestAnimationFrame(tick);
  };

  const resizeObserver = new ResizeObserver(() => draw());
  resizeObserver.observe(canvas);
  media.addEventListener("change", updateMotionPreference);
  syncMotionState();
  draw();
  if (active && !reducedMotion) animationFrame = window.requestAnimationFrame(tick);

  return () => {
    disposed = true;
    window.cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    media.removeEventListener("change", updateMotionPreference);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  };
}
