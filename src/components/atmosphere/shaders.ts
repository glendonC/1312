export const vertexSource = `#version 300 es
    in vec2 a_position;
    out vec2 v_uv;

    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  export const fragmentSource = `#version 300 es
    precision highp float;

    in vec2 v_uv;
    out vec4 outColor;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_tone;

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
      vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 1.42;
      float time = u_time * 0.028;

      vec2 q = vec2(
        fbm(p + vec2(0.0, time)),
        fbm(p + vec2(4.7, 1.9) - vec2(time * 0.72, time * 0.36))
      );
      vec2 r = vec2(
        fbm(p + 2.15 * q + vec2(1.8, 7.4) + time * 0.42),
        fbm(p + 2.35 * q + vec2(8.3, 2.8) - time * 0.31)
      );
      float field = fbm(p + 2.8 * r);

      vec3 paper = mix(vec3(0.945, 0.958, 0.938), vec3(0.965, 0.940, 0.925), u_tone);
      vec3 celadon = mix(vec3(0.535, 0.708, 0.638), vec3(0.770, 0.460, 0.420), u_tone);
      vec3 mineral = mix(vec3(0.535, 0.648, 0.720), vec3(0.480, 0.210, 0.200), u_tone);
      vec3 clay = mix(vec3(0.820, 0.665, 0.535), vec3(0.900, 0.650, 0.580), u_tone);
      vec3 deep = mix(vec3(0.165, 0.375, 0.350), vec3(0.300, 0.080, 0.070), u_tone);
      vec3 bloomColor = mix(vec3(0.985, 0.982, 0.955), vec3(0.995, 0.960, 0.940), u_tone);

      vec3 color = mix(paper, celadon, smoothstep(0.18, 0.83, field) * 0.78);
      color = mix(color, mineral, smoothstep(0.37, 0.91, q.y) * 0.54);
      color = mix(color, clay, smoothstep(0.58, 0.92, r.x) * 0.22);
      color = mix(color, deep, smoothstep(0.73, 1.0, field + q.x * 0.18) * 0.18);

      vec2 bloomPoint = vec2(0.69 + sin(time * 0.7) * 0.06, 0.23 + cos(time * 0.53) * 0.05);
      float bloom = 1.0 - smoothstep(0.03, 0.62, distance(uv, bloomPoint));
      color = mix(color, bloomColor, bloom * 0.38);

      float edge = 1.0 - smoothstep(0.28, 0.94, length((uv - 0.5) * vec2(0.76, 1.0)));
      color *= mix(0.93, 1.035, edge);

      float grain = hash(gl_FragCoord.xy) - 0.5;
      color += grain * 0.022;

      outColor = vec4(color, 1.0);
    }
  `;
