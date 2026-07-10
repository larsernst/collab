declare module 'nerdamer/all' {
  interface NerdamerExpression {
    buildFunction(variables: string[]): (...args: number[]) => number;
    evaluate(values?: Record<string, string | number>): NerdamerExpression;
    latex(): string;
    text(): string;
  }

  interface NerdamerStatic {
    (expression: string): NerdamerExpression;
    convertFromLaTeX(expression: string): NerdamerExpression;
    solveEquations(equation: string, variable?: string): unknown;
  }

  const nerdamer: NerdamerStatic;
  export default nerdamer;
}
