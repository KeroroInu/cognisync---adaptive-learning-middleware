export class SerializedSaveQueue<T> {
  private promiseRef: Promise<boolean> = Promise.resolve(true);
  private destroyed = false;

  enqueue(saveFn: (data: T) => Promise<boolean>, data: T): Promise<boolean> {
    if (this.destroyed) return Promise.resolve(false);
    const runSave = async () => {
      if (this.destroyed) return false;
      try {
        return await saveFn(data);
      } catch {
        return false;
      }
    };

    this.promiseRef = this.promiseRef.then(runSave).catch(() => runSave());
    return this.promiseRef;
  }

  destroy() {
    this.destroyed = true;
  }
}
