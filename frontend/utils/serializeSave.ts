export class SerializedSaveQueue<T> {
  private promiseRef: Promise<boolean> = Promise.resolve(true);

  enqueue(saveFn: (data: T) => Promise<boolean>, data: T): Promise<boolean> {
    const runSave = async () => {
      try {
        return await saveFn(data);
      } catch {
        return false;
      }
    };
    
    this.promiseRef = this.promiseRef.then(runSave).catch(() => runSave());
    return this.promiseRef;
  }
}
