/// <reference path="../types/index.d.ts"/>

const { GLib } = imports.gi;

{
  const { then: old_then, catch: old_catch, finally: old_finally } = Promise.prototype;
  Promise.prototype.then = function then(on_resolve, on_reject) {
    if ("cancel" in this) {
      const old_cancel = this.cancel;

      
    } else {
      return old_then.call(this, on_resolve, on_reject);
    }
  };
}

const LOG_PREFIX = "Fig GNOME Integration:";

const RESOURCES_PREFIX = "resource:///org/gnome/shell/extensions/fig-gnome-integration";

/**
 * @param {any[]} messages
 * @returns {void}
 */
function log(...messages) {
  return console.log(LOG_PREFIX, ...messages);
}

/**
 * @template {string[]} T
 * @param  {T} resources
 * @returns {T extends [string, string, ...string[]] ? string[] : string}
 */
function resource(...resources) {
  if (resources.length >= 2) {
    return resources.map((path) => resource(path));
  } else if (resources.length == 1) {
    return `${RESOURCES_PREFIX}/${resources[0]}`;
  } else {
    if (DEBUG) {
      throw new RangeError("Expected one or more resources, got zero");
    } else {
      throw undefined;
    }
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
