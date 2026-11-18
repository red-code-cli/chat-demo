export class SseHub {
  private readonly closers = new Set<() => void>();

  add(close: () => void): () => void {
    this.closers.add(close);
    return () => {
      this.closers.delete(close);
    };
  }

  closeAll(): void {
    const closers = [...this.closers];
    this.closers.clear();
    for (const close of closers) {
      close();
    }
  }

  get size(): number {
    return this.closers.size;
  }
}
