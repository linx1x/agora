/** Token bucket: `rate` tokens per second, burst `burst`. */
export class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private rate: number,
    private burst: number,
  ) {
    this.tokens = burst;
  }
  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
