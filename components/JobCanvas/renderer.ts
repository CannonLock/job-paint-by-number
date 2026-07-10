// WebGL2 instanced renderer for ~2M job boxes.
//
// One unit quad is drawn `count` times via instancing. Each instance reads its
// submit/wait/dur/mem/disk from per-instance attributes and computes its own
// grid cell (from gl_InstanceID) and color entirely on the GPU. Animating the
// timeline is therefore just updating one uniform (uPlayhead) per frame — no
// per-box CPU work, no buffer re-uploads.

import type { ColorMode, JobData } from "./data";

// Color mode -> shader int. Keep in sync with the fragment logic below.
export const COLOR_MODE_INT: Record<ColorMode, number> = {
  stage: 0,
  mem: 1,
  disk: 2,
  wait: 3,
  dur: 4,
};

// Stage palette (unsubmitted, queued, running, completed). Mirrored in the UI legend.
export const STAGE_COLORS: [number, number, number][] = [
  [0.075, 0.08, 0.11], // unsubmitted — near background, reads as empty
  [0.949, 0.651, 0.231], // queued — amber
  [0.22, 0.816, 0.973], // running — bright cyan
  [0.184, 0.62, 0.329], // completed — muted green
];

// Viridis-ish sequential ramp for all "aspect" color modes (colorblind-safe).
export const ASPECT_RAMP: [number, number, number][] = [
  [0.267, 0.005, 0.329],
  [0.231, 0.322, 0.545],
  [0.129, 0.569, 0.549],
  [0.369, 0.788, 0.384],
  [0.992, 0.906, 0.145],
];

export const NO_DATA_COLOR: [number, number, number] = [0.22, 0.23, 0.27];
export const BACKGROUND: [number, number, number] = [0.039, 0.043, 0.063];

export interface Camera {
  scale: number; // device px per world unit
  panX: number; // device px position of world origin
  panY: number;
}

const VERT = `#version 300 es
precision highp float;

in vec2 aCorner;       // unit-quad corner, [0..1]
in float aSubmit;      // seconds from t0
in float aWait;        // queue seconds, or 65535 (never ran)
in float aDur;         // run seconds, or 65535 (no completion)
in float aMem;         // requested memory (MB)
in float aDisk;        // requested disk (KB)

uniform vec4 uView;        // world -> clip: (sx, sy, tx, ty)
uniform float uGridCols;
uniform float uBoxFill;    // fraction of a cell the box occupies
uniform float uPlayhead;   // seconds from t0
uniform int uColorMode;
uniform float uMaxWait;
uniform float uMaxDur;
uniform float uMaxMem;
uniform float uMaxDisk;
uniform vec3 uStage[4];
uniform vec3 uRamp[5];
uniform vec3 uNoData;

flat out vec3 vColor;

vec3 rampColor(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  float fi = floor(t);
  int i = int(fi);
  if (i >= 4) return uRamp[4];
  return mix(uRamp[i], uRamp[i + 1], t - fi);
}

void main() {
  float id = float(gl_InstanceID);
  float col = mod(id, uGridCols);
  float row = floor(id / uGridCols);
  float off = (1.0 - uBoxFill) * 0.5;
  vec2 world = vec2(col + off + aCorner.x * uBoxFill,
                    row + off + aCorner.y * uBoxFill);
  gl_Position = vec4(world.x * uView.x + uView.z,
                     world.y * uView.y + uView.w, 0.0, 1.0);

  float T = uPlayhead;
  bool ran = aWait < 65535.0;
  bool done = aDur < 65535.0;
  float start = ran ? aSubmit + aWait : 1e30;
  float completion = (ran && done) ? start + aDur : 1e30;

  vec3 c;
  if (uColorMode == 0) {
    if (T < aSubmit) c = uStage[0];
    else if (T < start) c = uStage[1];
    else if (T < completion) c = uStage[2];
    else c = uStage[3];
  } else if (T < aSubmit) {
    c = uStage[0];
  } else {
    float t = 0.0;
    bool nodata = false;
    if (uColorMode == 1) t = aMem / uMaxMem;
    else if (uColorMode == 2) t = log(aDisk + 1.0) / log(uMaxDisk + 1.0);
    else if (uColorMode == 3) { if (!ran) nodata = true; else t = sqrt(aWait / uMaxWait); }
    else { if (!done) nodata = true; else t = sqrt(aDur / uMaxDur); }
    c = nodata ? uNoData : rampColor(t);
  }
  vColor = c;
}`;

