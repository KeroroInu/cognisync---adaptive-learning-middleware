import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { freeProgramNamespace, createGameHarness } from '../services/pythonModuleRunner';

const python = process.env.COGNISYNC_TEST_PYTHON || 'python3';
const run = (source: string) => execFileSync(python, ['-c', source], { encoding: 'utf8', timeout: 5000 });
const report = (source: string) => `${source}\nprint(json.dumps(_free_report))`;
describe('ordinary group Python program', () => {
  it('runs helpers, math/random and bounded print', () => {
    const output = run(freeProgramNamespace('import math\nimport random\ndef twice(n):\n    return n * 2\nprint(twice(3), math.sqrt(9), random.randint(1, 1))') + '\nprint("".join(_free_lines))');
    expect(output.trim()).toBe('6 3.0 1');
  });
  it.each(['import js', 'import os', 'print((1).__class__)', 'open("secret")'])('rejects %s', code => {
    expect(() => run(freeProgramNamespace(code))).toThrow();
  });
  it('uses student initialization and game loop instead of a demo', () => {
    const code = 'def create_initial_state():\n    return [(3, 5), (2, 5)], "right", 100\ndef step_game(state, user_input):\n    x, y = state["snake"][0]\n    state["snake"] = [(x + 1, y)] + state["snake"][:-1]\n    print("step", state["score"])\n    return state';
    const bundle = { 'free-program': code };
    const initial = JSON.parse(run(report(createGameHarness('reset', bundle))));
    expect(initial.state.score).toBe(100);
    const stepped = JSON.parse(run(report(createGameHarness('step', bundle, initial.state))));
    expect(stepped.state.snake[0]).toEqual([4, 5]);
    expect(stepped.state.score).toBe(100);
    expect(stepped.output).toEqual(['step 100']);
  });
  it('bounds accumulated output', () => {
    expect(Number(run(freeProgramNamespace('for i in range(10000):\n    print("x" * 100)') + '\nprint(len("".join(_free_lines)))').trim())).toBeLessThanOrEqual(16000);
  });
});
