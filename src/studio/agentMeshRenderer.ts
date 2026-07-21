import { vertexSource } from "../components/atmosphere/shaders";

import type { AgentIdentity } from "./agentIdentity";
import type { AgentStatus } from "./types";

/**
 * One complete agent material. Role topology establishes the large composition; low-frequency
 * noise only bends it. Lighting, transmission, caustic and grain are resolved in this pass so a
 * WebGL identity never becomes a translucent blend of unrelated procedural layers.
 */
const agentFragmentSource = `#version 300 es
  precision highp float;

  in vec2 v_uv;
  out vec4 outColor;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_seed;
  uniform float u_previous_topology_kind;
  uniform float u_topology_kind;
  uniform float u_identity_mix;
  uniform float u_angle;
  uniform float u_scale;
  uniform float u_band_width;
  uniform float u_warp;
  uniform vec2 u_phase;
  uniform vec2 u_caustic_point;
  uniform float u_drift_seconds;
  uniform float u_mirror;
  uniform vec3 u_absorption;
  uniform vec3 u_body;
  uniform vec3 u_current;
  uniform vec3 u_counter;
  uniform vec3 u_caustic;

  const float TAU = 6.28318530718;

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
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p = turn * p * 2.03 + 17.17;
      amplitude *= 0.5;
    }
    return value;
  }

  vec2 rotate2d(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat2(c, -s, s, c) * p;
  }

  float ribbon(float distanceFromCentre, float width) {
    return 1.0 - smoothstep(width * 0.88, width * 2.3, distanceFromCentre);
  }

  vec3 srgbToLinear(vec3 color) {
    vec3 low = color / 12.92;
    vec3 high = pow((color + 0.055) / 1.055, vec3(2.4));
    return mix(low, high, step(vec3(0.04045), color));
  }

  vec3 linearToSrgb(vec3 color) {
    color = max(color, vec3(0.0));
    vec3 low = color * 12.92;
    vec3 high = 1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055;
    return mix(low, high, step(vec3(0.0031308), color));
  }

  vec3 toneMap(vec3 color) {
    color = max(color, vec3(0.0));
    return clamp(
      (color * (2.51 * color + 0.03)) /
        (color * (2.43 * color + 0.59) + 0.14),
      0.0,
      1.0
    );
  }

  void topologyField(
    float topologyKind,
    vec2 p,
    float cycle,
    out float primary,
    out float secondary,
    out float structure
  ) {
    float width = clamp(u_band_width, 0.08, 0.46);

    if (topologyKind < 0.5) {
      // Confluence: two traveling currents narrow toward a breathing join.
      float joinEdge = 0.64 + sin(cycle * 0.46 + u_phase.y) * 0.2;
      float join = smoothstep(-0.88, joinEdge, p.x);
      float inletBreath = sin(cycle * 0.72 + u_phase.x) * 0.065;
      float upper = mix(0.46 + inletBreath, 0.025, join)
        + sin(p.x * 2.05 - cycle * 1.12 + u_phase.x) * 0.14;
      float lower = mix(-0.46 - inletBreath, -0.025, join)
        + sin(p.x * 1.88 - cycle * 0.94 + u_phase.y) * 0.13;
      primary = ribbon(abs(p.y - upper), width);
      secondary = ribbon(abs(p.y - lower), width * 0.94);
      structure = smoothstep(0.2, 0.82, join) * primary * secondary;
      return;
    }

    if (topologyKind < 1.5) {
      // Strata: broad layers slide past one another in opposite directions.
      float layerSlide = sin(cycle * 0.82 + u_phase.x) * 0.14;
      float upper = p.y + 0.25 + layerSlide
        + sin(p.x * 1.72 - cycle * 1.08 + u_phase.x) * 0.095;
      float lower = p.y - 0.27 - layerSlide * 0.82
        + sin(p.x * 1.48 + cycle * 0.88 + u_phase.y) * 0.1;
      primary = ribbon(abs(upper), width * 1.05);
      secondary = ribbon(abs(lower), width * 0.92);
      structure = ribbon(
        abs(p.y + sin(p.x * 1.16 - cycle * 0.72) * 0.07),
        width * 0.48
      );
      return;
    }

    if (topologyKind < 2.5) {
      // Basin: two nested masses orbit while the larger shoreline expands and contracts.
      vec2 centreA = vec2(-0.18 + u_phase.x * 0.12, -0.06 + u_phase.y * 0.1);
      vec2 centreB = vec2(0.34 - u_phase.y * 0.08, 0.23 + u_phase.x * 0.08);
      centreA += vec2(
        cos(cycle * 0.88 + u_phase.y),
        sin(cycle * 0.88 + u_phase.x)
      ) * 0.18;
      centreB += vec2(
        cos(-cycle * 0.7 + u_phase.x),
        sin(-cycle * 0.7 + u_phase.y)
      ) * 0.14;
      float distanceA = length((p - centreA) * vec2(0.88, 1.08));
      float distanceB = length((p - centreB) * vec2(1.12, 0.9));
      float shoreline = 0.5 + sin(cycle * 0.7 + u_phase.x) * 0.065;
      primary = 1.0 - smoothstep(0.25 + width * 0.35, 0.84 + width * 0.45, distanceA);
      secondary = 1.0 - smoothstep(0.18 + width * 0.28, 0.67 + width * 0.35, distanceB);
      structure = ribbon(abs(distanceA - shoreline), width * 0.68);
      return;
    }

    if (topologyKind < 3.5) {
      // Braid: ribbons travel in opposite directions, continually changing their crossings.
      float braidBreath = 0.23 + sin(cycle * 0.58 + u_phase.x) * 0.055;
      float waveA = sin(p.x * 2.12 + u_phase.x - cycle * 1.32) * braidBreath;
      float waveB = -sin(p.x * 2.12 + u_phase.y + cycle * 1.06) * braidBreath;
      primary = ribbon(abs(p.y - waveA), width);
      secondary = ribbon(abs(p.y - waveB), width * 0.96);
      structure = smoothstep(0.15, 0.7, primary * secondary) * 0.62;
      return;
    }

    // Interference: counter-rotating fields open and close broad lenses.
    vec2 fieldA = rotate2d(p, sin(cycle * 0.42 + u_phase.x) * 0.34);
    vec2 fieldB = rotate2d(p, -sin(cycle * 0.36 + u_phase.y) * 0.3);
    float waveA = sin(
      (fieldA.x * 0.92 + fieldA.y * 0.42) * 2.5
        + u_phase.x
        + cycle * 1.08
    );
    float waveB = sin(
      (fieldB.y * 0.9 - fieldB.x * 0.48) * 2.35
        + u_phase.y
        - cycle * 0.92
    );
    primary = smoothstep(-0.28, 0.62, waveA);
    secondary = smoothstep(-0.24, 0.66, waveB);
    structure = smoothstep(0.34, 0.82, primary * secondary);
  }

  float topologyFlowSignal(float topologyKind, vec2 p, float cycle) {
    if (topologyKind < 0.5) {
      return sin(p.x * 2.0 - cycle * 1.2 + u_phase.x);
    }
    if (topologyKind < 1.5) {
      return sin(p.y * 2.4 + cycle * 0.96 + u_phase.y);
    }
    if (topologyKind < 2.5) {
      return sin(length(p - u_phase * 0.08) * 5.2 - cycle * 1.08);
    }
    if (topologyKind < 3.5) {
      return sin(p.x * 2.7 - cycle * 1.42 + u_phase.x);
    }
    return sin(dot(p, vec2(1.12, -0.76)) * 2.2 + cycle * 1.24);
  }

  vec2 topologyCausticMotion(float topologyKind, float cycle) {
    if (topologyKind < 0.5) {
      return vec2(
        sin(cycle * 0.8 + u_phase.x) * 0.15,
        cos(cycle * 0.5 + u_phase.y) * 0.045
      );
    }
    if (topologyKind < 1.5) {
      return vec2(
        sin(cycle * 0.45 + u_phase.x) * 0.035,
        sin(cycle * 0.86 + u_phase.y) * 0.15
      );
    }
    if (topologyKind < 2.5) {
      return vec2(
        cos(cycle * 0.82 + u_phase.x),
        sin(cycle * 0.82 + u_phase.y)
      ) * 0.15;
    }
    if (topologyKind < 3.5) {
      return vec2(
        sin(cycle * 1.1 + u_phase.x),
        sin(cycle * 2.2 + u_phase.y)
      ) * vec2(0.14, 0.08);
    }
    return vec2(
      cos(cycle * 0.94 + u_phase.x),
      sin(cycle * 1.24 + u_phase.y)
    ) * 0.13;
  }

  void main() {
    vec2 uv = v_uv;
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 spherePoint = (uv - 0.5) * 2.0 * vec2(aspect, 1.0);
    vec2 composedPoint = rotate2d(
      vec2(spherePoint.x * u_mirror, spherePoint.y),
      u_angle
    ) * u_scale;
    composedPoint += u_phase * 0.12;

    // Identity geometry still sets the cadence. A shorter cycle lets each
    // topology's own movement register at compact node sizes.
    float cycle = (u_time / max(u_drift_seconds * 0.5, 1.0)) * TAU;
    vec2 seedOffset = vec2(
      fract(u_seed * 0.013),
      fract(u_seed * 0.021)
    ) * 7.0;
    vec2 drift = vec2(cycle * 0.38, -cycle * 0.29);
    float warpX = fbm(composedPoint * 0.86 + seedOffset + drift);
    float warpY = fbm(composedPoint * 0.86 + seedOffset.yx + vec2(5.2, 1.7) - drift.yx);
    vec2 warpVector = vec2(warpX, warpY) - 0.5;
    vec2 p = composedPoint + warpVector * u_warp;

    float previousPrimary;
    float previousSecondary;
    float previousStructure;
    float nextPrimary;
    float nextSecondary;
    float nextStructure;
    topologyField(
      u_previous_topology_kind,
      p,
      cycle,
      previousPrimary,
      previousSecondary,
      previousStructure
    );
    topologyField(
      u_topology_kind,
      p,
      cycle,
      nextPrimary,
      nextSecondary,
      nextStructure
    );
    float primary = mix(previousPrimary, nextPrimary, u_identity_mix);
    float secondary = mix(previousSecondary, nextSecondary, u_identity_mix);
    float structure = mix(previousStructure, nextStructure, u_identity_mix);
    primary = clamp(primary, 0.0, 1.0);
    secondary = clamp(secondary, 0.0, 1.0);
    structure = clamp(structure, 0.0, 1.0);
    float flowSignal = mix(
      topologyFlowSignal(u_previous_topology_kind, p, cycle),
      topologyFlowSignal(u_topology_kind, p, cycle),
      u_identity_mix
    );
    float travelingFlow = smoothstep(-0.72, 0.72, flowSignal);

    float depthNoise = fbm(p * 1.22 + seedOffset * 0.41 - drift * 0.52);
    float internalOcclusion = smoothstep(0.48, 0.86, depthNoise + (1.0 - max(primary, secondary)) * 0.12);

    vec2 causticMotion = mix(
      topologyCausticMotion(u_previous_topology_kind, cycle),
      topologyCausticMotion(u_topology_kind, cycle),
      u_identity_mix
    );
    vec2 movingCausticPoint = u_caustic_point + causticMotion;
    float causticDistance = length((uv - movingCausticPoint) * vec2(aspect, 1.0));
    float causticFalloff = 1.0 - smoothstep(0.035, 0.49, causticDistance);
    float causticMask = clamp(
      causticFalloff * (0.42 + max(primary, secondary) * 0.58) + structure * 0.32,
      0.0,
      1.0
    );

    // Macro fields lift the otherwise smooth sphere normal, making the material and pattern one
    // surface instead of a flat texture pasted beneath unrelated lighting.
    float surfaceField = primary * 0.28
      + secondary * 0.22
      + causticMask * 0.16
      - internalOcclusion * 0.24
      + (warpX - warpY) * 0.07;
    float pixelSpan = min(u_resolution.x, u_resolution.y);
    vec2 fieldGradient = clamp(
      vec2(dFdx(surfaceField), dFdy(surfaceField)) * pixelSpan * 0.12,
      vec2(-0.42),
      vec2(0.42)
    );
    float sphereZ = sqrt(max(0.0, 1.0 - dot(spherePoint, spherePoint)));
    vec3 normal = normalize(vec3(spherePoint - fieldGradient * 0.16, sphereZ + 0.045));

    vec3 absorption = srgbToLinear(u_absorption);
    vec3 bodyColor = srgbToLinear(u_body);
    vec3 currentColor = srgbToLinear(u_current);
    vec3 counterColor = srgbToLinear(u_counter);
    vec3 causticColor = srgbToLinear(u_caustic);

    vec3 material = mix(absorption, bodyColor, 0.58 + sphereZ * 0.22);
    material = mix(material, currentColor, primary * 0.68);
    material = mix(material, counterColor, secondary * 0.62);
    material = mix(
      material,
      (currentColor + counterColor) * 0.5,
      structure * 0.28
    );
    vec3 travelingColor = mix(
      counterColor,
      mix(currentColor, causticColor, 0.42),
      travelingFlow
    );
    material = mix(
      material,
      travelingColor,
      0.04 + travelingFlow * 0.12 + max(primary, secondary) * 0.07
    );
    material = mix(material, absorption, 0.1 + internalOcclusion * 0.29);

    // Fixed lights describe the material. Only the internal field above changes with activity.
    vec3 keyLight = normalize(vec3(-0.58, 0.64, 0.72));
    vec3 fillLight = normalize(vec3(0.74, -0.18, 0.58));
    vec3 view = vec3(0.0, 0.0, 1.0);
    vec3 keyHalfway = normalize(keyLight + view);
    float keyDiffuse = max(dot(normal, keyLight), 0.0);
    float fillDiffuse = max(dot(normal, fillLight), 0.0);
    float diffuse = 0.42 + keyDiffuse * 0.48 + fillDiffuse * 0.14;
    float tightSpecular = pow(max(dot(normal, keyHalfway), 0.0), 44.0);
    float broadSpecular = pow(max(dot(normal, keyHalfway), 0.0), 8.0);

    float nDotV = clamp(dot(normal, view), 0.0, 1.0);
    float fresnel = pow(1.0 - nDotV, 2.6);
    vec2 transmissionDirection = normalize(vec2(0.76, -0.65));
    float transmissionSide = smoothstep(
      -0.34,
      0.92,
      dot(spherePoint, transmissionDirection)
    );
    vec3 edgeColor = mix(counterColor, currentColor, transmissionSide);

    vec3 color = material * diffuse;
    color += currentColor * primary * 0.11;
    color += counterColor * secondary * 0.095;
    color += causticColor * causticMask * 0.48;
    color += mix(causticColor, vec3(1.0), 0.34)
      * (tightSpecular * 0.42 + broadSpecular * 0.08);
    color += edgeColor * fresnel * (0.13 + transmissionSide * 0.2);
    color += causticColor * fresnel * transmissionSide * 0.12;
    color = linearToSrgb(toneMap(color));

    // One static, monochrome, pixel-scale grain pass. It never swims with the active field.
    float grain = hash(gl_FragCoord.xy + vec2(u_seed, u_seed * 0.37)) - 0.5;
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color += grain * mix(0.015, 0.009, luminance);

    // The parent owns the circular clip. Inside it, WebGL is the single opaque material.
    outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

const THINKING_STATUSES = new Set<AgentStatus>([
  "spawning",
  "working",
  "gating",
  "reporting",
]);

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
  if (status === "spawning") return 1.3;
  if (status === "gating") return 0.94;
  if (status === "reporting") return 0.88;
  return 1.08;
}

const TOPOLOGY_INDEX: Record<AgentIdentity["topology"], number> = {
  confluence: 0,
  strata: 1,
  basin: 2,
  braid: 3,
  interference: 4,
};

type MeshColor = [number, number, number];

interface MeshIdentityState {
  seed: number;
  angle: number;
  scale: number;
  bandWidth: number;
  warp: number;
  phaseX: number;
  phaseY: number;
  causticX: number;
  causticY: number;
  driftSeconds: number;
  mirror: number;
  absorption: MeshColor;
  body: MeshColor;
  current: MeshColor;
  counter: MeshColor;
  caustic: MeshColor;
}

export interface AgentMeshHandle {
  updateIdentity: (identity: AgentIdentity) => void;
  dispose: () => void;
}

function meshIdentityState(identity: AgentIdentity): MeshIdentityState {
  return {
    seed: identity.seed % 10000,
    angle: (identity.geometry.angle * Math.PI) / 180,
    scale: identity.geometry.scale,
    bandWidth: identity.geometry.bandWidth,
    warp: identity.geometry.warp,
    phaseX: identity.geometry.phaseX,
    phaseY: identity.geometry.phaseY,
    causticX: identity.geometry.causticX / 100,
    causticY: identity.geometry.causticY / 100,
    driftSeconds: identity.geometry.driftSeconds,
    mirror: identity.geometry.mirror,
    absorption: rgb(identity.palette.absorption),
    body: rgb(identity.palette.body),
    current: rgb(identity.palette.current),
    counter: rgb(identity.palette.counter),
    caustic: rgb(identity.palette.caustic),
  };
}

function mixNumber(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function mixAngle(from: number, to: number, amount: number): number {
  const turn = Math.PI * 2;
  const delta = ((to - from + Math.PI * 3) % turn) - Math.PI;
  return from + delta * amount;
}

function mixColor(from: MeshColor, to: MeshColor, amount: number): MeshColor {
  return [
    mixNumber(from[0], to[0], amount),
    mixNumber(from[1], to[1], amount),
    mixNumber(from[2], to[2], amount),
  ];
}

function mixIdentityState(
  from: MeshIdentityState,
  to: MeshIdentityState,
  amount: number,
): MeshIdentityState {
  return {
    seed: mixNumber(from.seed, to.seed, amount),
    angle: mixAngle(from.angle, to.angle, amount),
    scale: mixNumber(from.scale, to.scale, amount),
    bandWidth: mixNumber(from.bandWidth, to.bandWidth, amount),
    warp: mixNumber(from.warp, to.warp, amount),
    phaseX: mixNumber(from.phaseX, to.phaseX, amount),
    phaseY: mixNumber(from.phaseY, to.phaseY, amount),
    causticX: mixNumber(from.causticX, to.causticX, amount),
    causticY: mixNumber(from.causticY, to.causticY, amount),
    driftSeconds: mixNumber(from.driftSeconds, to.driftSeconds, amount),
    mirror: mixNumber(from.mirror, to.mirror, amount),
    absorption: mixColor(from.absorption, to.absorption, amount),
    body: mixColor(from.body, to.body, amount),
    current: mixColor(from.current, to.current, amount),
    counter: mixColor(from.counter, to.counter, amount),
    caustic: mixColor(from.caustic, to.caustic, amount),
  };
}

function settledMeshHandle(canvas: HTMLCanvasElement): AgentMeshHandle {
  canvas.dataset.identityTransition = "settled";
  return {
    updateIdentity: () => undefined,
    dispose: () => undefined,
  };
}

const MAX_BACKING_SCALE = 2.5;
const IDENTITY_TRANSITION_MS = 700;

/** Mount one compact field. Identity changes interpolate in this canvas; the media compositor never
 * has to carry two WebGL surfaces. Still marks hold their exact frame outside that brief handoff. */
export function mountAgentMesh(
  canvas: HTMLCanvasElement,
  identity: AgentIdentity,
  status: AgentStatus,
  fieldMotion: "auto" | "still" = "auto",
): AgentMeshHandle {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: "low-power",
  });
  if (!gl) {
    canvas.dataset.meshReady = "fallback";
    return settledMeshHandle(canvas);
  }

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, agentFragmentSource);
  if (!vertexShader || !fragmentShader) {
    canvas.dataset.meshReady = "fallback";
    return settledMeshHandle(canvas);
  }

  const program = gl.createProgram();
  if (!program) return settledMeshHandle(canvas);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    canvas.dataset.meshReady = "fallback";
    return settledMeshHandle(canvas);
  }

  const buffer = gl.createBuffer();
  if (!buffer) return settledMeshHandle(canvas);
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
  const previousTopologyKind = gl.getUniformLocation(program, "u_previous_topology_kind");
  const topologyKind = gl.getUniformLocation(program, "u_topology_kind");
  const identityMix = gl.getUniformLocation(program, "u_identity_mix");
  const angle = gl.getUniformLocation(program, "u_angle");
  const fieldScale = gl.getUniformLocation(program, "u_scale");
  const bandWidth = gl.getUniformLocation(program, "u_band_width");
  const warp = gl.getUniformLocation(program, "u_warp");
  const phase = gl.getUniformLocation(program, "u_phase");
  const causticPoint = gl.getUniformLocation(program, "u_caustic_point");
  const driftSeconds = gl.getUniformLocation(program, "u_drift_seconds");
  const mirror = gl.getUniformLocation(program, "u_mirror");
  const absorption = gl.getUniformLocation(program, "u_absorption");
  const body = gl.getUniformLocation(program, "u_body");
  const current = gl.getUniformLocation(program, "u_current");
  const counter = gl.getUniformLocation(program, "u_counter");
  const caustic = gl.getUniformLocation(program, "u_caustic");

  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let currentStatus = status;
  let motionPolicy = fieldMotion;
  let reducedMotion = media.matches;
  let identityKey = identity.key;
  let renderedIdentity = meshIdentityState(identity);
  let identityFrom = renderedIdentity;
  let identityTarget = renderedIdentity;
  let previousTopology = TOPOLOGY_INDEX[identity.topology];
  let nextTopology = previousTopology;
  let materialMix = 1;
  let identityTransitionStarted = 0;
  let identityTransitioning = false;
  let animationFrame = 0;
  let lastFrame = 0;
  let lastTimestamp = 0;
  let elapsed = 0;
  let disposed = false;

  canvas.dataset.identityTransition = "settled";

  const shouldAnimate = () =>
    motionPolicy === "auto" && isAgentThinking(currentStatus) && !reducedMotion;

  const needsFrames = () => shouldAnimate() || identityTransitioning;

  const syncMotionState = () => {
    canvas.dataset.meshMotion = shouldAnimate() ? "running" : "still";
  };

  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, MAX_BACKING_SCALE);
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  };

  const advanceIdentityTransition = (timestamp: number) => {
    if (!identityTransitioning) return;
    const progress = Math.min(1, (timestamp - identityTransitionStarted) / IDENTITY_TRANSITION_MS);
    const eased = progress * progress * (3 - 2 * progress);
    renderedIdentity = mixIdentityState(identityFrom, identityTarget, eased);
    materialMix = eased;
    if (progress >= 1) {
      renderedIdentity = identityTarget;
      previousTopology = nextTopology;
      materialMix = 1;
      identityTransitioning = false;
      canvas.dataset.identityTransition = "settled";
    }
  };

  const applyIdentityUniforms = () => {
    gl.uniform1f(seed, renderedIdentity.seed);
    gl.uniform1f(previousTopologyKind, previousTopology);
    gl.uniform1f(topologyKind, nextTopology);
    gl.uniform1f(identityMix, materialMix);
    gl.uniform1f(angle, renderedIdentity.angle);
    gl.uniform1f(fieldScale, renderedIdentity.scale);
    gl.uniform1f(bandWidth, renderedIdentity.bandWidth);
    gl.uniform1f(warp, renderedIdentity.warp);
    gl.uniform2f(phase, renderedIdentity.phaseX, renderedIdentity.phaseY);
    gl.uniform2f(causticPoint, renderedIdentity.causticX, renderedIdentity.causticY);
    gl.uniform1f(driftSeconds, renderedIdentity.driftSeconds);
    gl.uniform1f(mirror, renderedIdentity.mirror);
    gl.uniform3fv(absorption, renderedIdentity.absorption);
    gl.uniform3fv(body, renderedIdentity.body);
    gl.uniform3fv(current, renderedIdentity.current);
    gl.uniform3fv(counter, renderedIdentity.counter);
    gl.uniform3fv(caustic, renderedIdentity.caustic);
  };

  const draw = (timestamp = window.performance.now()) => {
    advanceIdentityTransition(timestamp);
    resize();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(resolution, canvas.width, canvas.height);
    gl.uniform1f(time, (renderedIdentity.seed % 997) / 83 + elapsed);
    applyIdentityUniforms();
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // The focus room also carries a hardware-decoded video layer. Submit each brief identity
    // handoff frame before the compositor samples both surfaces, without blocking on gl.finish().
    if (identityTransitioning) gl.flush();
    canvas.dataset.meshReady = "true";
  };

  const tick = (timestamp: number) => {
    if (disposed || !canvas.isConnected || !needsFrames()) return;
    if (lastTimestamp && shouldAnimate()) {
      elapsed += ((timestamp - lastTimestamp) / 1000) * motionRate(currentStatus);
    }
    lastTimestamp = timestamp;
    if (timestamp - lastFrame >= 34) {
      draw(timestamp);
      lastFrame = timestamp;
    }
    if (needsFrames()) animationFrame = window.requestAnimationFrame(tick);
  };

  const scheduleFrames = () => {
    window.cancelAnimationFrame(animationFrame);
    lastTimestamp = 0;
    if (needsFrames()) animationFrame = window.requestAnimationFrame(tick);
  };

  const syncRuntimeState = () => {
    const nextStatus = canvas.dataset.agentStatus as AgentStatus | undefined;
    if (nextStatus) currentStatus = nextStatus;
    motionPolicy = canvas.dataset.motionPolicy === "still" ? "still" : "auto";

    syncMotionState();
    scheduleFrames();
  };

  const updateMotionPreference = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches;
    if (reducedMotion && identityTransitioning) {
      renderedIdentity = identityTarget;
      previousTopology = nextTopology;
      materialMix = 1;
      identityTransitioning = false;
      canvas.dataset.identityTransition = "settled";
      draw();
    }
    syncRuntimeState();
  };

  const updateIdentity = (nextIdentity: AgentIdentity) => {
    if (nextIdentity.key === identityKey) return;
    const timestamp = window.performance.now();
    advanceIdentityTransition(timestamp);
    const dominantTopology = materialMix >= 0.5 ? nextTopology : previousTopology;
    identityKey = nextIdentity.key;
    identityFrom = renderedIdentity;
    identityTarget = meshIdentityState(nextIdentity);
    previousTopology = dominantTopology;
    nextTopology = TOPOLOGY_INDEX[nextIdentity.topology];

    if (reducedMotion) {
      renderedIdentity = identityTarget;
      previousTopology = nextTopology;
      materialMix = 1;
      identityTransitioning = false;
      canvas.dataset.identityTransition = "settled";
      draw(timestamp);
      scheduleFrames();
      return;
    }

    materialMix = 0;
    identityTransitionStarted = timestamp;
    identityTransitioning = true;
    canvas.dataset.identityTransition = "running";
    draw(timestamp);
    scheduleFrames();
  };

  const resizeObserver = new ResizeObserver(() => draw());
  resizeObserver.observe(canvas);
  const runtimeObserver = new MutationObserver(syncRuntimeState);
  runtimeObserver.observe(canvas, {
    attributes: true,
    attributeFilter: ["data-agent-status", "data-motion-policy"],
  });
  const transformObserver = new MutationObserver(() => draw());
  const transformedAncestors = [
    canvas.closest(".react-flow__node"),
    canvas.closest(".react-flow__viewport"),
  ].filter((element): element is Element => Boolean(element));
  for (const element of transformedAncestors) {
    transformObserver.observe(element, {
      attributes: true,
      attributeFilter: ["style"],
    });
  }
  const drawAfterWindowResize = () => draw();
  window.addEventListener("resize", drawAfterWindowResize);
  media.addEventListener("change", updateMotionPreference);
  syncRuntimeState();
  draw();

  const dispose = () => {
    disposed = true;
    window.cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    runtimeObserver.disconnect();
    transformObserver.disconnect();
    window.removeEventListener("resize", drawAfterWindowResize);
    media.removeEventListener("change", updateMotionPreference);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  };

  return { updateIdentity, dispose };
}
