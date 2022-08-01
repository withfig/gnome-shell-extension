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
 * @param {() => void} cancel A function that will be called when the returned
 * objects `cancel` method is called.
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
 * Attempts to get the `V` associated with `key` from the `map`, returning the
 * 
 * If the `key` is not present in the `map`, then `or_else` is called, and its
 * return value is used to set `key` in the map, and is returned.
 * 
 * ### Examples
 * 
 * ```js
 * const my_map = new Map();
 * 
 * const my_first_value = map_get_or_else_set(my_map, "foo", () => new Set());
 * 
 * console.log(my_first_value.size); // logs 0
 * 
 * my_first_value.add(123);
 * 
 * const my_second_value = map_get_or_else_set(my_map, "foo", () => new Set());
 * 
 * console.log(my_second_value.has(123)); // logs true
 * console.log(my_first_value == my_second_value); // logs true
 * 
 * const my_third_value = map_get_or_else_set(my_map, "bar", () => new Set());
 * 
 * console.log(my_second_value == my_third_value); // logs false
 * ```
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
      return `${number}${suffixes[number % 100] ?? "th"}`;
    } else {
      return `${number}${suffixes[number % 10] ?? "th"}`;
    }
  } else {
    return numbers.map(ordinal);
  }
}

/**
 * Returns the location of the Fig socket.
 * 
 * @private
 * @function
 * @returns {string} The location of the Fig socket.
 */
function socket_address() {
  return `/var/tmp/fig/${GLib.get_user_name()}/fig.socket`;
}

/**
 * Converts a message to the format that the Fig socket expects.
 * 
 * @private
 * @function
 * @param {string} hook The hook that the payload is for.
 * @param {object} payload The payload of the message.
 * @returns {Uint8Array} The converted message.
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
 * Returns a promise that will resolve after roughly the specified amount of
 * milliseconds.
 * 
 * @private
 * @function
 * @param {number} millis
 * @returns {PromiseLike<void>}
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
 * A utility class used to manage the execution of promises.
 * 
 * In the context of this extension, it is used to ensure that the extension
 * never enters an invalid state by only allowing execution of one promise at
 * a time, but skipping cancellable promises if there are more promises that
 * need to be started.
 * 
 * All of these promises are wrapped using the `Queue.Item` class.
 * 
 * @private
 * @class
 */
