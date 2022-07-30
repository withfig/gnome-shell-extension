/// Yes, this has to be a reference path. for whatever reason, using a jsdoc
/// comment leaves the destructured members of `imports.gi` as `any`.
/// <reference path="../types/index.d.ts"/>

const { Gio, GLib, GObject, Meta } = imports.gi;

const _PREFIX = "Fig GNOME Integration:";

/**
 * Creates a `PromiseLike<T>` that can be cancelled by calling its `cancel`
 * method.
 * 
 * ### Example
 * 
 * ```js
 * const my_non_cancellable_promise = sleep(5000).then(() => 123);
 * 
 * const my_cancellable_promise = (() => {
 *   let cancelled = false;
 *   return cancellable(
 *     new Promise((resolve) => sleep(3000).then(() => !cancelled && resolve(456))),
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
function cancellable(promise, cancel) {
  return Object.freeze(Object.assign(Object.create(null), {
    promise,
    cancel,

    then(onresolve, onreject) {
      return cancellable(promise.then(onresolve, onreject), cancel);
    },

    catch(onreject) {
      return cancellable(promise.catch(onreject), cancel);
    },
  }));
}

/**
 * 
 * @template K
 * @template V
 * @param {Map<K, V>} map 
 * @param {K} key 
 * @param {() => V} or_else
 * @returns {V} 
 */
function map_get_or_else_set(map, key, or_else) {
  const value = map.get(key) ?? or_else();
  map.set(key, value);
  return value;
}

/**
 * Returns one or more numbers as strings, with their ordinal suffixes.
 * 
 * ### Example
 * 
 * ```js
 * console.log(ordinal(1, 2, 3, 4, 5)); // logs "[ '1st', '2nd', '3rd', '4th', '5th' ]"
 * ```
 * 
 * @private
 * @function
 * @template {number|number[]} N
 * @param {N} numbers The number(s) to format.
 * @returns {N extends [number, number, ...number[]] ? string[] : string} The formatted number(s).
 */
 function ordinal(...numbers) {
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
    return numbers.map(ordinal);
  }
}

/**
 * @returns {string} The location of the users Fig socket.
 */
