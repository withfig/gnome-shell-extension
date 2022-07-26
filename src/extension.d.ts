
declare global {
  namespace imports {
    namespace gi {
      namespace GLib {

      }

      namespace GObject {
        class Object {
          
        }
      }

      namespace Gio {
        class Cancellable extends imports.gi.GObject.Object {
          private constructor();

          static new(): Cancellable;

          cancel(): void;
          connect(callback: () => void): number;
          is_cancelled(): boolean;
        }
      }
    }
  }
}

type Constructor<T> =
  T extends { new (...arguments: infer A): T }
    ? (...arguments: A) => T
    : never;

type Arguments<F> = F extends (...arguments: infer A) => unknown ? A : never;
type Return<F> = F extends (...arguments: unknown[]) => infer R ? R : never;

type Leading<A> = A extends [ infer T, ...unknown[] ] ? T : never;
type Trailing<A> = A extends [ unknown, ...infer T ] ? T : never;

type Cancellable<T> = { promise: Promise<T>, cancel: () => void };
type Executor<T> = (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void;

type Pipe<T, U> =
  Leading<U> extends (argument: T) => infer V
    ? Pipe<V, Trailing<U>>
    : never;

type Pipeline<T> =
  T extends unknown[]
    ? Leading<T> extends (...arguments: infer U) => infer V
      ? (...arguments: U) => Pipe<V, Trailing<T>>
      : never
    : never;

export function chain(): Promise<void>;
export function chain<T>(value: T): Promise<T>;

export function pipe<T extends unknown[]>(...steps: T): Pipeline<T>;

export function sleep(millis: number): Promise<void>;

export function ordinal(number: number): string;
export function ordinal(...numbers: number[]): string[];

export function fig_socket_address(): string;

export function fig_socket_message_encode(hook: string, object: object): Uint8Array;

export class Cell<T> {
  constructor(initialValue: T);
  public _
}
