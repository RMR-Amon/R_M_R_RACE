/** Unified keyboard + touch input state */
export class Input {
  left = false;
  right = false;
  up = false;
  down = false;
  /** analog steering from touch (-1..1), overrides keys when non-zero */
  touchSteer = 0;
  private fireQueued = false;
  private keys = new Set<string>();
  onPause: (() => void) | null = null;

  private onDown = (e: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter' || e.code === 'ShiftLeft') this.fireQueued = true;
    if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
    this.sync();
  };
  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    this.sync();
  };
  private onBlur = () => {
    this.keys.clear();
    this.sync();
  };

  private sync() {
    const k = this.keys;
    this.left = k.has('ArrowLeft') || k.has('KeyA');
    this.right = k.has('ArrowRight') || k.has('KeyD');
    this.up = k.has('ArrowUp') || k.has('KeyW');
    this.down = k.has('ArrowDown') || k.has('KeyS');
  }

  // touch buttons write directly
  touch = { left: false, right: false, gas: false, brake: false };

  fire() {
    this.fireQueued = true;
  }

  consumeFire() {
    const f = this.fireQueued;
    this.fireQueued = false;
    return f;
  }

  get steer() {
    if (this.touchSteer !== 0) return this.touchSteer;
    const l = this.left || this.touch.left;
    const r = this.right || this.touch.right;
    return (r ? 1 : 0) - (l ? 1 : 0);
  }
  get throttle() {
    return this.up || this.touch.gas ? 1 : 0;
  }
  get brake() {
    return this.down || this.touch.brake ? 1 : 0;
  }

  attach() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }
  detach() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