class Queue {
  /**
   * A unit of work that can be started by a `Queue`.
   * 
   * @public
   * @static
   * @property
   */
  static Item = class Item {
    /**
     * Creates a new `Queue.Item`.
     * 
     * If `entry` returns a cancellable promise-like object, then the queue will
     * cancel this item if there are other items waiting to be started.
     * 
     * @public
     * @constructor
     * @template {any[]} A
     * @param {(...A) => PromiseLike<any>} entry A function to be called when
     * the item is started.
     * @param  {...A} args One or more values to be passed to `entry` when the
     * item is started.
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
   * Pushes an `item` to the queue.
   * 
   * If the queue **is already running**, it will attempt to cancel the
   * currently running `Queue.Item`, if possible.
   * 
   * If the queue **is not already running**, it will quietly start the queue
   * in the background and begin running its items.
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
 * The main class for managing the extensions state.
 */
class Extension {
  /** @private @property @type {Map<import("../types/.gobject").Object, Set<number>>} */
  #connections;
  /** @private @property @type {import("../types/.gobject").Object|null} */
  #cursor;
  /** @private @property @type {import("../types/.gio").Socket|null} */
  #socket;
  /** @private @property @type {Queue} */
  #queue;
  /** @private @property @type {import("../types/.gobject").Object|null} */
  #window;

  /**
   * Initializes the extension, without enabling it.
   * 
   * @public @constructor
   */
  constructor() {
    this.#connections = new Map();
    this.#cursor = null;
    this.#socket = null;
    this.#queue = new Queue();
    this.#window = null;
  }

  /**
   * Enables the extension, starting to connect to the Fig socket and mutter
   * quietly in the background.
   * 
   * @public @method @returns {void}
   */
  enable() {
    this.#queue
      .push(new Queue.Item(() => sleep(100)
        .then(() => this.#connect_to_socket())
        .then(() => this.#connect_to_mutter())));
  }

  /**
   * Disables the extension. Note that this waits for the extension to finish
   * becoming enabled if it is in the process of doing so. This prevents the
   * extension from crashing if the user spams the extension enable/disable
   * switch.
   * 
   * @public @method @returns {void}
   */
  disable() {
    this.#queue
      .push(new Queue.Item(() => this.#disconnect_from_cursor()
        .then(() => this.#disconnect_from_window())
        .then(() => this.#disconnect_from_mutter())
        .then(() => this.#disconnect_from_socket())));
  }

  /**
   * Repeatedly tries to connect to the Fig socket, ignoring errors, until it
   * either successfully connects or is cancelled. In debug mode, the errors are
   * also logged to the console.
   * 
   * The method starts off with trying to connect once every two and a half
   * seconds, moving to five seconds after three attempts, and then moving to
   * ten seconds after nine attempts. This is done to avoid using too much CPU
   * when Fig isn't running.
   * 
   * @returns {Promise<void> & { cancel: () => void, promise: Promise<void> }}
   */
  #connect_to_socket() {
    const client = Gio.SocketClient.new();
    const address = Gio.UnixSocketAddress.new(socket_address());

    const cancel = Gio.Cancellable.new();

    let attempts = 0;
    let finished = false;

    return cancellable(
      new Promise((resolve) => {
        if (!DEBUG) console.log(`${_PREFIX} Connecting to socket...`);

        const attempt = () => {
          if (finished) return;

          attempts++;

          if (DEBUG) console.log(`${_PREFIX} Connecting to socket (${ordinal(attempts)} try)...`);

          client.connect_async(address, cancel, (client, result) => {
            if (finished) return;

            try {
              this.#socket = client.connect_finish(result).get_socket();
              this.#socket.set_blocking(false);

              resolve();

              console.log(`${_PREFIX} Connected to socket!`);
            } catch (error) {
              if (DEBUG) console.log(`${_PREFIX} Encountered an error while connecting to socket (${ordinal(attempts)} try). Reason: ${error}`);

              const timeout = attempts < 3 ? 2500 : attempts < 9 ? 5000 : 10000;

              GLib.timeout_add(GLib.PRIORITY_LOW, timeout, () => {
                attempt();
                return false;
              });
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
   * Connects to all of the signals that this extension uses from mutter.
   * 
   * The connection ids are stored in a map so that they may be disconnected
   * later to ensure garbage collection.
   * 
   * @returns {void}
   */
  #connect_to_mutter() {
    console.log(`${_PREFIX} Connecting to mutter...`);

    // Get the set of connections associated with the global MetaDisplay object,
    // or make a set if it doesn't exist already.
    const global_display_connections = map_get_or_else_set(
      this.#connections,
      global.display,
      () => new Set(),
    );

    // Subscribe to receive updates when the global `MetaDisplay` "focus-window"
    // property changes.
    global_display_connections.add(
      global.display.connect("notify::focus-window", () => {
        if (this.#window != window) {
          this.#disconnect_from_window();
          this.#window = global.display.focus_window;
          this.#connect_to_window();
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
          if (window != this.#window) {
            this.#disconnect_from_window();
            this.#window = global.display.focus_window;
            this.#connect_to_window();
          }

          this.#cursor = Meta.CursorTracker.get_for_display(global.display);
          this.#connect_to_cursor();

          const global_display_connection = global.display.connect("grab-op-end", () => {
            global.display.disconnect(global_display_connection);
            global_display_connections.delete(global_display_connection);

            this.#disconnect_from_cursor();
            this.#cursor = null;
          });

          global_display_connections.add(global_display_connection);
        }
      }),
    );

    console.log(`${_PREFIX} Connected to mutter!`);
  }

  /**
   * Connects to the currently focused windows resize signals.
   * 
   * If there is not currently a focused window, this method early-exits.
   * 
   * The connection ids are stored in a map so that they may be disconnected
   * later to ensure garbage collection.
   * 
   * @returns {void}
   */
  #connect_to_window() {
    if (this.#window == null) return;

    this.#send_window_data();
    
    const window_connections = map_get_or_else_set(
      this.#connections,
      this.#window,
      () => new Set(),
    );
    
    window_connections.add(
      this.#window.connect("size-changed", () => this.#send_window_data()),
    );
  }

  /**
   * Connects to the position invalidated signal of the current cursor.
   * 
   * If there is not currently a cursor, this method early-exits.
   * 
   * The connection ids are stored in a map so that they may be disconnected
   * later to ensure garbage collection.
   * 
   * @returns {void}
   */
  #connect_to_cursor() {
    if (this.#cursor == null) return;

    const cursor_connections = map_get_or_else_set(
      this.#connections,
      this.#cursor,
      () => new Set(),
    );

    cursor_connections.add(
      this.#cursor.connect("position-invalidated", () => this.#send_window_data()),
    );
  }

  #disconnect_from_socket() {
    try {
      if (this.#socket == null) return Promise.resolve();

      console.log(`${_PREFIX} Disconnecting from socket...`);

      this.#socket.close();
      this.#socket = null;

      console.log(`${_PREFIX} Disconnected from socket.`);

      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #disconnect_from_mutter() {
    try {
      console.log(`${_PREFIX} Disconnecting from mutter...`);

      for (const [object, connections] of this.#connections) {
        for (const connection of connections) {
          object.disconnect(connection);
        }
        connections.clear();
      }
      this.#connections.clear();

      console.log(`${_PREFIX} Disconnected from mutter.`);

      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #disconnect_from_window() {
    try {
      if (this.#window == null) return Promise.resolve();

      const window_connections = this.#connections.get(this.#window);

      if (window_connections != null) {
        for (const window_connection of window_connections) {
          this.#window.disconnect(window_connection);
        }

        this.#connections.delete(this.#window);
      }

      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #disconnect_from_cursor() {
    try {
      if (this.#cursor == null) return Promise.resolve();

      const cursor_connections = this.#connections.get(this.#cursor);
    
      if (cursor_connections != null) {
        for (const cursor_connection of cursor_connections) {
          this.#cursor.disconnect(cursor_connection);
        }

        this.#connections.delete(this.#cursor);
      }

      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #send_window_data() {
    const wm_class = this.#window.get_wm_class();
    const frame_rect = this.#window.get_frame_rect();

    this.#socket.send(socket_encode("focusedWindowData", {
      "id": wm_class,
      "x": frame_rect.x,
      "y": frame_rect.y,
      "width": frame_rect.width,
      "height": frame_rect.height,
    }), null);
  }
}

/**
 * Initializes the extension, without enabling it, and returns it. This function
 * is expected to be in the toplevel of every extension.
 * 
 * @returns {Extension}
 */
function init() {
  return new Extension();
}
