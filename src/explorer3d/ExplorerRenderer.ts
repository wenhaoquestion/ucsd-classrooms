import { WebGLRenderer } from "three";

/** Device pixel ratio cap. Phones get a lower one: their GPUs are slower and
 * their pixels too small for the difference to show. */
const MAX_PIXEL_RATIO = 2;
const MAX_TOUCH_PIXEL_RATIO = 1.5;
/** Cap on drawing-buffer pixels so large/high-DPI screens stay cheap. */
const MAX_BUFFER_PIXELS = 3_000_000;

function coarsePointer(): boolean {
  return !!window.matchMedia?.("(pointer: coarse)").matches;
}

export type RendererOwner = {
  /** Called after the WebGL context is lost or restored. */
  onContextChange(lost: boolean): void;
};

/**
 * A single WebGL renderer shared by every building explorer, so repeatedly
 * opening buildings never creates more than one WebGL context.
 *
 * The owning scene's stage element hosts the canvas, which is sized to the
 * stage. The canvas is transparent, so the stage's CSS background shows
 * behind the model.
 */
export class ExplorerRenderer {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  #owner: RendererOwner | null = null;
  contextLost = false;
  width = 0;
  height = 0;

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.className = "explorer-canvas";
    canvas.setAttribute("aria-hidden", "true");
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      // Phones keep battery; desktops get the discrete GPU if there is one
      powerPreference: coarsePointer() ? "default" : "high-performance",
    });
    this.canvas = canvas;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 0);
    canvas.addEventListener("webglcontextlost", this.#handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.#handleContextRestored);
  }

  /** Resizes the drawing buffer to a CSS size. Returns whether it changed. */
  setSize(width: number, height: number): boolean {
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      coarsePointer() ? MAX_TOUCH_PIXEL_RATIO : MAX_PIXEL_RATIO,
      Math.sqrt(MAX_BUFFER_PIXELS / Math.max(width * height, 1))
    );
    if (
      width === this.width &&
      height === this.height &&
      ratio === this.renderer.getPixelRatio()
    ) {
      return false;
    }
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    return true;
  }

  #handleContextLost = (event: Event) => {
    // Allows the browser to restore the context later
    event.preventDefault();
    this.contextLost = true;
    this.#owner?.onContextChange(true);
  };

  #handleContextRestored = () => {
    this.contextLost = false;
    this.#owner?.onContextChange(false);
  };

  /** Moves the canvas into `host` (first child, below labels). */
  acquire(owner: RendererOwner, host: HTMLElement): void {
    this.#owner = owner;
    if (this.canvas.parentElement !== host) {
      host.prepend(this.canvas);
    }
  }

  isOwner(owner: RendererOwner): boolean {
    return this.#owner === owner;
  }

  release(owner: RendererOwner): void {
    if (this.#owner !== owner) {
      return;
    }
    this.#owner = null;
    this.clear();
    this.canvas.remove();
  }

  clear(): void {
    if (this.contextLost) {
      return;
    }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
  }
}

let shared: ExplorerRenderer | null = null;

/** Throws if WebGL is unavailable. A failed attempt can be retried later. */
export function getExplorerRenderer(): ExplorerRenderer {
  shared ??= new ExplorerRenderer();
  return shared;
}

/** Renderer resource counts, for verifying that scenes clean up after themselves. */
export function getRendererStats(): {
  geometries: number;
  textures: number;
  programs: number;
} | null {
  if (!shared) {
    return null;
  }
  const { memory, programs } = shared.renderer.info;
  return {
    geometries: memory.geometries,
    textures: memory.textures,
    programs: programs?.length ?? 0,
  };
}
