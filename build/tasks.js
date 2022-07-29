
///** @public @class */
//export class Barrier {
//  /** @private @property {Set<() => void>} */
//  #resolves = new Set();
//  /** @private @property {number} */
//  #threshhold;
//
//  /** @public @property {number} */
//  get threshold() { return this.#threshhold; }
//
//  /** @public @property {number} */
//  set threshold(threshold) {
//    this.#threshold = threshold;
//    if (this.#resolves.size >= this.#threshhold) {
//      this.#resolves.forEach((resolve) => resolve());
//      this.#resolves.clear();
//    }
//  }
//
//  /** @public @constructor @param {number} threshold */
//  constructor(threshold) {
//    this.#threshhold = threshold;
//  }
//
//  /** @public @async @method @returns {Promise<void>} */
//  async wait() {
//    if (this.#resolves.size + 1 >= this.#threshhold) {
//      this.#resolves.forEach((resolve) => resolve());
//      this.#resolves.clear();
//      return;
//    }
//
//    await new Promise((resolve) => {
//      this.#resolves.add(resolve);
//    });
//  }
//}

/** @public @template T @class */
export class Task {
  /** @private @property {Promise<T>} */
  #promise;

  /** @public @constructor @param {() => Promise<T>} spawner */
  constructor(spawner) {
    this.#promise = spawner();
  }

  /** @public @async @method @returns {Promise<T>} */
  async wait() { return await this.#promise; }
}

/** @public @class */
export class TaskSet {
  /** @private @property @type {Set<Promise<any>>} */
  #tasks = new Set();
  /** @private @property @type {Promise<void>|null} */
  #waiting = null;

  /** @public @method @param {Task<any>} task @returns {void} */
  add(task) {
    this.#tasks.add(task);
  }

  /** @public @async @method @returns {Promise<void>} */
  async wait() {
    if (this.#waiting != null) return await this.#waiting; 

    await (this.#waiting = new Task(async () => {
      while (true) {
        const snapshot = new Set(this.#tasks);
        await Promise.all(snapshot);
        if (snapshot.size == this.#tasks.size) break;
      }
      this.#tasks.clear();
      this.#waiting = null;
    }).wait());
  }
}

