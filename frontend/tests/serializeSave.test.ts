import { describe, it, expect } from 'vitest';
import { SerializedSaveQueue } from '../utils/serializeSave';

describe('SerializedSaveQueue', () => {
  it('serializes saves properly', async () => {
    const queue = new SerializedSaveQueue<number>();
    
    let activeSaves = 0;
    const history: number[] = [];

    const saveFn = async (data: number) => {
      activeSaves++;
      expect(activeSaves).toBe(1); // Ensure no concurrent execution
      
      // Delay to simulate async I/O
      await new Promise(resolve => setTimeout(resolve, 10));
      history.push(data);
      activeSaves--;
      return data % 2 === 0; // Succeed for even, fail for odd
    };

    const p1 = queue.enqueue(saveFn, 1);
    const p2 = queue.enqueue(saveFn, 2);
    
    const [r1, r2] = await Promise.all([p1, p2]);
    
    expect(r1).toBe(false);
    expect(r2).toBe(true);
    expect(history).toEqual([1, 2]);
  });
});
