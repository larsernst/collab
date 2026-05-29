import { describe, expect, it } from 'vitest';

import { solveMathInput } from './mathSolver';

describe('solveMathInput', () => {
  it('evaluates arithmetic expressions', () => {
    expect(solveMathInput('2+2')).toEqual({ kind: 'expression', latex: '4' });
  });

  it('evaluates simple LaTeX expressions', () => {
    expect(solveMathInput('\\frac{1}{2}+\\frac{1}{3}')).toEqual({
      kind: 'expression',
      latex: '\\frac{5}{6}',
    });
  });

  it('approximates simple LaTeX expressions', () => {
    expect(solveMathInput('\\frac{1}{2}', 'approximate')).toEqual({
      kind: 'expression',
      latex: '0.5',
    });
  });

  it('solves a linear equation for x', () => {
    expect(solveMathInput('x+1=3')).toEqual({
      kind: 'equation',
      variable: 'x',
      latex: 'x = 2',
    });
  });

  it('formats multiple equation solutions as a set', () => {
    expect(solveMathInput('x^2-4=0')).toEqual({
      kind: 'equation',
      variable: 'x',
      latex: 'x \\in \\left\\{2, - 2\\right\\}',
    });
  });

  it('approximates equation solutions', () => {
    expect(solveMathInput('x^2-2=0', 'approximate')).toEqual({
      kind: 'equation',
      variable: 'x',
      latex: 'x \\approx \\left\\{1.41421356237, -1.41421356237\\right\\}',
    });
  });
});
