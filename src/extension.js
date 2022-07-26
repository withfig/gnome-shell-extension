
const { Gio, GLib } = imports.gi;

const _log_prefix = "Fig GNOME Integration:";

function _cancellable(promise, cancel) {
  return Object.freeze({
    promise,
    cancel,

    then(onresolve, onreject) {
      return _cancellable(promise.then(onresolve, onreject), cancel);
    },

    catch(onreject) {
      return _cancellable(promise.catch(onreject), cancel);
    },
  });
}

/** @type {import("./extension").chain} */
function _chain(value) {
  return Promise.resolve(value);
}

function _maybe_promise(value) {
  if (value instanceof Promsie) {
    return value;
  } else if ("then" in value) {
    return value;
  } else {
    return Promise.resolve(value);
  }
}

function _fig_socket_address() {
  return "/var/tmp/fig/" + GLib.get_user_name() + "/fig.socket";
}

/**
 * @type {import("./extension").fig_socket_message_encode}
 */
function _fig_socket_message_encode(hook, object) {
  const header = "\x1b@fig-json\x00\x00\x00\x00\x00\x00\x00\x00";
  const body = JSON.stringify({ hook: { [hook]: object } });
  
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

/** @type {import("./extension").pipe} */
function _pipe(...steps) {
  return function (...arguments) {
    let result = steps.shift()(...arguments);
    for (const step of steps) {
      result = step(result);
    }
    return result;
  }
}

function _read_to_string(path) {
  return new Promise((resolve, reject) => {
    const file = Gio.File.new_for_path(path);

    // Before we can even read the file, we need to query its size. 
    file.query_info_async(
      "standard::size",
      Gio.QueryInfoFlags.NONE,
      Gio.PRIORITY_NORMAL,
      null,
      (file, result) => {
        try {
          const info = file.query_info_finish(result);
          const size = info.get_attribute_uint64("standard::size");


        } catch (error) {

        }
      },
    );
  });
}

/** @type {import("./extension").sleep} */
function _sleep(millis) {
  return new Promise((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_LOW, millis, () => {
      resolve();
      return false;
    });
  });
}

/** @type {import("./extension").ordinal} */
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

class Cell {
  constructor(initial) {
    this._held_value = initial;
  }

  _get() {
    return this._held_value;
  }

  _set(new_value) {
    const old_value = this._held_value;
    this._held_value = new_value;
    return old_value;
  }

  _update(updater) {
    this._set(updater(this._get()));
  }
}

class Queue {
  static Item = class Item {
    constructor(entry, ...args) {
      this._entry = () => entry(...args);
    }
  };
  
  constructor() {
    this._items = {
      _inner: [ ],
      _onpush: () => {},
    };
    this._running = false;
  }

  push(item) {
    if (!(item instanceof Queue.Item)) {
      throw TypeError("Expected a Queue.Item");
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
          } else if (value instanceof Promise) {
            await value;
          }
        } catch (error) {
          console.log(`${_log_prefix} Uncaught error in Queue: ${error}`);
        }

        item = this._items._inner.shift();
      }

      this._running = false;
    })()

    return this;
  }
}

const State = Object.freeze({
  DISABLED_IDLE: 0,
  ENABLED_IDLE: 1,
  ENABLED_WAIT_FOR_SOCKET: 2,
  ENABLED_CONNECT_TO_SOCKET: 3,
});

class Extension {
  constructor() {
    this._socket = null;
    this._queue = new Queue();
    this._state = State.DISABLED_IDLE;
  }

  enable() {
    this._queue
      .push(new Queue.Item(() => this._wait_for_socket()
        .then(() => _sleep(100))
        .then(() => this._connect_to_socket()))
        .then(() => this._setup_socket()));
  }

  disable() {
    // TODO
  }

  _wait_for_socket() {
    this._state = State.ENABLED_WAIT_FOR_SOCKET;

    let finished = false;

    return _cancellable(
      new Promise((resolve) => {
        const socket_file = Gio.File.new_for_path(_fig_socket_address());
    
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
   * The `console.log` calls in this function are debug-only because they would
   * clutter the up the users journal.
   */
  _connect_to_socket() {
    this._state = State.ENABLED_CONNECT_TO_SOCKET;

    const client = Gio.SocketClient.new();
    const address = Gio.UnixSocketAddress.new(_fig_socket_address());

    const cancel = Gio.Cancellable.new();

    let attempts = 0;
    let finished = false;

    return _cancellable(
      new Promise((resolve, reject) => {
        const attempt = () => {
          if (finished) return;

          attempts++;

          if (DEBUG) console.log(`${_log_prefix} Connecting to socket (${_ordinal(attempts)} try)...`);

          client.connect_async(address, cancel, (client, result) => {
            if (finished) return;

            try {
              this._socket = client.connect_finish(result).get_socket();
              resolve();
              if (DEBUG) console.log(`${_log_prefix} Connected to socket.`);
            } catch (error) {
              if (DEBUG) console.log(`${_log_prefix} Encountered an error while connecting to socket (${_ordinal(attempts)} try). Reason: ${error}`);

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
                  if (DEBUG) console.log(`${_log_prefix} Encountered a fatal error while connecting to socket. Reason: ${error}`);
                  break;
              }
            }
          });
        };

        attempt();
      }),
      () => {
        if (finished) return;
        console.log(`${_log_prefix} Cancelling connection to socket.`);
        finished = true;
        cancel.cancel();
      },
    );
  }

  _setup_socket() {
  }
}

function init() {
  return new Extension();
}
