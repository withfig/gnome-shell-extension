/// Yes, this has to be a reference path. for whatever reason, using a jsdoc
/// comment leaves the destructured members of `imports.gi` as `any`.
/// <reference path="../types/index.d.ts"/>

const { Clutter, Gio, GLib, GObject, Meta, St } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

const Me = ExtensionUtils.getCurrentExtension();
const { log, resource, socket_address, socket_encode } = Me.imports.common;

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
 * Returns a promise that will resolve after roughly the specified amount of
 * milliseconds.
 * 
 * @private
 * @function
 * @param {number} millis
 * @returns {PromiseLike<void>}
 */
function sleep(millis) {
  let cancelled = false;
  return cancellable(
    new Promise((resolve) => {
      GLib.timeout_add(GLib.PRIORITY_LOW, millis, () => {
        if (!cancelled) resolve();
        return false;
      });
    }),
    () => cancelled = true,
  );
}

/**
 * The main class for managing the extensions state.
 */
class Extension extends GObject.Object {
  /** @public @property @type {boolean} */
  get connected() { return this.#connected; }

  /** @private @property @type {boolean} */
  #connected;
  /** @private @property @type {import("../types/.gobject").Binding|null} */
  #connected_binding;
  /** @private @property @type {boolean} */
  #connecting;
  /** @private @property @type {Map<import("../types/.gobject").Object, Set<number>>} */
  #connections;
  /** @private @property @type {boolean} */
  #disconnecting;
  /** @private @property @type {PanelIcon|null} */
  #panel_icon;
  /** @private @property @type {import("../types/.gio").Resource|null} */
  #resources;
  /** @private @property @type {import("../types/.gio").Settings|null} */
  #settings;
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
  _init() {
    super._init();

    this.#connected = false;
    this.#connected_binding = null;
    this.#connecting = false;
    this.#connections = new Map();
    this.#disconnecting = false;
    this.#panel_icon = null;
    this.#resources = null;
    this.#settings = null;
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
    // Load and register resource files.
    this.#resources = Gio.Resource.load(`${Me.path}/resources/fig-gnome-integration.gresource`);
    Gio.resources_register(this.#resources);

    // Get the settings object.
    this.#settings = ExtensionUtils.getSettings();

    // Watch for the user changing the "show-panel-icon" preference.
    this.#connect_to_object(this.#settings, "changed::show-panel-icon", () => {
      if (this.#settings.get_boolean("show-panel-icon")) {
        // If the panel icon doesn't exist, create it and bind the connected
        // property, then add it to the panel.
        if (this.#panel_icon == null) {
          this.#panel_icon = new PanelIcon({
            connected: this.#connected,
          });
          this.#connected_binding = this.bind_property(
            "connected",
            this.#panel_icon,
            "connected",
            GObject.BindingFlags.DEFAULT);
        }
        Main.panel.addToStatusArea("Fig", this.#panel_icon, 0, "right");
      } else {
        // If the panel icon exists, destroy it.
        if (this.#panel_icon != null) {
          this.#connected_binding.unbind();
          this.#connected_binding = null;
          this.#panel_icon.destroy();
          this.#panel_icon = null;
        }
      }
    });

    if (this.#settings.get_boolean("show-panel-icon")) {
      this.#panel_icon = new PanelIcon({
        connected: this.#connected,
      });
      this.#connected_binding = this.bind_property(
        "connected",
        this.#panel_icon,
        "connected",
        GObject.BindingFlags.DEFAULT);
      Main.panel.addToStatusArea("Fig", this.#panel_icon, 0, "right");
    }

    this.#connect();
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
    // Unregister the resource files.
    Gio.resources_unregister(this.#resources);
    this.#resources = null;

    // Disconnect from and delete the settings object.
    this.#disconnect_from_object(this.#settings);
    this.#settings = null;

    // If the panel icon exists, destroy it.
    if (this.#panel_icon != null) {
      this.#connected_binding.unbind();
      this.#connected_binding = null;
      this.#panel_icon.destroy();
      this.#panel_icon = null;
    }

    this.#disconnect();
  }

  /**
   * 
   */
  #connect() {
    if (this.#connecting) return;

    this.#connecting = true;
    this.#disconnecting = false;

    this.#queue
      .push(new Queue.Item(() => sleep(100)
        .then(() => this.#connect_to_socket())
        .then(() => this.#connect_to_mutter())
        .then(() => this.#connecting = false)));
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
    log("Connecting to mutter...");

    this.#window = global.display.focus_window;

    this.#connect_to_object(
      this.#window,
      "size-changed",
      () => this.#send_window_data());

    // Subscribe to receive updates when the global `MetaDisplay` "focus-window"
    // property changes.
    this.#connect_to_object(global.display, "notify::focus-window", () => {
      if (this.#window != window) {
        this.#disconnect_from_object(this.#window);

        this.#window = global.display.focus_window;

        this.#connect_to_object(
          this.#window,
          "size-changed",
          () => this.#send_window_data());

        this.#send_window_data();
      }
    });

    // Subscribe to be notified when a new grab operaption begins.
    // This is needed because neither GNOME shell or mutter expose a signal that
    // is fired when a `MetaWindow` is moved. So, the solution is to subscribe
    // to the display when a grab operation starts; AKA when the user starts
    // moving around a window, and then updating the window data whenever the
    // cursor moves until the grab operation ends.
    this.#connect_to_object(global.display, "grab-op-begin", (_, __, grab_op) => {
      if (grab_op == Meta.GrabOp.MOVING || grab_op == Meta.GrabOp.KEYBOARD_MOVING) {
        if (window != this.#window) {
          this.#disconnect_from_object(this.#window);
          
          this.#window = global.display.focus_window;

          this.#connect_to_object(
            this.#window,
            "size-changed",
            () => this.#send_window_data());
        }

        this.#send_window_data();

        const cursor = Meta.CursorTracker.get_for_display(global.display);
        const cursor_connection = this.#connect_to_object(
          cursor,
          "position-invalidated",
          () => this.#send_window_data());

        const display_connection = this.#connect_to_object(global.display, "grab-op-end", () => {
          this.#disconnect_from_object(global.display, display_connection);
          this.#disconnect_from_object(cursor, cursor_connection);
        });
      }
    });

    log("Connected to mutter!");

    return Promise.resolve();
  }

  /**
   * Connects to `signal` on `object`, storing a relation between the two so
   * that it can be disconnected automatically if the extension is disabled.
   * 
   * @param {import("../types/.gobject").Object} object 
   * @param {string} signal 
   * @param {() => void} handler
   * @returns {number}
   */
  #connect_to_object(object, signal, handler) {
    if (object == null) return;
    const connections = this.#connections.get(object) ?? new Set();
    const connection = object.connect(signal, handler);
    connections.add(connection);
    this.#connections.set(object, connections);
    return connection;
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
        if (!DEBUG) log("Connecting to socket...");

        const attempt = () => {
          if (finished) return;

          attempts++;

          if (DEBUG) log(`Connecting to socket (${ordinal(attempts)} try)...`);

          client.connect_async(address, cancel, (client, result) => {
            if (finished) return;

            try {
              this.#socket = client.connect_finish(result).get_socket();

              this.#connected = true;
              this.notify("connected");

              resolve();

              log(`Connected to socket!`);
            } catch (error) {
              if (DEBUG) log(`Encountered an error while connecting to socket (${ordinal(attempts)} try). Reason: ${error}`);

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
        log("Cancelling connection to socket...");
        finished = true;
        cancel.cancel();
      },
    );
  }

  #disconnect() {
    if (this.#disconnecting) return;

    this.#disconnecting = true;
    this.#connecting = false;

    this.#queue
      .push(new Queue.Item(() => sleep(100)
        .then(() => this.#disconnect_from_objects())
        .then(() => this.#disconnect_from_socket())
        .then(() => this.#disconnecting = false)));
  }

  /**
   * @param {import("../types/.gobject").Object} object 
   * @param {number?} connection
   * @returns {boolean}
   */
  #disconnect_from_object(object, connection) {
    if (object == null) return;

    const connections = this.#connections.get(object) ?? new Set();

    if (connection != null) {
      object.disconnect(connection);

      const removed = connections.delete(connection);
      
      // We're not adding connections, so the only change in size could be
      // negative. As such, we only need to check if the set is now empty and
      // delete it if it is to ensure garbage collection.
      if (connections.size == 0) this.#connections.delete(object);
    
      return removed;
    } else {
      for (const connection of connections) object.disconnect(connection);
      return this.#connections.delete(object);
    }
  }

  #disconnect_from_objects() {
    try {
      log("Disconnecting from objects...");

      this.#window = null;

      for (const [object, connections] of this.#connections) {
        for (const connection of connections) object.disconnect(connection);
        connections.clear();
      }
      this.#connections.clear();

      log("Disconnected from objects.");

      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #disconnect_from_socket() {
    try {
      if (this.#socket == null) return Promise.resolve();

      log("Disconnecting from socket...");

      this.#socket.close();
      this.#socket = null;

      this.#connected = false;
      this.notify("connected");

      log("Disconnected from socket.");

      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #send_window_data() {
    const wm_class = this.#window.get_wm_class();
    const frame_rect = this.#window.get_frame_rect();

    try {
      this.#socket.send(socket_encode("focusedWindowData", {
        "id": wm_class,
        "x": frame_rect.x,
        "y": frame_rect.y,
        "width": frame_rect.width,
        "height": frame_rect.height,
      }), null);
    } catch (error) {
      log("Failed to send a message to the socket, disconnecting.");

      this.#disconnect();
      this.#connect();
    }
  }
}

/** @public @class PanelIcon */
class PanelIcon extends PanelMenu.Button {
  /** @public @property @type {boolean} */
  get connected() {
    return this.#connected;
  }

  /** @public @property @type {boolean} */
  set connected(value) {
    this.#connected = value;
    this.notify("connected");
  }

  /** @private @property @type {boolean} */
  #connected;
  /** @private @property @type {number} */
  #connection;
  /** @private @property @type {import("../types/.st").Icon} */
  #icon;
  /** @private @property @type {import("../types/.gio").Icon} */
  #icon_connected;
  /** @private @property @type {import("../types/.gio").Icon} */
  #icon_disconnected;

  /** @override @method @returns {void} */
  _init({ connected }) {
    super._init(0.0, null, true);

    this.#connected = connected;

    const [ icon_connected, icon_disconnected ] = resource(
      "icons/scalable/actions/fig-connected-symbolic.svg",
      "icons/scalable/actions/fig-disconnected-symbolic.svg"); 
    
    this.#icon_connected = Gio.Icon.new_for_string(icon_connected);
    this.#icon_disconnected = Gio.Icon.new_for_string(icon_disconnected);

    this.#icon = new St.Icon({
      gicon: this.#connected
        ? this.#icon_connected
        : this.#icon_disconnected,
      style_class: "system-status-icon",
      reactive: true,
      track_hover: true,
    });

    this.add_child(this.#icon);

    this.#connection = this.connect("notify::connected", () => {
      this.#icon.gicon = this.#connected
        ? this.#icon_connected
        : this.#icon_disconnected;
    });
  }

  /** @override @method @returns {void} */
  vfunc_finalize() {
    this.disconnect(this.#connection);

    delete this.#connected;
    delete this.#icon;
    delete this.#icon_connected;
    delete this.#icon_disconnected;

    super.vfunc_finalize();
  }
  
  /** @override @method @param {import("../types/.clutter").Event} event @returns {boolean} */
  vfunc_event(event) {
    if (this.menu && event.type() == Clutter.EventType.BUTTON_PRESS) {
      
    }

    return Clutter.EVENT_PROPAGATE;
  }
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
      this._ = () => entry(...args);
    }
  };

  /** @private @property @type {Queue.Item[]} */
  #items;
  /** @private @property @type {() => void} */
  #on_item_push;
  /** @private @property @type {boolean} */
  #running;
  
  /**
   * Creates a new empty queue without starting it.
   * 
   * @public
   * @constructor
   */
  constructor() {
    this.#items = [ ];
    this.#on_item_push = () => {};
    this.#running = false;
  }

  /**
   * Pushes an `item` to the queue.
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

    this.#items.push(item);
    
    if (this.#running) {
      this.#on_item_push();
      return this;
    }

    (async () => {
      this.#running = true;

      let item = this.#items.shift();
      while (!!item) {
        try {
          const value = item._();

          if ("cancel" in value && "promise" in value) {
            const { promise, cancel } = value;
            
            if (this.#items.length == 0) {
              await promise

              this.#on_item_push = () => {};
            } else {
              await cancel();
            }
          } else if (value instanceof Promise) {
            await value;
          }
        } catch (error) {
          log(`Uncaught error in Queue: ${error}`);
        }

        item = this.#items.shift();
      }

      this.#running = false;
    })()

    return this;
  }
}

/**
 * Initializes the extension, without enabling it, and returns it. This function
 * is expected to be in the toplevel of every extension.
 * 
 * @returns {Extension}
 */
function init() {
  Extension = GObject.registerClass({
    GTypeName: "FigExtension",
    Properties: {
      connected: GObject.ParamSpec.boolean(
        "connected", "connected", "connected",
        GObject.ParamFlags.READWRITE,
        false),
    },
  }, Extension);

  PanelIcon = GObject.registerClass({
    GTypeName: "FigPanelIcon",
    Properties: {
      connected: GObject.ParamSpec.boolean(
        "connected", "connected", "connected",
        GObject.ParamFlags.READWRITE,
        false),
    },
  }, PanelIcon);

  return new Extension();
}
