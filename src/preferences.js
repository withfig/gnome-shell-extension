/// <reference path="../types/index.d.ts"/>

const { Gio, GLib, GObject, Gtk } = imports.gi;

const Adw = (() => {
  try {
    return imports.gi.Adw;
  } catch (_) {
    return null;
  }
})();

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

var PreferencesWindow;

/* if (Adw != null) {
  PreferencesWindow = GObject.registerClass({
    GTypeName: "FigPreferencesWindow",
  }, class PreferencesWindow extends Adw.Bin {
    _init() {
      super._init();
    }
  });
} else { */
  PreferencesWindow = GObject.registerClass({
    GTypeName: "FigPreferencesWindow",
    Template: "resource:///org/gnome/shell/extensions/fig-gnome-integration/ui/gtk/Preferences.ui",
    InternalChildren: [ "show_panel_icon", "other_preferences" ],
  }, class PreferencesWindow extends Gtk.Box {
    /** @private @property @type {import("../types/.gtk").Switch} */
    _show_panel_icon;
    /** @private @property @type {import("../types/.gtk").Button} */
    _other_preferences;
    
    _init() {
      super._init();

      //this._show_panel_icon.state = ExtensionUtils.getSettings().get_boolean("show-panel-icon");
//
      //this._show_panel_icon.connect("state-set", () => {
      //  ExtensionUtils.getSettings().set_boolean("show-panel-icon", this._show_panel_icon.state);
      //});
//
      //this._other_preferences.connect("clicked", () => {
      //  // TODO
      //});
    }
  });
//}

function buildPrefsWidget() {
  return new PreferencesWindow();
}
