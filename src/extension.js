const { Gio, GLib } = imports.gi;

const _PREFIX = "Fig GNOME Integration:";

/**
 * Creates a `PromiseLike<T>` that can be cancelled by calling its `cancel`
 * method.
 * 
 * ### Example
 * 
 * ```js
 * const my_non_cancellable_promise = _sleep(5000).then(() => 123);
 * 
 * const my_cancellable_promise = (() => {
 *   let cancelled = false;
 *   return _cancellable(
 *     new Promise((resolve) => _sleep(3000).then(() => !cancelled && resolve(456))),
 *     () => cancelled = true,
 *   );
 * })();
 * 
 * my_cancellable_promise.cancel();
 * 
 * Promise.race([ my_non_cancellable_promise, my_cancellable_promise ]).then((result) => {
 *   // will always log 123, despite my_non_cancellable_promise sleeping for
 *   // longer, because my_cancellable_promise will never resolve since it was
 *   // cancelled.
 *   console.log(result);
 * });
 * ```
 * 
 * @private
 * @function
 * @template T
 * @param {PromiseLike<T>} promise A promise that is garunteed by the caller to
 * stop execution when `cancel` is called.
 * @param {() => void} cancel
 * @returns {PromiseLike<T> & { promise: PromiseLike<T>, cancel: () => void }}
 * A `PromiseLike<T>` that can be cancelled.
 */
function _cancellable(promise, cancel) {
  return Object.freeze(Object.assign(Object.create(null), {
    promise,
    cancel,

    then(onresolve, onreject) {
      return _cancellable(promise.then(onresolve, onreject), cancel);
    },

    catch(onreject) {
      return _cancellable(promise.catch(onreject), cancel);
    },
  }));
}

/**
 * A purely syntatical function that allows you to create a new chain of
 * promises from an optional value.
 * 
 * More or less an alias for `Promise.resolve`.
 * 
 * ### Example
 * 
 * ```js
 * _chain()
 *   .then(() => _sleep(100))
 *   .then(() => console.log("slept for 100 milliseconds!"));
 * ```
 * 
 * @private
 * @function
 * @template T
 * @param {T} value
 * @returns {PromiseLike<T extends undefined ? void : T>}
 */
function _chain(value) {
  return Promise.resolve(value);
}

/**
 * @returns {string} The location of the users Fig socket.
 */
function _socket_address() {
  return `/var/tmp/fig/${GLib.get_user_name()}/fig.socket`;
}

/**
 * Encodes the provided payload for it to be sent to Fig.
 * 
 * @private
 * @function
 * @param {string} hook The hoot that the message is for.
 * @param {object} payload The payload of the message.
 * @returns {Uint8Array} The encoded message.
 */
function _socket_encode(hook, payload) {
  const header = "\x1b@fig-json\x00\x00\x00\x00\x00\x00\x00\x00";
  const body = JSON.stringify({ hook: { [hook]: payload } });
  
  const message = new TextEncoder().encode(header + body);

  // I'd use a Uint32Array pointing to the same buffer to do this, but the
  // length part of the header is misaligned by two bytes...
  let length = body.length << 0;
  for (let i = 0; i < 4; i++) {
    const byte = length & 0xff;
    message[header.length - i - 1] = byte;
    length = (length - byte) / 256;
  }

  return message;
}

/**
 * @private
 * @function
 * @param {number} millis The number of milliseconds to sleep for.
 * @returns {PromiseLike<void>} A `PromiseLike<void>` that will resolve after
 * the specified number of milliseconds.
 */
function _sleep(millis) {
  return new Promise((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_LOW, millis, () => {
      resolve();
      return false;
    });
  });
}

/**
 * Returns one or more numbers as strings, with their ordinal suffixes.
 * 
 * ### Example
 * 
 * ```js
 * console.log([ 1, 2, 3, 4, 5 ]); // logs "[ '1st', '2nd', '3rd', '4th', '5th' ]"
 * ```
 * 
 * @private
 * @function
 * @template {number|number[]} N
 * @param {N} numbers The number(s) to format.
 * @returns {N extends [number, number, ...number[]] ? string[] : string} The formatted number(s).
 */
function _ordinal(...numbers) {
  if (numbers.length == 1) {
    const number = numbers[0];

    const suffixes = {
      1: "st",
      2: "nd",
      3: "rd",
    };

    if (number % 100 < 20) {
      return `${number}${suffixes[number % 100]}`;
    } else {
      return `${number}${suffixes[number % 10]}`;
    }
  } else {
    return numbers.map(_ordinal);
  }
}

/**
 * Manages execution of promises in order.
 */