function socket_address() {
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
function socket_encode(hook, payload) {
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
function sleep(millis) {
  return new Promise((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_LOW, millis, () => {
      resolve();
      return false;
    });
  });
}

/**
 * Manages execution of promises in order.
 */
class Queue {
  /**
   * A unit of work that can be started by a `Queue`.
   * 
   * If the `Queue.Item` returns a `PromiseLike<any> & CancellableLike` (IE a
   * value returned from `cancellable`), then the `Queue` will call the values
   * `cancel` method and start the next `Queue.Item` if there are more
   * `Queue.Items` in the `Queue` waiting to be started.
   * 
   * @public
   * @static
   * @property
   * 
   * @see Queue
   * @see cancellable
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
  push(item) {
    if (!(item instanceof Queue.Item)) {
      throw TypeError(`Expected a Queue.Item`);
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
            
            if (this._items._inner.length == 0) {
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
    /** @type {Map<import("../types/.gobject").Object, Set<number>>} */
    this._connections = new Map();
    /** @type {import("../types/.gobject").Object|null} */
    this._cursor = null;
    /** @type {import("../types/.gio").Socket|null} */
    this._socket = null;
    /** @type {Queue} */
    this._queue = new Queue();
    /** @type {import("../types/.gobject").Object|null} */
    this._window = null;
  }

  enable() {
    this._queue
      .push(new Queue.Item(() => this._wait_for_socket()
        .then(() => sleep(100))
        .then(() => this._connect_to_socket())
        .then(() => this._connect_to_mutter())));
  }

  disable() {
    // TODO
  }

  _wait_for_socket() {
    let finished = false;

    return cancellable(
      new Promise((resolve) => {
        const socket_file = Gio.File.new_for_path(socket_address());
    
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
    const address = Gio.UnixSocketAddress.new(socket_address());

    const cancel = Gio.Cancellable.new();

    let attempts = 0;
    let finished = false;

    return cancellable(
      new Promise((resolve, reject) => {
        if (!DEBUG) console.log(`${_PREFIX} Connecting to socket...`);

        const attempt = () => {
          if (finished) return;

          attempts++;

          if (DEBUG) console.log(`${_PREFIX} Connecting to socket (${ordinal(attempts)} try)...`);

          client.connect_async(address, cancel, (client, result) => {
            if (finished) return;

            try {
              this._socket = client.connect_finish(result).get_socket();
              resolve();
              console.log(`${_PREFIX} Connected to socket!`);
            } catch (error) {
              if (DEBUG) console.log(`${_PREFIX} Encountered an error while connecting to socket (${ordinal(attempts)} try). Reason: ${error}`);

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
        console.log(`${_PREFIX} Cancelling connection to socket...`);
        finished = true;
        cancel.cancel();
      },
    );
  }

  /**
   * 
   */
  _connect_to_mutter() {
    console.log(`${_PREFIX} Connecting to mutter...`);

    // Get the set of connections associated with the global MetaDisplay object,
    // or make a set if it doesn't exist already.
    const global_display_connections = map_get_or_else_set(
      this._connections,
      global.display,
      () => new Set(),
    );

    // Subscribe to receive updates when the global `MetaDisplay` "focus-window"
    // property changes.
    global_display_connections.add(
      global.display.connect("notify::focus-window", () => {
        if (this._window != window) {
          this._disconnect_from_window();
          this._window = global.display.focus_window;
          this._connect_to_window();
        }
      }),
    );

    // Subscribe to be notified when a new grab operaption begins.
    // This is needed because neither GNOME shell or mutter expose a signal that
    // is fired when a `MetaWindow` is moved. So, the solution is to subscribe
    // to the display when a grab operation starts; AKA when the user starts
    // moving around a window, and then updating the window data whenever the
    // cursor moves until the grab operation ends.
    global_display_connections.add(
      global.display.connect("grab-op-begin", (_, __, grab_op) => {
        if (grab_op == Meta.GrabOp.MOVING || grab_op == Meta.GrabOp.KEYBOARD_MOVING) {
          if (window != this._window) {
            this._disconnect_from_window();
            this._window = global.display.focus_window;
            this._connect_to_window();
          }

          this._cursor = Meta.CursorTracker.get_for_display(global.display);
          this._connect_to_cursor();

          const global_display_connection = global.display.connect("grab-op-end", () => {
            global.display.disconnect(global_display_connection);
            global_display_connections.delete(global_display_connection);

            this._disconnect_from_cursor();
            this._cursor = null;
          });

          global_display_connections.add(global_display_connection);
        }
      }),
    );

    console.log(`${_PREFIX} Connected to mutter!`);
  }

  _connect_to_window() {
    if (this._window == null) return;

    this._send_window_data();
    
    const window_connections = map_get_or_else_set(
      this._connections,
      this._window,
      () => new Set(),
    );
    
    window_connections.add(
      this._window.connect("size-changed", () => this._send_window_data()),
    );
  }

  _connect_to_cursor() {
    if (this._cursor == null) return;

    const cursor_connections = map_get_or_else_set(
      this._connections,
      this._cursor,
      () => new Set(),
    );

    cursor_connections.add(
      this._cursor.connect("position-invalidated", () => this._send_window_data()),
    );
  }

  _disconnect_from_window() {
    const window_connections = this._connections.get(this._window);

    if (window_connections != null) {
      for (const window_connection of window_connections) {
        this._window.disconnect(window_connection);
      }

      this._connections.delete(this._window);
    }
  }

  _disconnect_from_cursor() {
    const cursor_connections = this._connections.get(this._cursor);
  
    if (cursor_connections != null) {
      for (const cursor_connection of cursor_connections) {
        this._cursor.disconnect(cursor_connection);
      }

      this._connections.delete(this._cursor);
    }
  }

  _send_window_data() {
    const wm_class = this._window.get_wm_class();
    const frame_rect = this._window.get_frame_rect();

    this._socket.send(socket_encode("focusedWindowData", {
      "id": wm_class,
      "x": frame_rect.x,
      "y": frame_rect.y,
      "width": frame_rect.width,
      "height": frame_rect.height,
    }), null);
  }
}

function init() {
  return new Extension();
}
