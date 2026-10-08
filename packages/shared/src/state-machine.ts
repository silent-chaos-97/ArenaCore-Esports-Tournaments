export type Transitions<S extends string> = { readonly [K in S]: readonly S[] };

export class InvalidTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid ${machine} transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export interface StateMachine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly transitions: Transitions<S>;
}

export function defineMachine<S extends string>(
  name: string,
  transitions: Transitions<S>,
): StateMachine<S> {
  return { name, states: Object.keys(transitions) as S[], transitions };
}

export function canTransition<S extends string>(machine: StateMachine<S>, from: S, to: S): boolean {
  return machine.transitions[from].includes(to);
}

export function assertTransition<S extends string>(machine: StateMachine<S>, from: S, to: S): void {
  if (!canTransition(machine, from, to)) throw new InvalidTransitionError(machine.name, from, to);
}
