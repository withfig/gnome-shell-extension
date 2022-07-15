
class Extension {
  constructor() {
  }

  enable() {
    imports.misc.util.spawn([ "firefox", "https://fig.io" ]);
  }

  disable() {
  }
}

function init() {
  return new Extension();
}
