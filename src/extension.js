
const { Gio, GLib } = imports.gi;

const State = {
  DISABLED_IDLE: 0,
  ENABLED_IDLE: 1,
  ENABLED_WAIT_FOR_SOCKET: 2,
  ENABLED_CONNECT_TO_SOCKET: 3,
};

class Extension {
  constructor() {
    this._cancel = null;
    this._disable = null;
    this._enable = null;
    this._socket = null;
    this._state = State.DISABLED_IDLE;
  }

  enable() {
    if (this._disable != null) {
      switch (this._state) {
        default:
          this._cancel.cancel();
          this._disable = null;
          break;
      }
    }

    this._cancel = Gio.Cancellable.new();
    this._enable = this._wait_for_socket(this._cancel)
      .then((cancel) => this._connect_to_socket(cancel))
      .catch((error) => console.error(error));
  }

  disable() {
  }

  _wait_for_socket(cancel) {
    this._state = State.ENABLED_WAIT_FOR_SOCKET;

    return new Promise((resolve, reject) => {
      cancel.connect(() => reject());
      
      const socket_file = Gio.File.new_for_path("/var/tmp/fig/" + GLib.get_user_name() + "/fig.socket");
  
      GLib.timeout_add(GLib.PRIORITY_LOW, 5000, (_) => {
        if (cancel.is_cancelled()) return false;
  
        if (socket_file.query_exists(null)) {
          resolve(cancel);
          return false;
        }
  
        return true;
      });
    });
  }

  _connect_to_socket(cancel) {
    this._state = State.ENABLED_CONNECT_TO_SOCKET;

    return new Promise((resolve, reject) => {
      cancel.connect(() => reject());

      const socket_address = Gio.UnixSocketAddress.new("/var/tmp/fig/" + GLib.get_user_name() + "/fig.socket");

      // TODO: Connect to socket and send data
    });
  }
}

function init() {
  return new Extension();
}
