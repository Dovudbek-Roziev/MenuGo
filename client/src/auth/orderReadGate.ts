/** Keeps reads started before an uncertain status write from confirming its result. */
export class OrderReadGate {
  private sequence = 0;
  private requiredAfter = 0;

  beginRead(): number { return ++this.sequence; }
  invalidate(): void { ++this.sequence; }

  requireVerification(): void {
    this.requiredAfter = ++this.sequence;
  }

  isCurrent(read: number): boolean { return read === this.sequence; }
  mayApply(read: number): boolean { return this.isCurrent(read) && read > this.requiredAfter; }

  confirm(read: number): boolean {
    if (!this.mayApply(read)) return false;
    this.requiredAfter = 0;
    return true;
  }

  get verificationRequired(): boolean { return this.requiredAfter !== 0; }
}