const FRAG = `#version 300 es
precision highp float;
flat in vec3 vColor;
out vec4 fragColor;
void main() { fragColor = vec4(vColor, 1.0); }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

export class JobRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffers: WebGLBuffer[] = [];
  private count = 0;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    this.vao = gl.createVertexArray()!;

    gl.useProgram(program);
    for (const name of [
      "uView", "uGridCols", "uBoxFill", "uPlayhead", "uColorMode",
      "uMaxWait", "uMaxDur", "uMaxMem", "uMaxDisk", "uStage", "uRamp", "uNoData",
    ]) {
      this.u[name] = gl.getUniformLocation(program, name);
    }

    // Static uniforms.
    gl.uniform3fv(this.u.uStage, new Float32Array(STAGE_COLORS.flat()));
    gl.uniform3fv(this.u.uRamp, new Float32Array(ASPECT_RAMP.flat()));
    gl.uniform3fv(this.u.uNoData, new Float32Array(NO_DATA_COLOR));

    gl.clearColor(BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 1);
  }

  private instanceBuffer(name: string, data: Float32Array) {
    const gl = this.gl;
    const loc = gl.getAttribLocation(this.program, name);
    const buf = gl.createBuffer()!;
    this.buffers.push(buf);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(loc, 1);
  }

  uploadData(data: JobData) {
    const gl = this.gl;
    this.count = data.meta.count;
    gl.bindVertexArray(this.vao);

    // Unit-quad corners (triangle strip), shared across instances.
    const cornerLoc = gl.getAttribLocation(this.program, "aCorner");
    const cornerBuf = gl.createBuffer()!;
    this.buffers.push(cornerBuf);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(cornerLoc);
    gl.vertexAttribPointer(cornerLoc, 2, gl.FLOAT, false, 0, 0);

    this.instanceBuffer("aSubmit", data.submit);
    this.instanceBuffer("aWait", data.wait);
    this.instanceBuffer("aDur", data.dur);
    this.instanceBuffer("aMem", data.mem);
    this.instanceBuffer("aDisk", data.disk);

    gl.bindVertexArray(null);

    gl.useProgram(this.program);
    gl.uniform1f(this.u.uGridCols, data.meta.gridCols);
    gl.uniform1f(this.u.uMaxWait, data.meta.maxWait);
    gl.uniform1f(this.u.uMaxDur, data.meta.maxDur);
    gl.uniform1f(this.u.uMaxMem, data.meta.maxMem);
    gl.uniform1f(this.u.uMaxDisk, data.meta.maxDisk);
    gl.uniform1f(this.u.uBoxFill, 1.0);
  }

  // The grid's column count is chosen on the client from the window aspect
  // ratio (so the boxes fill the screen), independent of the baked-in default.
  setGridCols(cols: number) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform1f(this.u.uGridCols, cols);
  }

  resize(cssW: number, cssH: number, dpr: number) {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  render(camera: Camera, playhead: number, colorMode: number, boxFill = 1.0) {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!this.count || w === 0) return;

    // world -> clip. screen px = world*scale + pan; clip = px/(dim/2) [- / flip] 1.
    const sx = camera.scale / (w / 2);
    const sy = -camera.scale / (h / 2);
    const tx = camera.panX / (w / 2) - 1;
    const ty = 1 - camera.panY / (h / 2);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform4f(this.u.uView, sx, sy, tx, ty);
    gl.uniform1f(this.u.uPlayhead, playhead);
    gl.uniform1i(this.u.uColorMode, colorMode);
    gl.uniform1f(this.u.uBoxFill, boxFill);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    for (const b of this.buffers) gl.deleteBuffer(b);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
