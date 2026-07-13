import { fragmentSource, vertexSource } from "./shaders";

type AtmosphereWindow = Window & { __atmosphereFieldsBound?: boolean };

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const initializeAtmosphereFields = () => {
  document.querySelectorAll<HTMLCanvasElement>("[data-atmosphere-field]").forEach((canvas) => {
    if (canvas.dataset.shaderReady === "true") return;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    const buffer = gl.createBuffer();
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
    const tone = gl.getUniformLocation(program, "u_tone");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 1.25);
      const width = Math.max(1, Math.round(bounds.width * scale));
      const height = Math.max(1, Math.round(bounds.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const draw = (timestamp: number) => {
      resize();
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, reduceMotion ? 0 : timestamp / 1000);
      gl.uniform1f(tone, canvas.dataset.tone === "missing" ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    let lastFrame = 0;
    const tick = (timestamp: number) => {
      if (!canvas.isConnected) return;
      if (timestamp - lastFrame >= 32) {
        draw(timestamp);
        lastFrame = timestamp;
      }
      window.requestAnimationFrame(tick);
    };

    canvas.dataset.shaderReady = "true";
    if (reduceMotion) draw(0);
    else window.requestAnimationFrame(tick);
  });
};

export function bindAtmosphereFields(): void {
  const atmosphereWindow = window as AtmosphereWindow;
  if (!atmosphereWindow.__atmosphereFieldsBound) {
    document.addEventListener("astro:page-load", initializeAtmosphereFields);
    atmosphereWindow.__atmosphereFieldsBound = true;
  }
  initializeAtmosphereFields();
}