class Queue {
  /**
   * A unit of work that can be started by a `Queue`.
   * 
   * If the `Queue.Item` returns a `PromiseLike<any> & CancellableLike` (IE a
   * value returned from `_cancellable`), then the `Queue` will call the values
   * `cancel` method and start the next `Queue.Item` if there are more
   * `Queue.Items` in the `Queue` waiting to be started.
   * 
   * @public
   * @static
   * @property
   * 
   * @see Queue
   * @see _cancellable
   */
  static Item = class Item {
    /**
     * @public
     * @constructor
     * @template {any[]} A
     * @param {(...A) => PromiseLike<any>} entry 
     * @param  {...A} args 
     */
    constructor(entry, ...args) {
      this._entry = () => entry(...args);
    }
  };
  
  /**
   * Creates a new empty queue without starting it.
   * 
   * @public
   * @constructor
   */
  constructor() {
    /** @type {{ _inner: Queue.Item[], _onpush: () => void }} */
    this._items = {
      _inner: [ ],
      _onpush: () => {},
    };
    /** @type {boolean} */
    this._running = false;
  }

  /**
   * Pushes a `Queue.Item` to the queue and starts the queue if it isn't
   * running.
   * 
   * @public
   * @method
   * @param {Queue.Item} item The item to push to the queue.
   * @returns {this} for daisy chaining.
   * @throws {TypeError} if `item` is not not an instance of `Queue.Item`.
   */
  _push(item) {
    if (!(item instanceof Queue.Item)) {
      throw TypeError(`Expected a ${Queue.name}.${Queue.Item.name}`);
    }

    this._items._inner.push(item);
    
    if (this._running) {
      this._items._onpush();
      return this;
    }

    (async () => {
      this._running = true;

      let item = this._items._inner.shift();
      while (!!item) {
        try {
          const value = item._entry();

          if ("cancel" in value && "promise" in value) {
            const { promise, cancel } = value;
            
            if (this._items.length == 0) {
              await Promise.race([
                promise,
                new Promise((resolve) => {
                  this._items._onpush = () => {
                    cancel();
                    resolve();
                    this._items._onpush = () => {};
                  };
                })
              ]);

              this._items._onpush = () => {};
            } else {
              cancel();
            }
          } else if (value instanceof Promise) {
            await value;
          }
        } catch (error) {
          console.log(`${_PREFIX} Uncaught error in Queue: ${error}`);
        }

        item = this._items._inner.shift();
      }

      this._running = false;
    })()

    return this;
  }
}

/**
 * 
 */
class Extension {
  constructor() {
    this._socket = null;
    this._queue = new Queue();
  }

  enable() {
    this._queue
      ._push(new Queue.Item(() => this._wait_for_socket()
        .then(() => _sleep(100))
        .then(() => this._connect_to_socket()))
        .then(() => this._connect_to_mutter()));
  }

  disable() {
    // TODO
  }

  _wait_for_socket() {
    let finished = false;

    return _cancellable(
      new Promise((resolve) => {
        const socket_file = Gio.File.new_for_path(_socket_address());
    
        GLib.timeout_add(GLib.PRIORITY_LOW, 5000, () => {
          if (finished) return false;
    
          if (socket_file.query_exists(null)) {
            resolve();
            return false;
          }
    
          return true;
        });
      }),
      () => finished = true,
    );
  }

  /**
   * 
   */
  // The `console.log` calls in this function are debug-only because they would
  // clutter (no pun intended) up the users journal.
  _connect_to_socket() {
    const client = Gio.SocketClient.new();
    const address = Gio.UnixSocketAddress.new(_socket_address());

    const cancel = Gio.Cancellable.new();

    let attempts = 0;
    let finished = false;

    return _cancellable(
      new Promise((resolve, reject) => {
        if (!DEBUG) console.log(`${_PREFIX} Connecting to socket...`);

        const attempt = () => {
          if (finished) return;

          attempts++;

          if (DEBUG) console.log(`${_PREFIX} Connecting to socket (${_ordinal(attempts)} try)...`);

          client.connect_async(address, cancel, (client, result) => {
            if (finished) return;

            try {
              this._socket = client.connect_finish(result).get_socket();
              resolve();
              console.log(`${_PREFIX} Connected to socket.`);
            } catch (error) {
              if (DEBUG) console.log(`${_PREFIX} Encountered an error while connecting to socket (${_ordinal(attempts)} try). Reason: ${error}`);

              switch (error) {
                case Gio.IOErrorEnum.BUSY:
                case Gio.IOErrorEnum.CONNECTION_REFUSED:
                case Gio.IOErrorEnum.TIMED_OUT:
                  Gio.timeout_add(GLib.PRIORITY_LOW, attempts < 3 ? 5000 : 10000, () => {
                    attempt();
                    return false;
                  });
                  break;
                default:
                  reject(error);
                  if (DEBUG) console.log(`${_PREFIX} Encountered a fatal error while connecting to socket. Reason: ${error}`);
                  break;
              }
            }
          });
        };

        attempt();
      }),
      () => {
        if (finished) return;
        console.log(`${_PREFIX} Cancelling connection to socket.`);
        finished = true;
        cancel.cancel();
      },
    );
  }

  /**
   * 
   */
  _connect_to_mutter() {
  }
}

function init() {
  return new Extension();
}
