/* @ts-self-types="./sand_engine.d.ts" */

export class SandEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SandEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sandengine_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    cell_count() {
        const ret = wasm.sandengine_cell_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Byte offset of the cell array; one `u8` material per cell. Exposed for
     * debugging and parity checks against the TypeScript engine, not needed by
     * the render path.
     * @returns {number}
     */
    cells_ptr() {
        const ret = wasm.sandengine_cells_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    clear_sand() {
        wasm.sandengine_clear_sand(this.__wbg_ptr);
    }
    /**
     * Latches the pixel rectangle touched since the previous call and returns
     * whether there was one. Read it with `dirty_x/y/w/h`.
     * @returns {boolean}
     */
    consume_dirty() {
        const ret = wasm.sandengine_consume_dirty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    dirty_h() {
        const ret = wasm.sandengine_dirty_h(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    dirty_w() {
        const ret = wasm.sandengine_dirty_w(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    dirty_x() {
        const ret = wasm.sandengine_dirty_x(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    dirty_y() {
        const ret = wasm.sandengine_dirty_y(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Rain `count` grains into a lane from the sky above it.
     * @param {number} lane
     * @param {number} count
     * @param {number} material
     */
    drop_grains(lane, count, material) {
        wasm.sandengine_drop_grains(this.__wbg_ptr, lane, count, material);
    }
    /**
     * Top row of the ground slab.
     * @returns {number}
     */
    ground_y() {
        const ret = wasm.sandengine_ground_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    height() {
        const ret = wasm.sandengine_height(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    in_flight() {
        const ret = wasm.sandengine_in_flight(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    lane_count() {
        const ret = wasm.sandengine_lane_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} lane
     * @returns {number}
     */
    lane_material(lane) {
        const ret = wasm.sandengine_lane_material(this.__wbg_ptr, lane);
        return ret;
    }
    /**
     * Inclusive left interior column of a lane, or -1 for an unknown lane.
     * @param {number} lane
     * @returns {number}
     */
    lane_x0(lane) {
        const ret = wasm.sandengine_lane_x0(this.__wbg_ptr, lane);
        return ret;
    }
    /**
     * Inclusive right interior column of a lane, or -1 for an unknown lane.
     * @param {number} lane
     * @returns {number}
     */
    lane_x1(lane) {
        const ret = wasm.sandengine_lane_x1(this.__wbg_ptr, lane);
        return ret;
    }
    /**
     * Automaton cell moves in the most recent step; 0 = every pile is at rest.
     * @returns {number}
     */
    moves_last_step() {
        const ret = wasm.sandengine_moves_last_step(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * `peaks[i]` is lane i's largest ever grain count, `materials[i]` its sand
     * material. Extra entries in the longer array are ignored. `seed` seeds the
     * engine's internal PRNG -- `wasm32-unknown-unknown` has no entropy of its
     * own, so pass something from `Date.now()` for variety or a constant for a
     * reproducible run.
     * @param {Uint32Array} peaks
     * @param {Uint8Array} materials
     * @param {number} seed
     */
    constructor(peaks, materials, seed) {
        const ptr0 = passArray32ToWasm0(peaks, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(materials, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.sandengine_new(ptr0, len0, ptr1, len1, seed);
        this.__wbg_ptr = ret;
        SandEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Grains that had nowhere to land; should stay 0 by construction.
     * @returns {number}
     */
    overflow() {
        const ret = wasm.sandengine_overflow(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    pixel_bytes() {
        const ret = wasm.sandengine_pixel_bytes(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Byte offset of the RGBA pixel buffer in linear memory. Wrap as
     * `new Uint8ClampedArray(memory.buffer, ptr, pixel_bytes())`.
     * @returns {number}
     */
    pixels_ptr() {
        const ret = wasm.sandengine_pixels_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Vanish up to `count` grains off a pile's summit; returns how many
     * actually went. Short when the pile has run dry, which the caller carries
     * as a debt to the next frame.
     * @param {number} lane
     * @param {number} count
     * @returns {number}
     */
    remove(lane, count) {
        const ret = wasm.sandengine_remove(this.__wbg_ptr, lane, count);
        return ret >>> 0;
    }
    /**
     * Settled grains in a lane, excluding grains still falling toward it. Can
     * go negative in the same circumstances the TypeScript engine's could --
     * `remove` is called against a lane whose bookkeeping ran ahead.
     * @param {number} lane
     * @returns {number}
     */
    settled_in(lane) {
        const ret = wasm.sandengine_settled_in(this.__wbg_ptr, lane);
        return ret;
    }
    /**
     * Lay `count` grains down as an already-settled cone: the instant-seek
     * path.
     * @param {number} lane
     * @param {number} count
     * @param {number} material
     */
    stamp(lane, count, material) {
        wasm.sandengine_stamp(this.__wbg_ptr, lane, count, material);
    }
    /**
     * One frame of physics, plus every incremental pixel write it implies.
     * @param {number} tick
     */
    step(tick) {
        wasm.sandengine_step(this.__wbg_ptr, tick);
    }
    /**
     * @returns {number}
     */
    width() {
        const ret = wasm.sandengine_width(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) SandEngine.prototype[Symbol.dispose] = SandEngine.prototype.free;

/**
 * Material constants, so the TypeScript side never hard-codes them twice.
 * @returns {Uint8Array}
 */
export function materials() {
    const ret = wasm.materials();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_bb96b2010945f0bc: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./sand_engine_bg.js": import0,
    };
}

const SandEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sandengine_free(ptr, 1));

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('sand_engine_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
